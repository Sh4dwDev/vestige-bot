import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
import { distance, hud } from './contest.js';

/**
 * The Drop: something died out there, and the first one to reach it takes it.
 *
 * Built for a server with a handful of people on it. Every other event here
 * needs a crowd to be worth running — a contest with six players means five
 * wasted evenings, and an endangered bonus needs a population to be scarce
 * within. **A race needs two people to be a race**, and the winner is whoever
 * turns up first, so nobody who logs in has wasted the trip.
 *
 * The hook is the hints. The location is never announced outright: it starts as
 * a quarter of the island and narrows every couple of minutes until somebody
 * finds it. That turns "go to these coordinates" into a search that people
 * talk to each other during, which is the actual point of running an event on a
 * quiet night.
 *
 * Nothing here spawns anything in the world. The drop is a point on the map the
 * bot remembers, which means it cannot fail the way spawning an actor can, and
 * the two crashes on 2026-08-23 are a good enough reason to keep it that way.
 */

const KEY = 'drop_state';
const CHANNEL_KEY = 'drop_channel';

export interface Drop {
  /** World units, the same frame the mod reports positions in. */
  x: number;
  y: number;
  /** How close counts as finding it, in world units. */
  radius: number;
  reward: number;
  /** A skin the finder also keeps, if one was offered. */
  skin?: string;
  startedAt: number;
  endsAt: number;
  /** How many hints have gone out, so the next one is sharper. */
  hintsGiven: number;
  /** When the last hint went out, so they are spaced rather than bunched. */
  lastHintAt: number;
  /** Who has already been told they are close, so it is said once. */
  warmed?: string[];
  /** Ground height, when the spot came from somewhere a dinosaur stood. */
  z?: number;
  /** Whether a marker was actually spawned, so the copy can be honest. */
  marked?: boolean;
}

/**
 * How precise each hint is, in HUD units.
 *
 * The first is deliberately useless on its own: a 200 unit square is a quarter
 * of the island, and the point of it is to get people moving in roughly the
 * right direction while they still have to search. The last one is tight
 * enough that anybody standing in it can find the drop by looking around.
 *
 * All even, so that half of one is still a whole number. The HUD shows whole
 * coordinates, and a hint reading "Lat 387.5 to 412.5" is a hint written for a
 * spreadsheet rather than for somebody looking at their screen.
 */
export const HINT_PRECISION = [200, 100, 50, 20] as const;

/** Gap between hints. Long enough to travel, short enough to keep interest. */
export const HINT_EVERY_MS = 150_000;

export const activeDrop = (ctx: Ctx): Drop | null => {
  const raw = ctx.db.getSetting(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Drop;
  } catch {
    return null;
  }
};

export const saveDrop = (ctx: Ctx, drop: Drop | null): void =>
  ctx.db.setSetting(KEY, drop ? JSON.stringify(drop) : '');

export const dropChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(CHANNEL_KEY) || null;

export const setDropChannel = (ctx: Ctx, channelId: string | null): void =>
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');

export interface Ground {
  x: number;
  y: number;
  z: number;
  /** When somebody was last seen standing here. */
  at: number;
}

/**
 * Places dinosaurs have actually stood, kept so something can be spawned there.
 *
 * There is no way to ask the engine what the ground height is at an arbitrary
 * point. The trace people reach for does not exist in this build, and a spawn
 * at a guessed height is a mound buried in a hillside or hovering over a
 * valley. A position a pawn was standing in is the one height that is known to
 * be right, so those are banked as they go past.
 *
 * In memory rather than in the database: it is a hint about terrain, not a
 * fact worth keeping, and a bot that has just started simply places drops the
 * old way until it has watched people walk about for a few minutes.
 */
const ground: Ground[] = [];

/** Enough to cover an evening's roaming without growing without bound. */
const GROUND_LIMIT = 400;

/** Two samples closer than this are the same place for our purposes. */
const GROUND_SPACING = 40_000;

