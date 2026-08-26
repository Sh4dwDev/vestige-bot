import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './population.js';
import { rankIcon } from './ranks.js';
import { playMultiplier } from './events.js';
import { multiplierFor, tierOf } from './tiers.js';

/**
 * Points, earned by playing.
 *
 * Awarded per minute against the poll that already runs, and keyed by Steam ID
 * so someone who has never touched Discord still builds a balance and finds it
 * waiting when they link.
 *
 * Nothing spends them yet. That is deliberate — the earning side wants to run
 * for a while and be seen to be fair before anything depends on the numbers.
 */

const RATE_KEY = 'points_per_hour';
export const DEFAULT_RATE_PER_HOUR = 60;

/**
 * The most one poll may pay for, however long it actually was.
 *
 * Without it, a bot that was down for six hours would, on its first tick, pay
 * everyone online for all six — including people who joined a minute ago.
 */
const MAX_MINUTES_PER_AWARD = 5;

/**
 * A one-off for linking a Steam account.
 *
 * Linking is the step everything else is gated behind, and it costs somebody a
 * trip in game to type a code — so it is worth paying for rather than merely
 * demanding. Small on purpose: it is a nudge past the one bit of friction, not
 * a thing to farm.
 *
 * **Paid once per Steam account, ever.** Against the game account rather than
 * the Discord one, because unlinking and linking again is otherwise a button
 * that prints points. That marker is never cleared, including by /unlink.
 */
const DEFAULT_LINK_BONUS = 150;

