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
/** The picture, in world coordinates. */
export declare const DEFAULT_BOUNDS: Bounds;
/**
 * The bounds actually used to draw.
 *
 * Manual wins, and otherwise the fallback is used rather than what the panel
 * has learned — which is the opposite of what it did at first, and the reason
 * is the ocean.
 *
 * Learned bounds track where **people walk**, so they converge on the outline
 * of the island. The map picture is the island *plus the sea around it*.
 * Stretching one onto the other pushes anybody near a coast off the edge, and
 * it drifts every time somebody swims somewhere new. The fallback at least
 * models the same thing the picture does: a fixed square centred on the origin.
 *
 * Learned bounds are still kept, because they are the honest record of where
 * the playable area actually is, and they are what a proper calibration would
 * be built from.
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
/**
 * The busiest places, in the coordinates the players are actually standing on.
 *
 * This used to reconstruct a position by inverting the grid maths — cell index
 * back to a fraction, fraction back through the bounds. That was wrong twice
 * over: it reported the middle of a cell rather than where anybody was, and it
 * inherited every error in the bounds, so a guessed extent produced confidently
 * wrong coordinates. A player at Lat -143,646 was reported at Lat 25.
 *
 * The mod already sends exact positions. Averaging the real ones in a cluster
 * is both simpler and correct however wrong the bounds happen to be, because it
 * never converts anything.
 */
export declare function hotspots(points: Point[], bounds: Bounds, limit?: number): Array<{
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
