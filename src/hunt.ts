import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
import { hud } from './contest.js';
// Shared with the drop on purpose: two events describing distance and
// direction in different words would read as two different games.
import { bearingWord, distanceWord } from './drop.js';

/**
 * One player is the quarry. Kill them and the prize is yours; keep them alive
 * to the end and nobody gets anything.
 *
 * The whole event rests on the killfeed knowing **who** killed whom, which is
 * exactly what the damage hook records. A quarry who breaks off wounded and
 * bleeds out still pays whoever last hit them — that is how most fights here
 * actually end, and calling it a survival made the fight look like it never
 * happened. Drowning, starving and wildlife still leave nobody to pay, and
 * those are treated as the quarry surviving rather than quietly awarding it to
 * whoever was nearest: guessing a winner is worse than having none.
 *
 * Position is announced on a timer rather than continuously. A quarry whose
 * exact spot is always known cannot play, and one who is never located cannot
 * be found — a stale fix every few minutes is what makes it a hunt.
 */

const KEY = 'hunt_state';

export interface Hunt {
  /** Steam ID of the quarry. */
  targetSteam: string;
  /** For announcements, since Steam IDs mean nothing to players. */
  targetName: string;
  /**
   * What they were last seen playing.
   *
   * Kept on the hunt rather than looked up when needed, because it has to
   * survive them being offline or unlocatable — and it is refreshed on every
   * position call, so a target who dies and comes back on something else is
   * described correctly from the next call onwards.
   */
  targetSpecies?: string;
  reward: number;
  skin?: string;
  /** When it ends, whatever has happened. */
  endsAt: number;
  /** How often the quarry's position goes out. */
  revealEveryMs: number;
  /** Last time it did, so the timer survives a restart. */
  lastRevealAt: number;
  startedAt: number;
  /**
   * How close each hunter was told they were, last time they were told.
   *
   * Kept so a notice fires when somebody crosses a band rather than every few
   * seconds while they stand still — "you are close" repeated twelve times a
   * minute is not a warmer signal, it is spam.
   */
  bands?: Record<string, number>;
  /**
   * When the quarry stopped being locatable, or absent while they are on.
   *
   * A hunt whose target has logged off looks identical to one where nobody has
   * found them yet: no position calls, no kill, and then "survived". Hunters
   * search an empty island and blame the bot. Tracked so it can be said out
   * loud instead.
   */
  goneSince?: number;
  /** Whether the disappearance was announced, so it is said once, not per tick. */
  goneTold?: boolean;
  /**
   * Everybody who ever got close enough to be told they were warm.
   *
   * Accumulated rather than derived from `bands`, which is current state and is
   * cleared the moment somebody drifts back out. Turning up and chasing is the
   * thing being paid for, and it is over by the time anybody is counting.
   */
  chased?: string[];
  /**
   * Who was standing with the quarry when the hunt was called.
   *
   * These are the people who cannot claim it. A quarry's own group killing
   * them is not a hunt, it is the pair of them splitting the reward, and it is
   * the cheapest way to farm one.
   *
   * The game does not tell us who is grouped with whom, and the two attempts
   * at asking the engine directly took the server down (see NOTES.md). Standing
   * together at the moment the hunt is announced is the signal available
   * without that risk: a group is already together, a hunter has to travel.
   */
  company?: string[];
}

/**
 * How close counts as close, in HUD units, nearest first.
 *
 * HUD units because that is what the position call already speaks: a hunter is
 * given `Lat -317, Long 120` and can read their own coordinates off the same
 * display, so a distance in the same scale is one they can act on.
 */
/**
 * How close counts as warm, in HUD units, tightest first.
 *
 * Only the distance is used now. The wording that used to live here was
 * replaced by a bearing worked out per hunter, and the quarry is told nothing
 * at all: a proximity alarm they can act on turns every hunt into the quarry
 * leaving the moment it fires.
 *
 * Band 0, the innermost, is deliberately silent. Everything inside it is meant
 * to be done by eye.
 */
export const BANDS: Array<{ within: number }> = [
  { within: 8 },
  { within: 20 },
  { within: 45 },
];

export function activeHunt(ctx: Ctx): Hunt | null {
  const raw = ctx.db.getSetting(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Hunt>;
    return typeof parsed.targetSteam === 'string' && typeof parsed.endsAt === 'number'
      ? (parsed as Hunt)
      : null;
  } catch {
    return null;
  }
}

