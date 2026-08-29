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
}
/**
 * How precise each hint is, in HUD units.
 *
 * The first is deliberately useless on its own: a 200 unit square is a quarter
 * of the island, and the point of it is to get people moving in roughly the
 * right direction while they still have to search. The last one is tight
 * enough that anybody standing in it can find the drop by looking around.
 */
export declare const HINT_PRECISION: readonly [200, 100, 50, 25];
/** Gap between hints. Long enough to travel, short enough to keep interest. */
export declare const HINT_EVERY_MS = 150000;
export declare const activeDrop: (ctx: Ctx) => Drop | null;
export declare const saveDrop: (ctx: Ctx, drop: Drop | null) => void;
export declare const dropChannel: (ctx: Ctx) => string | null;
export declare const setDropChannel: (ctx: Ctx, channelId: string | null) => void;
/**
 * Where the drop lands.
 *
 * Between two players who are actually online, rather than anywhere on the map.
 * A random point risks the sea, a cliff, or the far corner nobody plays in, and
 * an event whose prize cannot be reached is worse than no event. Halfway
 * between two living dinosaurs is terrain somebody just walked across.
 *
 * With one player online it is offset from them instead, far enough to be a
 * journey and near enough to be their half of the island.
 *
 * Pure, given the random source, so the awkward cases can be tested.
 */
export declare function placeDrop(players: PlayerRow[], random?: () => number): {
    x: number;
    y: number;
} | null;
/** Rounds a coordinate to a precision, so a hint names an area and not a spot. */
export declare const blur: (value: number, precision: number) => number;
/**
 * A hint, written as the area it is in.
 *
 * The number is the middle of a square this wide, which is stated outright.
 * Leaving people to work out how much slack a rounded coordinate carries is how
 * a search turns into an argument.
 */
export declare function hintText(drop: Drop, index: number): string;
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
/** Pays the finder and clears it. */
export declare function claimDrop(ctx: Ctx, drop: Drop, steamId: string): void;