/** Fed from the player poll. Cheap, and pure apart from the array it fills. */
export function rememberGround(players: PlayerRow[], now = Date.now()): void {
  for (const player of players) {
    if (player.x === undefined || player.y === undefined || player.z === undefined) continue;

    const near = ground.some((g) =>
      Math.hypot(g.x - player.x!, g.y - player.y!) < GROUND_SPACING);
    if (near) continue;

    ground.push({ x: player.x, y: player.y, z: player.z, at: now });
    if (ground.length > GROUND_LIMIT) ground.shift();
  }
}

/** Test seam, and used when the bot restarts mid-event. */
export const knownGround = (): Ground[] => [...ground];
export const forgetGround = (): void => { ground.length = 0; };

/**
 * Where the drop lands.
 *
 * Preferring somewhere a dinosaur has stood, and far enough from everybody
 * playing right now that nobody is already on it. That gives a real ground
 * height, which is the only way anything can be spawned to mark the spot.
 *
 * Falls back to the old midpoint when nothing has been banked yet, which
 * happens for the first few minutes after a restart. The drop still works, it
 * just has nothing visible on it.
 *
 * Pure, given the random source and the banked ground, so the awkward cases can
 * be tested.
 */
export function placeDrop(
  players: PlayerRow[],
  random: () => number = Math.random,
  banked: Ground[] = ground,
): { x: number; y: number; z?: number } | null {
  const located = players.filter(
    (p): p is PlayerRow & { x: number; y: number } =>
      p.x !== undefined && p.y !== undefined,
  );
  if (located.length === 0) return null;

  // Somewhere people go, but not where they are. A drop under somebody's feet
  // is not a race.
  const away = banked.filter((g) =>
    located.every((p) => Math.hypot(g.x - p.x, g.y - p.y) > MIN_START_DISTANCE));

  if (away.length > 0) {
    const pick = away[Math.floor(random() * away.length)];
    if (pick) return { x: pick.x, y: pick.y, z: pick.z };
  }

  const first = located[Math.floor(random() * located.length)];
  if (!first) return null;

  if (located.length === 1) {
    // A lap of a few hundred metres in a random direction.
    const angle = random() * Math.PI * 2;
    const distance = 250_000 + (random() * 250_000);
    return { x: first.x + (Math.cos(angle) * distance), y: first.y + (Math.sin(angle) * distance) };
  }

  const others = located.filter((p) => p !== first);
  const second = others[Math.floor(random() * others.length)] ?? first;

  // Not exactly the midpoint: two people who can see each other would otherwise
  // both be standing on it already.
  const jitter = (): number => (random() - 0.5) * 120_000;
  return {
    x: ((first.x + second.x) / 2) + jitter(),
    y: ((first.y + second.y) / 2) + jitter(),
  };
}

/** How far a banked spot must be from everybody online to be worth using. */
const MIN_START_DISTANCE = 150_000;

/** Rounds a coordinate to a precision, so a hint names an area and not a spot. */
export const blur = (value: number, precision: number): number =>
  Math.round(hud(value) / precision) * precision;

/**
 * A hint, written as the box to search.
 *
 * Given as a range rather than a centre and a tolerance. "Within 200 of Lat 400"
 * was both unclear and wrong: rounding to the nearest 200 puts the real spot
 * within a hundred either side, not two hundred, so it overstated the area by
 * double and still left the reader doing arithmetic against their HUD.
 *
 * A range needs no working out. The numbers are the same ones the game's own
 * position readout shows, so it is read straight off the screen.
 */
export function hintText(drop: Drop, index: number): string {
  const precision = HINT_PRECISION[Math.min(index, HINT_PRECISION.length - 1)]
    ?? HINT_PRECISION[HINT_PRECISION.length - 1] as number;

  // Rounded as well as halved: the ladder is even so this is exact, but a
  // fractional bound would be nonsense against a HUD that shows whole numbers.
  const half = Math.round(precision / 2);
  const lat = blur(drop.y, precision);
  const long = blur(drop.x, precision);

  return `Lat ${lat - half} to ${lat + half}, Long ${long - half} to ${long + half}`;
}