export const saveHunt = (ctx: Ctx, hunt: Hunt | null): void =>
  ctx.db.setSetting(KEY, hunt ? JSON.stringify(hunt) : '');

export type HuntStep =
  | { kind: 'reveal'; x: number; y: number; species: string }
  | { kind: 'survived' }
  | { kind: 'waiting' };

/**
 * What the hunt should do next, given the clock and where everyone is.
 *
 * Pure. A kill is handled separately because it arrives as an event rather than
 * being visible in a snapshot of positions.
 */
export function huntStep(hunt: Hunt, players: PlayerRow[], now: number): HuntStep {
  if (now >= hunt.endsAt) return { kind: 'survived' };

  if (now - hunt.lastRevealAt < hunt.revealEveryMs) return { kind: 'waiting' };

  const target = players.find((p) => p.steam === hunt.targetSteam);
  // Offline or unlocatable: nothing to say, and saying nothing is better than
  // announcing a position from ten minutes ago as though it were current.
  if (!target || target.x === undefined || target.y === undefined) {
    return { kind: 'waiting' };
  }

  return { kind: 'reveal', x: target.x, y: target.y, species: target.species };
}

/**
 * How long the quarry can be unlocatable before it is worth saying so.
 *
 * Longer than a respawn or a loading screen, short enough that hunters are not
 * left combing an empty island. Somebody dying and coming back should not
 * trigger it.
 */
export const GONE_AFTER_MS = 90_000;

export interface PresenceStep {
  /** The hunt with its presence bookkeeping updated. */
  hunt: Hunt;
  /** Whether anything changed, and so whether it is worth saving. */
  changed: boolean;
  /** Said once per transition, never per tick. */
  announce: 'gone' | 'back' | null;
}

/**
 * Whether the quarry is on the island, and whether that has just changed.
 *
 * Pure, and separate from the position call because it answers a different
 * question: not "where are they" but "are they here at all".
 *
 * Two flags rather than one. `goneSince` starts the clock the moment they stop
 * being locatable, which is not yet worth announcing because a respawn or a
 * loading screen looks the same. `goneTold` records that it was announced, so
 * the message goes out once per disappearance rather than every five seconds
 * for the rest of the hunt.
 */
export function presenceStep(hunt: Hunt, players: PlayerRow[], now: number): PresenceStep {
  const target = players.find((p) => p.steam === hunt.targetSteam);
  const here = target !== undefined && target.x !== undefined && target.y !== undefined;

  if (here) {
    if (hunt.goneSince === undefined) return { hunt, changed: false, announce: null };

    // Coming back is only news to people who were told they had gone.
    const told = hunt.goneTold === true;
    const back: Hunt = { ...hunt };
    delete back.goneSince;
    delete back.goneTold;

    return { hunt: back, changed: true, announce: told ? 'back' : null };
  }

  if (hunt.goneSince === undefined) {
    // Start the clock, say nothing yet.
    return { hunt: { ...hunt, goneSince: now }, changed: true, announce: null };
  }

  if (hunt.goneTold !== true && now - hunt.goneSince >= GONE_AFTER_MS) {
    return { hunt: { ...hunt, goneTold: true }, changed: true, announce: 'gone' };
  }

  return { hunt, changed: false, announce: null };
}

export const goneAnnounce = (hunt: Hunt): string =>
  `HUNT: ${hunt.targetName} is not on the island. No position calls until they are back.`;

export const backAnnounce = (hunt: Hunt): string =>
  `HUNT: ${hunt.targetName} is back on the island.`;

/** ASCII only: these go out over RCON, which drops anything else silently. */
export const huntAnnounce = (hunt: Hunt): string =>
  `HUNT: ${hunt.targetName} is the target`
  + (hunt.targetSpecies ? ` (${hunt.targetSpecies})` : '')
  + `. Kill them for ${hunt.reward} points. `
  + `Their position is called out every ${Math.round(hunt.revealEveryMs / 60000)} minutes.`;

export const revealAnnounce = (
  hunt: Hunt,
  x: number,
  y: number,
  species: string,
): string =>
  `HUNT: ${hunt.targetName} was last seen at Lat ${hud(y)}, Long ${hud(x)}`
  + (species ? ` playing ${species}.` : '.');

