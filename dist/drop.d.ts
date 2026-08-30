import { EmbedBuilder } from 'discord.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
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
export declare const HINT_PRECISION: readonly [200, 100, 50, 20];
/** Gap between hints. Long enough to travel, short enough to keep interest. */
export declare const HINT_EVERY_MS = 150000;
export declare const activeDrop: (ctx: Ctx) => Drop | null;
export declare const saveDrop: (ctx: Ctx, drop: Drop | null) => void;
export declare const dropChannel: (ctx: Ctx) => string | null;
export declare const setDropChannel: (ctx: Ctx, channelId: string | null) => void;
export interface Ground {
    x: number;
    y: number;
    z: number;
    /** When somebody was last seen standing here. */
    at: number;
}
/** Fed from the player poll. Cheap, and pure apart from the array it fills. */
export declare function rememberGround(players: PlayerRow[], now?: number): void;
/** Test seam, and used when the bot restarts mid-event. */
export declare const knownGround: () => Ground[];
export declare const forgetGround: () => void;
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
export declare function placeDrop(players: PlayerRow[], random?: () => number, banked?: Ground[]): {
    x: number;
    y: number;
    z?: number;
} | null;
/** Rounds a coordinate to a precision, so a hint names an area and not a spot. */
export declare const blur: (value: number, precision: number) => number;
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
export declare function hintText(drop: Drop, index: number): string;
/**
 * Which way the drop lies from a point, in words.
 *
 * `dx` is east-positive and `dy` is south-positive, matching the game's own
 * Lat and Long, so north is `-dy`.
 */
export declare function bearingWord(dx: number, dy: number): string;
/**
 * How far, in words, sharpening as the hints go on.
 *
 * Early hints give a bearing and almost nothing else, so people commit to a
 * direction and still have to search. The last one says plainly that it is
 * within sight, because by then the point is to be found rather than hunted.
 */
export declare function distanceWord(units: number, stage: number, subject?: string): string;
/**
 * What one player is told, from where they are standing.
 *
 * Personal rather than server-wide, which is the whole point: a bearing means
 * something to the person it was worked out for, and nothing to anybody else.
 * It also needs no map reading, no coordinates and no arithmetic, which is what
 * the numbers version asked of everybody.
 */
export declare function scentLine(drop: Drop, player: PlayerRow, stage: number): string | null;
export type DropStep = {
    kind: 'waiting';
} | {
    kind: 'hint';
    drop: Drop;
    text: string;
} | {
    kind: 'found';
    steam: string;
    drop: Drop;
} | {
    kind: 'expired';
    drop: Drop;
};
/**
 * One pass: has anybody reached it, is a hint due, is it over.
 *
 * Pure. The caller saves and announces, which keeps the rules testable without
 * a game server or a Discord client.
 */
export declare function dropStep(drop: Drop, players: PlayerRow[], now: number): DropStep;
/**
 * Who has just come close enough to be told so, and the updated drop.
 *
 * Once each, and only for the last stretch. A running commentary would take the
 * searching out of it, and the notice is there to tell somebody their next
 * thirty seconds matter, not to walk them in.
 */
export declare function warming(drop: Drop, players: PlayerRow[]): {
    drop: Drop;
    steam: string[];
};
export declare const dropAnnounce: (drop: Drop) => string;
/**
 * Kept for the staff channel, where an exact box is useful and nobody is
 * playing. Players never see coordinates: they get a bearing from where they
 * are standing, which needs no map and no arithmetic.
 */
export declare const hintAnnounce: (text: string) => string;
export declare const foundAnnounce: (who: string, drop: Drop) => string;
export declare const expiredAnnounce: () => string;
/** The on-screen notice for somebody who has come close. */
export declare const warmNotice: () => string;
export declare function buildDropEmbed(drop: Drop, hint: string): EmbedBuilder;
/**
 * The staff view, which exists to answer one question: does this need a nudge?
 *
 * So it says how close the nearest person actually is in the same units the
 * game's own HUD uses, what "close" would be, and when the next hint lands. The
 * first version reported "1 hint(s) given" and "295 away" without ever saying
 * away in what, which is three facts and no answer.
 */
export declare function buildDropStatusEmbed(drop: Drop, nearest: number | null): EmbedBuilder;
/**
 * How close the nearest hunter is, and what that means.
 *
 * A bare distance is only meaningful against the radius, so both are given, and
 * the verdict says the thing a number cannot: whether anybody is actually on to
 * it or whether the whole server is looking in the wrong place.
 */
export declare function nearestLine(drop: Drop, nearest: number | null): string;
export declare function buildDropOverEmbed(drop: Drop, winner: string | null): EmbedBuilder;
/**
 * Starts one, or says why not.
 *
 * Refuses with nobody online rather than dropping it into an empty island: the
 * location comes from where people actually are, and a drop nobody is there to
 * hunt is just a number in the database.
 */
export declare function startDrop(ctx: Ctx, players: PlayerRow[], options: {
    reward: number;
    minutes: number;
    radius: number;
    skin?: string;
}, now?: number, random?: () => number): {
    ok: true;
    drop: Drop;
} | {
    ok: false;
    reason: string;
};
/**
 * What gets left on the ground where the drop is.
 *
 * A nest mound, because it is the one thing this mod is proven able to spawn:
 * the verb guards every step, including the wrapper that survives the call
 * while holding a null pointer, which is the failure that looks like success.
 * Nothing else here has earned that trust, and two crashes came from finding
 * out the hard way.
 */
export declare const MARKER_CLASS = "BP_Nest_Mound_Large_H_C";
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
export declare function markDrop(ctx: Ctx, drop: Drop): Promise<boolean>;
/** Pays the finder and clears it. */
export declare function claimDrop(ctx: Ctx, drop: Drop, steamId: string): void;