/**
 * The eight points, in the order `atan2` produces them.
 *
 * **North is a smaller Lat.** The world's Y grows southward, which is measured
 * and documented in `heatimage.ts`, and getting it backwards is a bug that
 * survived every other fix there because it is invisible while nobody moves.
 * Here it would be worse than invisible: it would send the whole server the
 * wrong way with confidence.
 */
const COMPASS = [
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west',
] as const;

/**
 * Which way the drop lies from a point, in words.
 *
 * `dx` is east-positive and `dy` is south-positive, matching the game's own
 * Lat and Long, so north is `-dy`.
 */
export function bearingWord(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'right here';

  const angle = Math.atan2(dx, -dy);
  const step = Math.round((angle / (Math.PI * 2)) * 8);
  return COMPASS[((step % 8) + 8) % 8] ?? 'north';
}

/**
 * How far, in words, sharpening as the hints go on.
 *
 * Early hints give a bearing and almost nothing else, so people commit to a
 * direction and still have to search. The last one says plainly that it is
 * within sight, because by then the point is to be found rather than hunted.
 */
export function distanceWord(units: number, stage: number, subject = 'it'): string {
  if (stage <= 0) return '';
  if (units > 400) return 'a very long way off';
  if (units > 200) return 'a long way off';
  if (units > 100) return stage >= 2 ? 'some way off' : 'a long way off';
  if (units > 40) return 'not far';
  if (units > 15) return 'close';
  // The subject is a parameter because the hunt shares this and is chasing a
  // person: "nearly on top of it" reads as a thing, and the quarry is not one.
  return `nearly on top of ${subject}`;
}

/**
 * What one player is told, from where they are standing.
 *
 * Personal rather than server-wide, which is the whole point: a bearing means
 * something to the person it was worked out for, and nothing to anybody else.
 * It also needs no map reading, no coordinates and no arithmetic, which is what
 * the numbers version asked of everybody.
 */
export function scentLine(drop: Drop, player: PlayerRow, stage: number): string | null {
  if (player.x === undefined || player.y === undefined) return null;

  const dx = drop.x - player.x;
  const dy = drop.y - player.y;
  const away = hud(Math.hypot(dx, dy));

  if (away <= hud(drop.radius)) return 'THE DROP: it is right here. Look around';

  const where = bearingWord(dx, dy);
  const far = distanceWord(away, stage);

  return far
    ? `THE DROP: the scent comes from the ${where}, ${far}`
    : `THE DROP: the scent comes from the ${where}`;
}

export type DropStep =
  | { kind: 'waiting' }
  | { kind: 'hint'; drop: Drop; text: string }
  | { kind: 'found'; steam: string; drop: Drop }
  | { kind: 'expired'; drop: Drop };

/**
 * One pass: has anybody reached it, is a hint due, is it over.
 *
 * Pure. The caller saves and announces, which keeps the rules testable without
 * a game server or a Discord client.
 */
export function dropStep(drop: Drop, players: PlayerRow[], now: number): DropStep {
  // Finding it beats the clock: somebody standing on the drop as the timer
  // runs out has found it, and telling them otherwise would be indefensible.
  for (const player of players) {
    if (!player.steam || player.x === undefined || player.y === undefined) continue;
    if (distance(player.x, player.y, drop.x, drop.y) <= drop.radius) {
      return { kind: 'found', steam: player.steam, drop };
    }
  }

  if (now >= drop.endsAt) return { kind: 'expired', drop };

  const due = drop.lastHintAt + HINT_EVERY_MS;
  if (now >= due && drop.hintsGiven < HINT_PRECISION.length) {
    const next: Drop = { ...drop, hintsGiven: drop.hintsGiven + 1, lastHintAt: now };
    return { kind: 'hint', drop: next, text: hintText(next, next.hintsGiven - 1) };
  }

  return { kind: 'waiting' };
}

/**
 * Who has just come close enough to be told so, and the updated drop.
 *
 * Once each, and only for the last stretch. A running commentary would take the
 * searching out of it, and the notice is there to tell somebody their next
 * thirty seconds matter, not to walk them in.
 */