export const caughtAnnounce = (hunt: Hunt, killer: string): string =>
  `HUNT: ${killer} killed ${hunt.targetName} and takes ${hunt.reward} points.`;

export const survivedAnnounce = (hunt: Hunt): string =>
  `HUNT: ${hunt.targetName} survived. Nobody wins.`;

export const colludedAnnounce = (hunt: Hunt): string =>
  `HUNT: ${hunt.targetName} was killed by their own group. Nobody wins.`;

export function buildHuntEmbed(hunt: Hunt, state: 'running' | 'caught' | 'survived',
  killer?: string): EmbedBuilder {
  const colour = state === 'caught' ? 0x57f287 : state === 'survived' ? 0xed4245 : 0xfee75c;

  return new EmbedBuilder()
    .setColor(colour)
    .setTitle(state === 'running' ? `🎯  Hunt: ${hunt.targetName}` : `🎯  Hunt over`)
    .setDescription(
      state === 'caught'
        ? `**${killer}** killed **${hunt.targetName}**` +
          (hunt.targetSpecies ? ` *(${hunt.targetSpecies})*` : '') + ' and takes ' +
          `**${hunt.reward}** points` +
          (hunt.skin ? ` and the **${hunt.skin}** skin` : '') + '.'
        : state === 'survived'
          ? `**${hunt.targetName}** survived. Nobody wins.\n\n` +
            'It has to be a player kill — drowning, starving or wildlife ' +
            'leaves nobody to pay.'
          : `**${hunt.targetName}** is the target` +
            (hunt.targetSpecies ? `, playing **${hunt.targetSpecies}**` : '') +
            '.\n\n' +
            `🏆 **${hunt.reward}** points` +
            (hunt.skin ? ` and the **${hunt.skin}** skin` : '') +
            ' to whoever kills them.\n' +
            `📢 Their position is called out every ` +
            `**${Math.round(hunt.revealEveryMs / 60000)} minutes**.\n` +
            `⏳ Ends <t:${Math.floor(hunt.endsAt / 1000)}:R>.`,
    )
    .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
    .setTimestamp();
}

export interface HuntStatus {
  /** Null when the server would not say, which is not the same as absent. */
  online: boolean;
  x?: number;
  y?: number;
  species?: string;
  /** How far the nearest hunter is, in HUD units, excluding the quarry. */
  nearest: number | null;
  /** How many are barred from claiming because they were stood with the quarry. */
  companyCount: number;
}

/**
 * The live staff view, which answers the question the card is opened for:
 * is this working, and does it need a nudge.
 *
 * The static card says what the hunt IS. During a hunt what matters is whether
 * the quarry is even on the island, and whether anybody is anywhere near them.
 */
export function buildHuntStatusEmbed(hunt: Hunt, status: HuntStatus): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(status.online ? 0xfee75c : 0xed4245)
    .setTitle(`🎯  Hunt: ${hunt.targetName}`)
    .setDescription(status.online
      ? `Playing **${status.species ?? hunt.targetSpecies ?? 'something'}**, `
        + `worth **${hunt.reward}** points`
        + (hunt.skin ? ` and the **${hunt.skin}** skin` : '') + '.'
      : '**Not on the island right now.** No position calls go out while they '
        + 'are away, and the clock keeps running.')
    .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
    .setTimestamp();

  embed.addFields(
    { name: 'Ends', value: `<t:${Math.floor(hunt.endsAt / 1000)}:R>`, inline: true },
    {
      name: 'Next call',
      value: `<t:${Math.floor((hunt.lastRevealAt + hunt.revealEveryMs) / 1000)}:R>`,
      inline: true,
    },
    {
      name: 'Barred',
      value: status.companyCount === 0
        ? 'nobody'
        : `**${status.companyCount}**
-# stood with them at the start`,
      inline: true,
    },
  );

  if (status.online) {
    embed.addFields({
      name: 'Where',
      value: status.x !== undefined && status.y !== undefined
        ? `Lat **${hud(status.y)}**, Long **${hud(status.x)}**`
        : 'The server would not say.',
      inline: true,
    });

    embed.addFields({
      name: 'Nearest hunter',
      value: status.nearest === null
        ? 'Nobody else is locatable.'
        : `**${Math.round(status.nearest)}** away`
          + (status.nearest <= 8 ? '\n-# right on top of them' : ''),
      inline: true,
    });
  }

  return embed;
}

