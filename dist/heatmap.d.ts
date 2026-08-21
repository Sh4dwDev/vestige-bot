import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './bridge.js';
export declare const HEATMAP_MESSAGE_KEY = "heatmap_message";
export declare const DEFAULT_MINUTES = 5;
/** Wide enough to see clusters, narrow enough to read on a phone. */
export declare const COLS = 24;
export declare const ROWS = 12;
export interface Bounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}
export interface Point {
    x: number;
    y: number;
}
export declare function setHeatmapChannel(ctx: Ctx, channelId: string | null): void;
export declare function heatmapChannel(ctx: Ctx): string | null;
export declare function heatmapMinutes(ctx: Ctx): number;
export declare function setHeatmapMinutes(ctx: Ctx, minutes: number): void;
export declare function heatmapImageUrl(ctx: Ctx): string;
export declare function setHeatmapImage(ctx: Ctx, url: string | null): void;
/**
 * Bounds an admin set by hand, in the Lat/Long the game shows.
 *
 * Self-calibration is fine for a bare grid, but it cannot line up with a real
 * map picture: the corners of the image are fixed and the learned bounds are
 * whatever people happened to walk to. Setting them makes the dots land in the
 * right place.
 */
export declare function setManualBounds(ctx: Ctx, latMin: number, latMax: number, longMin: number, longMax: number): Bounds;
export declare function boundsAreManual(ctx: Ctx): boolean;
export declare function storedBounds(ctx: Ctx): Bounds | null;
export declare function saveBounds(ctx: Ctx, bounds: Bounds): void;
export declare function resetBounds(ctx: Ctx): void;
/**
 * The island, near enough, until somebody measures it properly.
 *
 * Nobody publishes the extent of Isle V3. What is known: positions read
 * negative and reach into the hundreds of thousands — a live reading here was
 * `x=-44465 y=-143643`, and a documented landmark sits at `-396757` — so the
 * world is centred on the origin and runs to roughly ±400,000 units, which is
 * ±400 in the Lat/Long the HUD shows.
 *
 * A guess, and said out loud as one. But it is a guess that puts somebody in
 * the south-west in the south-west, which is worth far more than bounds
 * "learned" from one player standing still — those collapse to a box a few
 * metres wide, and then that player IS the corner of it. That is what put a
 * lone dot in the bottom-left of the picture.
 */
export declare const DEFAULT_BOUNDS: Bounds;
/**
 * The bounds actually used to draw.
 *
 * Manual always wins — somebody who lined the corners up to their own picture
 * means it. Otherwise learned bounds are only trusted once they cover enough
 * ground to be a map rather than a huddle.
 */
export declare function effectiveBounds(ctx: Ctx, learned: Bounds | null): Bounds;
/**
 * Widens known bounds to include everything just seen.
 *
 * Only ever grows. Shrinking to fit whoever happens to be online would make the
 * grid mean something different every refresh, and a panel whose axes move is
 * not a map of anything.
 */
export declare function widen(bounds: Bounds | null, points: Point[]): Bounds | null;
/** Counts per cell, row 0 being the top of the rendered grid. */
export declare function grid(points: Point[], bounds: Bounds): number[][];
/** The grid as a monospace block, scaled so the busiest cell is the darkest. */
export declare function render(cells: number[][]): string;
/** The busiest cells, described in coordinates somebody can actually go to. */
export declare function hotspots(cells: number[][], bounds: Bounds, limit?: number): Array<{
    lat: string;
    long: string;
    count: number;
}>;
export declare function buildHeatmapEmbed(points: Point[], bounds: Bounds | null, options?: {
    unreachable?: boolean;
    minutes?: number;
}): EmbedBuilder;
/** Positions from the mod, skipping anyone whose pawn would not give one. */
export declare function pointsFrom(players: PlayerRow[]): Point[];
/** Anything named like a map, beside the mod on the game server. */
export declare const SERVER_MAP_MATCH: RegExp;
/**
 * The map picture, from wherever it actually is.
 *
 * Three places, in order: whatever an admin configured, a file on the bot host,
 * then the mod directory on the **game** server. The last one matters because
 * the bot and the game run on different hosts, and the game host is the one
 * whose file manager people already have open.
 */
export declare function resolveMapImage(ctx: Ctx): Promise<Buffer | null>;
export declare function startHeatmapPanel(ctx: Ctx, client: Client, log: (m: string) => void): void;
