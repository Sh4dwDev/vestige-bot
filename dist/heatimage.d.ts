import type { Bounds, Point } from './heatmap.js';
/**
 * The heatmap as an actual picture.
 *
 * Density is accumulated first and coloured second, rather than stamping one
 * blob per player. Two people in the same clearing should read hotter than two
 * on opposite coasts, and that only happens if their falloffs add up before
 * anything is drawn.
 *
 * **The map image is supplied by the server owner**, not shipped here. The
 * game's own map is not ours to redistribute, and every community map has its
 * own terms. Drop one at `data/map.png` on the host and it is picked up with no
 * configuration at all; a link works too. Without either, the heat is drawn on
 * a plain grid so the panel still shows something.
 */
export declare const SIZE = 720;
/** World coordinates to pixels. North is up, so Y is flipped. */
export declare function toPixel(point: Point, bounds: Bounds, size?: number): {
    px: number;
    py: number;
};
/**
 * Draws the heat over a base image and returns a PNG.
 *
 * Always returns a picture, including with nobody online: a panel that swaps
 * between an image and a line of text looks broken rather than quiet.
 */
export declare function renderHeatmap(points: Point[], bounds: Bounds | null, base: Buffer | null, size?: number): Promise<Buffer>;
/**
 * Where a map picture is looked for when nothing is configured.
 *
 * Next to the database, because that directory already exists on the host and
 * is already the place the bot keeps its own files. Dropping a picture in is
 * the whole setup — no command, no link, no hosting it anywhere.
 */
export declare const DEFAULT_PATHS: string[];
/**
 * The map picture: a file on the host, or a link, or nothing.
 *
 * `source` empty means look in the default places. A value containing `://` is
 * fetched; anything else is read as a path relative to where the bot runs.
 */
export declare function baseImage(source: string): Promise<Buffer | null>;
export declare function forgetBaseImage(): void;