export function linkBonus(ctx: Ctx): number {
  const raw = Number.parseFloat(ctx.db.getSetting('link_bonus') ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_LINK_BONUS;
}

export function setLinkBonus(ctx: Ctx, amount: number): void {
  ctx.db.setSetting('link_bonus', String(amount));
}

/** Pays it if this account has never been paid. Returns what was paid. */
export function payLinkBonus(ctx: Ctx, steamId: string): number {
  const amount = linkBonus(ctx);
  if (amount <= 0) return 0;

  const key = `link_bonus_paid:${steamId}`;
  if (ctx.db.getSetting(key) === '1') return 0;

  ctx.db.setSetting(key, '1');
  ctx.db.addPoints(steamId, amount, 0);
  return amount;
}

export function ratePerHour(ctx: Ctx): number {
  const raw = Number.parseFloat(ctx.db.getSetting(RATE_KEY) ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RATE_PER_HOUR;
}

export function setRatePerHour(ctx: Ctx, rate: number): void {
  ctx.db.setSetting(RATE_KEY, String(rate));
}

/**
 * How much to pay for a gap of `elapsedMs`, and how many minutes that counts
 * as. Pure, because the capping rule is the part worth testing.
 */
export function awardFor(
  elapsedMs: number,
  rate: number,
): { points: number; minutes: number } {
  const minutes = Math.min(MAX_MINUTES_PER_AWARD, Math.max(0, elapsedMs / 60_000));
  return { points: (minutes / 60) * rate, minutes: Math.round(minutes) };
}

/**
 * Pays everyone currently playing, scaled by the tier of what they are on.
 *
 * Takes the mod's player rows rather than a list of Steam IDs, because the tier
 * depends on the species — which means someone sitting on the spawn screen
 * earns nothing. That is the intended reading of "earned by playing".
 *
 * `at` is a parameter rather than a `new Date()` inside, because the weekend
 * bonus makes this depend on the clock — and a payout that behaves differently
 * on a Saturday is untestable when the time is hidden. The tier tests failed on
 * a Saturday for exactly that reason.
 */
export function awardOnline(
  ctx: Ctx,
  players: PlayerRow[],
  elapsedMs: number,
  at = new Date(),
): number {
  const { points, minutes } = awardFor(elapsedMs, ratePerHour(ctx));
  if (points <= 0 || players.length === 0) return 0;

  // The same for everybody, and added rather than multiplied — see the note on
  // weekendBonus. Worked out once per tick, not once per player.
  const bonus = weekendActive(ctx, at) ? (minutes / 60) * weekendBonus(ctx) : 0;

  let paid = 0;
  for (const player of players) {
    if (!player.steam) continue;
    // Tier sets the base rate; an endangered event multiplies on top, so
    // taking the unpopular species and surviving on it actually pays.
    const scaled = (points
      * multiplierFor(ctx, tierOf(ctx, player.species))
      * playMultiplier(ctx, player.species)) + bonus;
    ctx.db.addPoints(player.steam, scaled, minutes);
    paid += scaled;
  }
  return paid;
}

// ------------------------------------------------------------------ embeds --

const hours = (minutes: number): string =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/** Floored: showing 41.7 points invites arguments about rounding. */
export const display = (balance: number): number => Math.floor(balance);

export function buildBalanceEmbed(
  balance: number,
  minutes: number,
  rate: number,
  /** Told to the player: a bonus nobody knows about changes nobody's behaviour. */
  weekend?: { bonus: number; active: boolean; window: WeekendWindow },
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🪙  Your points')
    .setDescription(
      `## ${display(balance).toLocaleString()}\n` +
      `Earned over **${hours(minutes)}** on ${SERVER}.\n\n` +
      `You earn **${rate}** points an hour just by playing, more on higher tiers ` +
      'and for kills.\n' +
      (weekend && weekend.bonus > 0
        ? (weekend.active
          ? `🎉 **Weekend bonus is on** — +${weekend.bonus} an hour on top, ` +
            'the same for everybody.\n'
          : `🗓️ **+${weekend.bonus} an hour** during ${describeWindow(weekend.window)}.\n`)
        : '') +
      '\nSpend them with `/shop` on a **fully grown** dinosaur, ' +
      'delivered into your archive.',
    )
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

export function buildLeaderboardEmbed(
  rows: Array<{ steamId: string; balance: number; minutes: number }>,
  nameFor: (steamId: string) => string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('🏆  Most points on ' + SERVER)
    .setFooter({ text: SIGNATURE })
    .setTimestamp();

  if (rows.length === 0) {
    return embed.setDescription('Nobody has earned anything yet.');
  }

  embed.setDescription(
    rows
      .map((row, n) =>
        `${rankIcon(n)}  **${display(row.balance).toLocaleString()}** ` +
        `· ${nameFor(row.steamId)} · ${hours(row.minutes)} played`)
      .join('\n'),
  );

  return embed;
}

// -------------------------------------------------------------- weekends --

/**
 * Extra points for playing at the weekend.
 *
 * **A flat bonus per hour, not a multiplier.** Tier multipliers already reach
 * x3, so doubling everything at the weekend would mean a Rex earning six times
 * a Dryosaurus — widening the gap the tiers deliberately set rather than
 * respecting it. Adding the same amount to everybody rewards turning up, which
 * is the thing actually worth encouraging, and it helps the low tiers most in
 * proportion — they are the ones who need a reason.
 *
 * Applied after the tier and event multipliers, so nothing scales it.
 *
 * Times are **Europe/Oslo**, read through Intl rather than a fixed offset,
 * because Norway moves twice a year and a hardcoded +1 would silently shift the
 * whole window for half of it.
 */

const ZONE = 'Europe/Oslo';

const DEFAULT_WINDOW = {
  /** Friday evening. 0 is Sunday, matching getDay. */
  startDay: 5,
  startHour: 18,
  /** Monday morning. */
  endDay: 1,
  endHour: 6,
};

/** Half the base rate: noticeable, and not enough to make weekdays pointless. */
const DEFAULT_BONUS_PER_HOUR = 30;

export interface WeekendWindow {
  startDay: number;
  startHour: number;
  endDay: number;
  endHour: number;
}

export function weekendBonus(ctx: Ctx): number {
  const raw = Number.parseFloat(ctx.db.getSetting('weekend_bonus') ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_BONUS_PER_HOUR;
}

export function setWeekendBonus(ctx: Ctx, perHour: number): void {
  ctx.db.setSetting('weekend_bonus', String(perHour));
}

export function weekendWindow(ctx: Ctx): WeekendWindow {
  try {
    const raw = ctx.db.getSetting('weekend_window');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WeekendWindow>;
      if ([parsed.startDay, parsed.startHour, parsed.endDay, parsed.endHour]
        .every((n) => typeof n === 'number')) {
        return parsed as WeekendWindow;
      }
    }
  } catch {
    // Fall through to the default rather than refusing to pay anybody.
  }
  return DEFAULT_WINDOW;
}

export function setWeekendWindow(ctx: Ctx, window: WeekendWindow): void {
  ctx.db.setSetting('weekend_window', JSON.stringify(window));
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Day and hour in Oslo, whatever the host's clock is set to. */
export function osloTime(at: Date): { day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const day = DAYS.indexOf(get('weekday').toLowerCase().slice(0, 3) as typeof DAYS[number]);

  return {
    day: day < 0 ? at.getUTCDay() : day,
    // Midnight comes back as 24 in some locales, which would sort after 23.
    hour: Number.parseInt(get('hour'), 10) % 24,
    minute: Number.parseInt(get('minute'), 10) || 0,
  };
}

/**
 * Whether a moment falls in the weekend window.
 *
 * Compared as minutes-into-the-week so a window that runs past Sunday midnight
 * is one comparison rather than a special case. Friday evening to Monday
 * morning wraps the end of the week, which is the normal shape here, not the
 * exception.
 */
export function isWeekend(at: Date, window: WeekendWindow): boolean {
  const { day, hour, minute } = osloTime(at);
  const now = (day * 1440) + (hour * 60) + minute;
  const start = (window.startDay * 1440) + (window.startHour * 60);
  const end = (window.endDay * 1440) + (window.endHour * 60);

  return start <= end ? now >= start && now < end : now >= start || now < end;
}

export const weekendActive = (ctx: Ctx, at = new Date()): boolean =>
  weekendBonus(ctx) > 0 && isWeekend(at, weekendWindow(ctx));

const WEEK_MINUTES = 7 * 1440;

/**
 * The first moment at or after `from` when Oslo's clock reads this day and hour.
 *
 * Guess, then correct once. The guess is exact except across a daylight saving
 * change, where it lands an hour out, and one correction fixes that because the
 * shift is only ever an hour. Doing it by stepping a minute at a time would
 * mean ten thousand date formats to look a week ahead.
 */
function occurrence(day: number, hour: number, from: Date): number {
  const target = (day * 1440) + (hour * 60);

  const now = osloTime(from);
  const nowMinutes = (now.day * 1440) + (now.hour * 60) + now.minute;

  let ahead = target - nowMinutes;
  if (ahead <= 0) ahead += WEEK_MINUTES;

  const guess = from.getTime() + (ahead * 60_000);

  const landed = osloTime(new Date(guess));
  const landedMinutes = (landed.day * 1440) + (landed.hour * 60) + landed.minute;

  // Shortest way round the week, so a correction near the week boundary does
  // not send it six days in the wrong direction.
  let drift = target - landedMinutes;
  if (drift > WEEK_MINUTES / 2) drift -= WEEK_MINUTES;
  if (drift < -WEEK_MINUTES / 2) drift += WEEK_MINUTES;

  return guess + (drift * 60_000);
}

/**
 * The window as real instants: the one running now, or the next one.
 *
 * Both ends are resolved independently rather than by adding a duration,
 * because a window that spans a daylight saving change is not the number of
 * hours it looks like.
 */
export function windowInstance(
  window: WeekendWindow,
  at = new Date(),
): { start: number; end: number } {
  const running = isWeekend(at, window);

  // When it is already running, the start is behind us, so the search begins a
  // week back and finds this occurrence rather than next week's.
  const from = running ? new Date(at.getTime() - (WEEK_MINUTES * 60_000)) : at;
  const start = occurrence(window.startDay, window.startHour, from);

  return { start, end: occurrence(window.endDay, window.endHour, new Date(start + 60_000)) };
}

/**
 * The window, written in the reader's own timezone.
 *
 * Discord renders `<t:seconds:F>` in whatever timezone the person reading it is
 * in, which is the only way this is right for everybody. Naming a zone meant
 * every player outside Norway doing the arithmetic themselves, and getting it
 * wrong twice a year when the hour moved.
 */
export const describeWindow = (window: WeekendWindow, at = new Date()): string => {
  const { start, end } = windowInstance(window, at);
  const stamp = (ms: number): string => `<t:${Math.floor(ms / 1000)}:F>`;
  return `${stamp(start)} to ${stamp(end)}, every week`;
};
