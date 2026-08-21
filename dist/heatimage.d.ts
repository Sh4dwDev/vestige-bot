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
 * own terms. Point `/setup heatmap image` at whichever one you have the right
 * to use and it is fetched and cached; without one the picture is drawn on a
 * plain grid so the panel still shows something.
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
 * Fetches the configured map picture, once.
 *
 * Cached by URL: this runs every few minutes forever, and re-downloading a
 * megabyte each time to draw a dozen dots on it would be rude to whoever is
 * hosting the image.
 */
export declare function baseImage(url: string): Promise<Buffer | null>;
export declare function forgetBaseImage(): void;
