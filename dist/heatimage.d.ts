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
 * `data/` because that directory already exists on the host and is already
 * where the bot keeps its own files, and the bot root because that is where
 * somebody uploading through a file manager tends to drop things.
 */
export declare const SEARCH_DIRS: string[];
export declare const DEFAULT_PATHS: string[];
/**
 * Every image the bot can see that looks like a map, and everything else in
 * those directories — so a failure can say what it actually found rather than
 * only that it found nothing.
 */
export declare function findMaps(): Promise<{
    maps: string[];
    sawInstead: string[];
}>;
/**
 * The map picture: a file on the host, or a link, or nothing.
 *
 * `source` empty means look in the default places. A value containing `://` is
 * fetched; anything else is read as a path relative to where the bot runs.
 */
export declare function baseImage(source: string): Promise<Buffer | null>;
/**
 * What a file actually is, from its first bytes.
 *
 * The extension is not evidence. A picture saved from a browser as `map.png`
 * is very often a WebP, jimp reads the bytes rather than the name, and refuses
 * it — which surfaced as "no map" with nothing pointing at the real cause.
 * Naming the true format turns that into a one-line fix.
 */
export declare function sniffFormat(data: Buffer): string;
/** Formats jimp can actually draw on. WebP is readable by neither. */
export declare const SUPPORTED: string[];
/** Whether a buffer is actually an image this can draw on. */
export declare function decodes(data: Buffer): Promise<boolean>;
export declare function forgetBaseImage(): void;