export function warming(drop: Drop, players: PlayerRow[]): { drop: Drop; steam: string[] } {
  const warmed = new Set(drop.warmed ?? []);
  const fresh: string[] = [];

  for (const player of players) {
    if (!player.steam || player.x === undefined || player.y === undefined) continue;
    if (warmed.has(player.steam)) continue;

    if (distance(player.x, player.y, drop.x, drop.y) <= drop.radius * 3) {
      warmed.add(player.steam);
      fresh.push(player.steam);
    }
  }

  return { drop: { ...drop, warmed: [...warmed] }, steam: fresh };
}

// ------------------------------------------------------------ what is said --

export const dropAnnounce = (drop: Drop): string =>
  (drop.marked
    ? `THE DROP: something died out there. First one to it takes ${drop.reward} points. `
    : `THE DROP: there is a scent on the wind. First one to it takes ${drop.reward} points. `)
  + 'Follow it';

/**
 * Kept for the staff channel, where an exact box is useful and nobody is
 * playing. Players never see coordinates: they get a bearing from where they
 * are standing, which needs no map and no arithmetic.
 */
export const hintAnnounce = (text: string): string => `THE DROP: narrowing. ${text}`;

export const foundAnnounce = (who: string, drop: Drop): string =>
  `THE DROP: ${who} got there first and takes ${drop.reward} points.`;

export const expiredAnnounce = (): string =>
  'THE DROP: nobody found it. The carrion goes to the flies.';

/** The on-screen notice for somebody who has come close. */
export const warmNotice = (): string => 'THE DROP: the scent is strong here. It is close.';

export function buildDropEmbed(drop: Drop, hint: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xd6a03a)
    .setTitle('🩸  The Drop')
    .setDescription(
      `Something died out on the island. **First one to reach it** takes `
      + `**${drop.reward}** points`
      + (drop.skin ? ` and the **${drop.skin}** skin` : '') + '.\n\n'
      + `**${hint}**\n`
      + '-# The area narrows every couple of minutes until somebody finds it.',
    )
    .addFields({
      name: 'Ends',
      value: `<t:${Math.floor(drop.endsAt / 1000)}:R>`,
      inline: true,
    })
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

/**
 * The staff view, which exists to answer one question: does this need a nudge?
 *
 * So it says how close the nearest person actually is in the same units the
 * game's own HUD uses, what "close" would be, and when the next hint lands. The
 * first version reported "1 hint(s) given" and "295 away" without ever saying
 * away in what, which is three facts and no answer.
 */
export function buildDropStatusEmbed(drop: Drop, nearest: number | null): EmbedBuilder {
  const total = HINT_PRECISION.length;
  const nextHintAt = drop.lastHintAt + HINT_EVERY_MS;

  const embed = new EmbedBuilder()
    .setColor(0xd6a03a)
    .setTitle('🩸  The Drop')
    .setDescription(`Hidden at **Lat ${hud(drop.y)}, Long ${hud(drop.x)}**, `
      + `worth **${drop.reward}** points`
      + (drop.skin ? ` and the **${drop.skin}** skin` : '') + '.')
    .setFooter({ text: SIGNATURE })
    .setTimestamp();

  embed.addFields(
    {
      name: 'Ends',
      value: `<t:${Math.floor(drop.endsAt / 1000)}:R>`,
      inline: true,
    },
    {
      name: 'Hints',
      value: drop.hintsGiven >= total
        ? `**${total}** of ${total}
-# as sharp as they get`
        : `**${drop.hintsGiven}** of ${total}
-# next <t:${Math.floor(nextHintAt / 1000)}:R>`,
      inline: true,
    },
    {
      name: 'Nearest player',
      value: nearestLine(drop, nearest),
      inline: false,
    },
  );

  return embed;
}

/**
 * How close the nearest hunter is, and what that means.
 *
 * A bare distance is only meaningful against the radius, so both are given, and
 * the verdict says the thing a number cannot: whether anybody is actually on to
 * it or whether the whole server is looking in the wrong place.
 */
