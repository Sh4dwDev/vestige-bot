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
  /**
   * Who was standing on it at the previous tick.
   *
   * Positions arrive once a minute, so being seen there once says only that you
   * arrived at some point in the last minute — not that you were there for it.
   * Crediting that first sighting handed somebody a full minute for walking
   * past, and a one-minute contest was won by the first tick after it started.
   */
  present?: string[];
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
  const wasPresent = new Set(contest.present ?? []);
  const next: Contest = {
    ...contest,
    progress: { ...contest.progress },
    // Recorded every tick, contested or not: leaving somebody out here would
    // make them start again from zero the moment a rival turned up.
    present: holders,
  };

  // Time is only credited between two sightings. The first one establishes that
  // somebody is there; the second is the first that can prove they stayed. So a
  // hold rounds up to the next whole tick rather than being handed out for
  // arriving, which is the honest direction to be wrong in.
  //
  // Nobody gains while it is contested. That is the whole mechanic: the way to
  // stop somebody taking it is to be standing there too.
  if (holders.length === 1 && elapsedMs > 0) {
    const holder = holders[0] as string;
    if (wasPresent.has(holder)) {
      next.progress[holder] = (next.progress[holder] ?? 0) + elapsedMs;
    }
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

// ------------------------------------------------------------------ running --

const CHANNEL_KEY = 'contest_channel';

export const contestChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(CHANNEL_KEY) || null;

export const setContestChannel = (ctx: Ctx, channelId: string | null): void =>
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');

export interface TickOutcome {
  /** Set when somebody just won, so the caller can announce it once. */
  winner: string | null;
  contested: boolean;
  holders: string[];
}

/**
 * One turn of the clock, and the payout if it ends.
 *
 * Called from the poll that already reads positions, so this costs nothing
 * extra. Everything that decides an outcome lives in `tickContest`, which is
 * pure; this only writes the results down and hands out the prize.
 */
export function advanceContest(
  ctx: Ctx,
  players: PlayerRow[],
  elapsedMs: number,
): TickOutcome | null {
  const contest = activeContest(ctx);
  if (!contest) return null;

  const result = tickContest(contest, players, elapsedMs);

  if (!result.winner) {
    saveContest(ctx, result.contest);
    return { winner: null, contested: result.contested, holders: result.holders };
  }

  // Paid and cleared in one go: leaving it active would keep paying the same
  // person every few seconds for standing still.
  ctx.db.addPoints(result.winner, contest.reward, 0);
  if (contest.skin) ctx.db.grantSkin(result.winner, contest.skin, `Won ${contest.name}`);
  saveContest(ctx, null);

  return { winner: result.winner, contested: false, holders: result.holders };
}

export function buildContestWonEmbed(contest: Contest, winner: string): EmbedBuilder {
  const held = leader(contest);

  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`🏆  ${contest.name} claimed`)
    .setDescription(
      `${winner} held it and takes **${contest.reward}** points` +
      (contest.skin ? ` and the **${contest.skin}** skin` : '') + '.\n\n' +
      (held ? `Held for **${minutes(held.heldMs)}**.` : ''),
    )
    .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
    .setTimestamp();
}
