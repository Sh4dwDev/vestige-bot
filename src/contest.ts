import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';

/**
 * A place worth fighting over.
 *
 * A location is announced. Stand there long enough and it is yours. Stand there
 * with somebody else and **nobody's timer moves** until one of you is gone.
 *
 * **Deliberately built on watching, not spawning.** Putting a real nest or egg
 * in the world means spawning a pawn and its controller from Lua, which this
 * project has already tried: four commits of AI wildlife, then "Remove the AI
 * wildlife feature". Positions are read every few seconds anyway for the
 * heatmap, so a contested point needs no new engine capability at all — which
 * is why it can be trusted to work.
 *
 * Progress is **cumulative rather than continuous**. "Stay with it" suggests an
 * unbroken hold, but positions arrive every few seconds and a player who dies
 * or lags briefly would lose everything to a gap in the data rather than to
 * another player. Freezing on contest is what makes it a fight; resetting on a
 * dropped packet would only make it a lottery.
 */

const KEY = 'contest_state';

export interface Contest {
  /** Where, in world units. */
  x: number;
  y: number;
  /** How close counts, in world units. */
  radius: number;
  /** How long somebody has to hold it, in milliseconds. */
  holdMs: number;
  /** Points for the winner. */
  reward: number;
  /** A skin preset the winner also keeps, if one was chosen. */
  skin?: string;
  name: string;
  startedAt: number;
  /** Steam ID to milliseconds held so far. */
  progress: Record<string, number>;
}

export function activeContest(ctx: Ctx): Contest | null {
  const raw = ctx.db.getSetting(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Contest>;
    return typeof parsed.x === 'number' && typeof parsed.y === 'number'
      ? (parsed as Contest)
      : null;
  } catch {
    return null;
  }
}

export const saveContest = (ctx: Ctx, contest: Contest | null): void =>
  ctx.db.setSetting(KEY, contest ? JSON.stringify(contest) : '');

/** Straight-line distance, which is what "near it" means on a flat map. */
export const distance = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

export const inside = (contest: Contest, player: PlayerRow): boolean =>
  typeof player.x === 'number' && typeof player.y === 'number'
  && distance(player.x, player.y, contest.x, contest.y) <= contest.radius;

export interface TickResult {
  contest: Contest;
  /** Who is standing on it right now. */
  holders: string[];
  /** True when more than one is, so nobody is gaining. */
  contested: boolean;
  /** Set once somebody has held it long enough. */
  winner: string | null;
}

/**
 * Advances the hold clock.
 *
 * Pure on purpose: this is the part with the rules in it, and rules are worth
 * testing without a server attached.
 */
export function tickContest(
  contest: Contest,
  players: PlayerRow[],
  elapsedMs: number,
): TickResult {
  const holders = players
    .filter((p) => p.steam && inside(contest, p))
    .map((p) => p.steam as string);

  const contested = holders.length > 1;
  const next: Contest = { ...contest, progress: { ...contest.progress } };

  // Nobody gains while it is contested. That is the whole mechanic: the way to
  // stop somebody taking it is to be standing there too.
  if (holders.length === 1 && elapsedMs > 0) {
    const holder = holders[0] as string;
    next.progress[holder] = (next.progress[holder] ?? 0) + elapsedMs;
  }

  const winner = holders.length === 1
    && (next.progress[holders[0] as string] ?? 0) >= contest.holdMs
    ? holders[0] as string
    : null;

  return { contest: next, holders, contested, winner };
}

/** Best progress so far, for the panel and the announcement. */
export function leader(contest: Contest): { steam: string; heldMs: number } | null {
  const entries = Object.entries(contest.progress);
  if (entries.length === 0) return null;

  const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { steam: best[0], heldMs: best[1] };
}

const minutes = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

/** The HUD scale, so a player can navigate to it. */
export const hud = (value: number): number => Math.round(value / 1000);

export function buildContestEmbed(
  contest: Contest,
  nameFor: (steamId: string) => string,
  state: { holders: string[]; contested: boolean } = { holders: [], contested: false },
): EmbedBuilder {
  const best = leader(contest);

  return new EmbedBuilder()
    .setColor(state.contested ? 0xed4245 : 0xfee75c)
    .setTitle(`🚩  ${contest.name}`)
    .setDescription(
      `Hold this spot for **${minutes(contest.holdMs)}** to claim it.\n\n` +
      `📍 Lat **${hud(contest.y)}**, Long **${hud(contest.x)}** — anywhere within ` +
      `**${hud(contest.radius)}** counts.\n` +
      `🏆 **${contest.reward}** points` +
      (contest.skin ? ` and the **${contest.skin}** skin` : '') + '.\n\n' +
      (state.contested
        ? `⚔️ **Contested.** ${state.holders.length} of you are on it, so nobody ` +
          'is gaining. Somebody has to leave.'
        : state.holders.length === 1
          ? '⏳ Someone is holding it right now.'
          : '🕳️ Nobody is on it.'),
    )
    .addFields(best
      ? [{
        name: 'Closest so far',
        value: `${nameFor(best.steam)} — **${minutes(best.heldMs)}** of ` +
          `${minutes(contest.holdMs)}`,
      }]
      : [])
    .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
    .setTimestamp();
}

/** ASCII only: this goes out over RCON, which silently drops anything else. */
export const contestAnnounce = (contest: Contest): string =>
  `${contest.name}: hold Lat ${hud(contest.y)}, Long ${hud(contest.x)} for `
  + `${Math.round(contest.holdMs / 60000)} minutes to win ${contest.reward} points. `
  + 'Two or more players on it and nobody gains.';

export const winnerAnnounce = (contest: Contest, who: string): string =>
  `${who} held ${contest.name} and takes ${contest.reward} points.`;