export function nearestLine(drop: Drop, nearest: number | null): string {
  if (nearest === null) return 'Nobody the server can locate is in game right now.';

  const radius = hud(drop.radius);
  const away = Math.round(nearest);

  const verdict = away <= radius
    ? 'standing on it, so it is about to be found'
    : away <= radius * 3
      ? 'close enough to have been told the scent is strong'
      : away <= radius * 10
        ? 'searching the right part of the island'
        : 'nowhere near it';

  return `**${away}** away, and it is found within **${radius}**.
-# ${verdict}`;
}

export function buildDropOverEmbed(
  drop: Drop,
  winner: string | null,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(winner ? 0x57f287 : 0x4f545c)
    .setTitle(winner ? '🩸  Found' : '🩸  Nobody found it')
    .setDescription(winner
      ? `**${winner}** reached it first and takes **${drop.reward}** points`
        + (drop.skin ? ` and the **${drop.skin}** skin` : '') + '.'
      : `It was at Lat **${hud(drop.y)}**, Long **${hud(drop.x)}**. `
        + `Nobody got there in time.`)
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

/**
 * Starts one, or says why not.
 *
 * Refuses with nobody online rather than dropping it into an empty island: the
 * location comes from where people actually are, and a drop nobody is there to
 * hunt is just a number in the database.
 */
export function startDrop(
  ctx: Ctx,
  players: PlayerRow[],
  options: { reward: number; minutes: number; radius: number; skin?: string },
  now = Date.now(),
  random: () => number = Math.random,
): { ok: true; drop: Drop } | { ok: false; reason: string } {
  if (activeDrop(ctx)) {
    return { ok: false, reason: 'There is already a drop out there. Stop it first.' };
  }

  const where = placeDrop(players, random);
  if (!where) {
    return {
      ok: false,
      reason: `Nobody is on ${SERVER} right now, and the drop lands near the people `
        + 'hunting it. Try again when somebody is in game.',
    };
  }

  const drop: Drop = {
    x: where.x,
    y: where.y,
    ...(where.z !== undefined ? { z: where.z } : {}),
    radius: options.radius * 1000,
    reward: options.reward,
    ...(options.skin ? { skin: options.skin } : {}),
    startedAt: now,
    endsAt: now + (options.minutes * 60_000),
    // The opening announcement carries the first hint, so the clock for the
    // second one starts now.
    hintsGiven: 1,
    lastHintAt: now,
  };

  saveDrop(ctx, drop);
  return { ok: true, drop };
}

/**
 * What gets left on the ground where the drop is.
 *
 * A nest mound, because it is the one thing this mod is proven able to spawn:
 * the verb guards every step, including the wrapper that survives the call
 * while holding a null pointer, which is the failure that looks like success.
 * Nothing else here has earned that trust, and two crashes came from finding
 * out the hard way.
 */
export const MARKER_CLASS = 'BP_Nest_Mound_Large_H_C';

/**
 * Puts the marker down, and says whether it worked.
 *
 * Only where the height is known, which means only on a spot a dinosaur has
 * actually stood. Guessing a height gives a mound inside a hillside or floating
 * over a valley, and a marker in the wrong place is worse than none: people
 * would trust it.
 *
 * Never throws. A drop with nothing on it is still a drop.
 */
export async function markDrop(ctx: Ctx, drop: Drop): Promise<boolean> {
  if (drop.z === undefined) return false;

  try {
    const placed = await ctx.mod.run('nest', '', {
      class: MARKER_CLASS,
      x: drop.x,
      y: drop.y,
      z: drop.z,
    }, { quiet: true });
    return placed.ok;
  } catch {
    return false;
  }
}

/** Pays the finder and clears it. */
export function claimDrop(ctx: Ctx, drop: Drop, steamId: string): void {
  ctx.db.addPoints(steamId, drop.reward, 0);
  if (drop.skin) ctx.db.grantSkin(steamId, drop.skin, 'Found the drop');
  saveDrop(ctx, null);
}