export interface ProximityNotice {
  steam: string;
  text: string;
}

export interface ProximityStep {
  hunt: Hunt;
  notices: ProximityNotice[];
}

/**
 * Who is close enough to be told so, and what they are told.
 *
 * Both sides get a notice. Telling only the hunters makes the quarry a sitting
 * target who never knows to run; telling only the quarry makes the hunters
 * wander. The pair of them is what turns a coordinate into a chase.
 *
 * Pure, and it only speaks on a change of band — including the change to "no
 * longer close", which is how somebody knows they have lost the trail.
 */
/**
 * How close counts as travelling with somebody, in HUD units.
 *
 * The "you are close" band. Tighter than that and a group spread over a
 * clearing is missed; wider and half the server is somebody's company.
 */
export const COMPANY_WITHIN = 20;

/**
 * Who is standing with the quarry right now.
 *
 * Pure, and taken once at the start rather than tracked: after the hunt is
 * announced, somebody approaching the quarry is exactly what a hunter does, so
 * there is no way to tell a late-joining friend from a hunter closing in. The
 * snapshot only claims to catch the people who were already there.
 */
export function companyOf(targetSteam: string, players: PlayerRow[]): string[] {
  const target = players.find((p) => p.steam === targetSteam);
  if (!target || target.x === undefined || target.y === undefined) return [];

  const near: string[] = [];
  for (const player of players) {
    if (!player.steam || player.steam === targetSteam) continue;
    if (player.x === undefined || player.y === undefined) continue;

    if (Math.hypot(player.x - target.x, player.y - target.y) / 1000 <= COMPANY_WITHIN) {
      near.push(player.steam);
    }
  }
  return near;
}

export function proximityStep(hunt: Hunt, players: PlayerRow[]): ProximityStep {
  const target = players.find((p) => p.steam === hunt.targetSteam);
  const bands = { ...(hunt.bands ?? {}) };
  const chased = [...(hunt.chased ?? [])];
  const notices: ProximityNotice[] = [];

  if (!target || target.x === undefined || target.y === undefined) {
    // Unlocatable: nothing can be said about distance, and the bands are
    // cleared so coming back into view speaks again rather than staying silent.
    return { hunt: { ...hunt, bands: {} }, notices };
  }

  // The nearest hunter, so the quarry is warned once rather than once per
  // person chasing them.
  let closest = Number.POSITIVE_INFINITY;

  for (const player of players) {
    if (!player.steam || player.steam === hunt.targetSteam) continue;
    if (player.x === undefined || player.y === undefined) continue;

    const away = Math.hypot(player.x - target.x, player.y - target.y) / 1000;
    const band = BANDS.findIndex((b) => away <= b.within);
    const was = bands[player.steam] ?? -1;

    if (band >= 0 && away < closest) closest = away;

    if (band === was) continue;

    if (band < 0) {
      delete bands[player.steam];
      // Only worth saying to somebody who had been told they were close.
      if (was >= 0) {
        notices.push({ steam: player.steam, text: `HUNT: you have lost ${hunt.targetName}.` });
      }
      continue;
    }

    bands[player.steam] = band;
    if (!chased.includes(player.steam)) chased.push(player.steam);

    // Only on the way in. Drifting from "close" back to "warm" already says
    // enough by not saying "right on top of them" any more.
    // The innermost band says nothing. Being told "you are right on top of
    // them" replaces looking: hunters stop searching and start reading the
    // notice, and a quarry hiding in cover ten metres away is found by the HUD
    // rather than by anybody's eyes. The last stretch is meant to be visual.
    if (band > 0 && (was < 0 || band < was)) {
      // A bearing from where this hunter is standing, in the same shape the
      // drop uses. A distance alone says how far without saying which way,
      // which is the half that matters while searching.
      notices.push({
        steam: player.steam,
        text: `HUNT: the scent is ${bearingWord(target.x - player.x, target.y - player.y)}`
          + `, ${distanceWord(away, 3, 'them')}`,
      });
    }
  }

  // The quarry is told nothing. They were warned before, on the reasoning that
  // somebody who cannot tell they are being closed on cannot run, but in play
  // it hands them a proximity alarm the hunters have no answer to: they simply
  // leave every time the warning fires, and the hunt never resolves. Being
  // hunted should feel like not knowing.
  delete bands[hunt.targetSteam];

  return { hunt: { ...hunt, bands, chased }, notices };
}

