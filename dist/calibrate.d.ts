import type { Ctx } from './commands.js';
import { type Bounds } from './heatmap.js';
/**
 * Working out what world coordinates the map picture actually covers, by
 * standing somewhere recognisable and reading the position off the server.
 *
 * The alternative was guessing the extent of the world, which put a lone player
 * in a corner and reported coordinates nobody could match to their own screen.
 * A landmark is not a guess: the dome is at a fixed place in the picture, and
 * the mod knows exactly where a player is standing on it.
 *
 * **Each landmark constrains what it can see.** The dome is a point, so it pins
 * both axes. A coastal tip only pins one — standing at the northernmost point
 * of the island says everything about latitude and nothing about where along
 * that coast you were. Treating a tip as a full point is what would silently
 * skew the whole map.
 *
 * Fractions are measured from the picture itself, `data/map.png` as supplied,
 * with the origin at the top left.
 */
export interface Landmark {
    id: string;
    label: string;
    /** Across, 0 at the left edge. Absent when the landmark says nothing about it. */
    fx?: number;
    /** Down, 0 at the top edge. Absent when it says nothing about it. */
    fy?: number;
    hint: string;
}
export declare const LANDMARKS: Landmark[];
export declare const landmarkById: (id: string) => Landmark | undefined;
/** A reading: where somebody stood, and which landmark they stood on. */
export interface Reading {
    id: string;
    x: number;
    y: number;
}
export interface Solved {
    bounds: Bounds | null;
    /** True once both axes were measured rather than assumed. */
    exact: boolean;
    /** Which axes are still working from an assumed width. */
    missing: string[];
}
/**
 * Turns readings into bounds.
 *
 * Solved per axis, because the readings are per axis: two coastal tips north
 * and south settle latitude while telling you nothing about longitude.
 */
export declare function solve(readings: Reading[]): Solved;
export declare function storedReadings(ctx: Ctx): Reading[];
/** Records a reading, replacing any earlier one for the same landmark. */
export declare function recordReading(ctx: Ctx, reading: Reading): Reading[];
export declare function clearReadings(ctx: Ctx): void;
/**
 * Records a reading and, once the readings can settle both axes, saves the
 * bounds they imply.
 *
 * Marked manual, because these came from somebody standing on a real place —
 * the panel must stop widening them towards wherever people happen to walk.
 */
export declare function applyReading(ctx: Ctx, reading: Reading): {
    readings: Reading[];
    bounds: Bounds | null;
    exact: boolean;
    needed: Landmark[];
};
/** Which landmarks would finish the job, given what is already recorded. */
export declare function stillNeeded(readings: Reading[]): Landmark[];
