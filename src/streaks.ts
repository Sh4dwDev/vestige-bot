import type { Ctx } from './commands.js';

/**
 * Consecutive days played, and a bonus that grows with them.
 *
 * The other things here reward what you do in an evening. This rewards coming
 * back tomorrow, which is the different and harder problem: an event needs
 * somebody to run it and only pays the people who were already online, while a
 * streak works on the player who is deciding right now whether tonight is worth
 * logging in for.
 *
 * Deliberately small numbers. A streak bonus large enough to matter against the
 * hourly rate would make missing a day feel like a punishment, and the point is
 * to give somebody a reason to come back, not to make them dread not coming.
 */

const ENABLED_KEY = 'streak_enabled';
const STEP_KEY = 'streak_step';
const CAP_KEY = 'streak_cap';

/** Per day of streak. Day three pays three times this, up to the cap. */
export const DEFAULT_STEP = 40;

/**
 * The most a day can pay, however long the streak.
 *
 * Without it a streak of ninety pays more for logging in than a full evening of
 * playing, and the reward stops being a nudge and becomes the whole game.
 */
export const DEFAULT_CAP = 400;

export const streaksEnabled = (ctx: Ctx): boolean =>
  ctx.db.getSetting(ENABLED_KEY) !== '0';

export const setStreaksEnabled = (ctx: Ctx, on: boolean): void =>
  ctx.db.setSetting(ENABLED_KEY, on ? '1' : '0');

const number = (ctx: Ctx, key: string, fallback: number): number => {
  const raw = Number.parseInt(ctx.db.getSetting(key) ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

export const streakStep = (ctx: Ctx): number => number(ctx, STEP_KEY, DEFAULT_STEP);
export const streakCap = (ctx: Ctx): number => number(ctx, CAP_KEY, DEFAULT_CAP);

export const setStreakRewards = (ctx: Ctx, step: number, cap: number): void => {
  ctx.db.setSetting(STEP_KEY, String(Math.max(0, Math.round(step))));
  ctx.db.setSetting(CAP_KEY, String(Math.max(0, Math.round(cap))));
};

/**
 * Today's date in Oslo, as `YYYY-MM-DD`.
 *
 * Oslo rather than UTC because the day has to end when people stop playing. On
 * UTC the boundary lands at one or two in the morning local time, which is
 * exactly when somebody is still on, and they would lose a streak they were in
 * the middle of extending.
 */
export function osloDay(at = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The day before a given `YYYY-MM-DD`, in the same calendar. */
export function dayBefore(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export interface StreakState {
  lastDay: string;
  streak: number;
  best: number;
}

export type StreakStep =
  /** Already counted today; nothing owed. */
  | { kind: 'counted' }
  /** A day was added, or the streak started again. */
  | { kind: 'extended'; state: StreakState; broken: boolean };

/**
 * What today does to a streak. Pure, so the calendar cases are testable.
 *
 * Missing a day resets to one rather than to zero: somebody who comes back
 * after a week is on day one of a new streak, not on nothing, and telling them
 * they have nothing is how you lose them a second time.
 */
export function nextStreak(previous: StreakState | null, today: string): StreakStep {
  if (previous?.lastDay === today) return { kind: 'counted' };

  const continued = previous !== null && previous.lastDay === dayBefore(today);
  const streak = continued ? previous.streak + 1 : 1;

  return {
    kind: 'extended',
    state: {
      lastDay: today,
      streak,
      best: Math.max(streak, previous?.best ?? 0),
    },
    // A first-ever day is not a broken streak, it is a first day.
    broken: previous !== null && !continued,
  };
}

export const streakBonus = (streak: number, step: number, cap: number): number =>
  Math.min(cap, Math.max(0, Math.round(streak * step)));

/** What the player is told, in game, once per day. */
export function streakNotice(streak: number, bonus: number, broken: boolean): string {
  if (streak === 1) {
    return broken
      ? `Welcome back. Day 1 again, ${bonus} points.`
      : `Day 1 on the island. ${bonus} points.`;
  }
  return `Day ${streak} in a row. ${bonus} points.`;
}

export interface StreakAward {
  steamId: string;
  streak: number;
  bonus: number;
  broken: boolean;
}

/**
 * Counts today for everybody online, and pays whoever had not been counted yet.
 *
 * Called from the minute tick, so being on at all is what counts. Requiring a
 * length of time would mean the reward for coming back arrives late enough that
 * somebody checking in for five minutes never sees it, and those are exactly
 * the people this is for.
 *
 * Never throws: this sits on top of the ordinary payout and must not be able to
 * stop it.
 */
export function recordPlay(
  ctx: Ctx,
  steamIds: string[],
  at = new Date(),
): StreakAward[] {
  if (!streaksEnabled(ctx)) return [];

  const today = osloDay(at);
  const step = streakStep(ctx);
  const cap = streakCap(ctx);
  const awards: StreakAward[] = [];

  for (const steamId of steamIds) {
    if (!steamId) continue;

    const outcome = nextStreak(ctx.db.streakFor(steamId), today);
    if (outcome.kind === 'counted') continue;

    ctx.db.saveStreak(steamId, outcome.state);

    const bonus = streakBonus(outcome.state.streak, step, cap);
    if (bonus > 0) ctx.db.addPoints(steamId, bonus, 0);

    awards.push({
      steamId,
      streak: outcome.state.streak,
      bonus,
      broken: outcome.broken,
    });
  }

  return awards;
}