/**
 * A tenth of the prize, for turning up and actually chasing.
 *
 * Small on purpose. It should be worth logging in for and never worth more than
 * winning, and a share that scales with the reward means a bigger hunt pays its
 * also-rans more without anybody having to set a second number.
 */
export const PARTICIPATION_SHARE = 0.1;

/** Never less than this, so a small hunt still pays something meaningful. */
export const PARTICIPATION_MIN = 50;

export const participationAward = (reward: number): number =>
  Math.max(PARTICIPATION_MIN, Math.round(reward * PARTICIPATION_SHARE));

/**
 * Who gets the consolation, and how much.
 *
 * Pure, so the exclusions can be read at a glance and tested. Three people are
 * left out, each for a different reason:
 *
 *   * **the winner**, who has the whole prize already;
 *   * **the quarry**, who was not chasing anybody;
 *   * **the quarry's company**, who are barred from profiting from this hunt at
 *     all, which is the entire point of recording them.
 */
export function participants(
  hunt: Hunt,
  winnerSteam?: string,
): Array<{ steam: string; amount: number }> {
  const amount = participationAward(hunt.reward);
  const barred = new Set(hunt.company ?? []);

  return (hunt.chased ?? [])
    .filter((steam) => steam !== hunt.targetSteam
      && steam !== winnerSteam
      && !barred.has(steam))
    .map((steam) => ({ steam, amount }));
}

/** Pays them, and reports how many so it can be announced. */
export function payParticipants(
  ctx: Ctx,
  hunt: Hunt,
  winnerSteam?: string,
): { paid: number; each: number } {
  const owed = participants(hunt, winnerSteam);
  for (const row of owed) ctx.db.addPoints(row.steam, row.amount, 0);

  return { paid: owed.length, each: participationAward(hunt.reward) };
}

export const chasedAnnounce = (paid: number, each: number): string =>
  `HUNT: ${paid} hunter${paid === 1 ? '' : 's'} took part and get ${each} points each.`;

const CHANNEL_KEY = 'hunt_channel';

export const huntChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(CHANNEL_KEY) || null;

export const setHuntChannel = (ctx: Ctx, channelId: string | null): void =>
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');

/**
 * Pays the killer and ends it.
 *
 * Called from the kill handler rather than the poll: a death is an event, and
 * looking for it in a snapshot of who is alive would miss anybody who died and
 * respawned between two readings.
 *
 * Returns the hunt that was ended, or null when this kill had nothing to do
 * with one.
 */
export type HuntClaim =
  /** Somebody earned it. */
  | { kind: 'paid'; hunt: Hunt }
  /** Killed by their own company, so it ends and nobody is paid. */
  | { kind: 'collusion'; hunt: Hunt };

export function claimHunt(
  ctx: Ctx,
  killerSteam: string,
  victimSteam: string,
): HuntClaim | null {
  const hunt = activeHunt(ctx);
  if (!hunt || victimSteam !== hunt.targetSteam) return null;

  // The quarry killing themselves, by slay or otherwise, is not a win for
  // anybody. Nor is it a survival — it just ends.
  if (!killerSteam || killerSteam === hunt.targetSteam) {
    saveHunt(ctx, null);
    return null;
  }

  // The quarry's own group cannot collect on them. Paying here would make the
  // reliable way to win "be friends with the target", which is not a hunt and
  // would quietly become the only way anybody plays it.
  if (hunt.company?.includes(killerSteam)) {
    saveHunt(ctx, null);
    return { kind: 'collusion', hunt };
  }

  ctx.db.addPoints(killerSteam, hunt.reward, 0);
  if (hunt.skin) ctx.db.grantSkin(killerSteam, hunt.skin, `Won the hunt for ${hunt.targetName}`);
  saveHunt(ctx, null);

  return { kind: 'paid', hunt };
}

/**
 * Marks a reveal as done, so the timer advances even if announcing fails.
 *
 * The species is refreshed at the same time: it is only knowable while they are
 * locatable, and this is the one moment we know they were.
 */
export const markRevealed = (
  ctx: Ctx,
  hunt: Hunt,
  now: number,
  species?: string,
): void =>
  saveHunt(ctx, {
    ...hunt,
    lastRevealAt: now,
    ...(species ? { targetSpecies: species } : {}),
  });
