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
export declare function startHeatmapPanel(ctx: Ctx, client: Client, log: (m: string) => void): void;
