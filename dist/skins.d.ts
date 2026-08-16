/**
 * Skin colours.
 *
 * Two things matter here and both are easy to get wrong:
 *
 * 1. The engine stores `FLinearColor`, but every colour picker on earth gives
 *    you sRGB hex. Writing hex straight through produces washed-out, too-bright
 *    dinosaurs — the conversion is not optional.
 * 2. Colours are runtime state. Upstream is explicit: direct-write skins revert
 *    on relog, and persistence is the mod's problem, not the engine's.
 */
/** The ten colour fields on FCustomizerDataBase, as of 0.21.720. */
export declare const PARTS: Array<{
    field: string;
    label: string;
}>;
/** A starting palette, so nobody has to invent hex codes to get something decent. */
export declare const PRESETS: Array<{
    name: string;
    hex: string;
}>;
export interface Rgb {
    r: number;
    g: number;
    b: number;
}
/** Accepts `#RGB`, `#RRGGBB`, with or without the hash. */
export declare function parseHex(input: string): Rgb | null;
/**
 * sRGB to linear, the standard piecewise transfer function.
 *
 * Skipping this is the classic mistake: 50% grey picked in any colour picker is
 * 0.5 in sRGB but 0.214 linear, so a naive write lands roughly twice as bright
 * as intended.
 */
export declare function toLinear(channel: number): number;
export declare function hexToLinear(hex: string): Rgb | null;
/** For the embed's colour bar, so the reply shows what was actually applied. */
export declare function hexToInt(hex: string): number | null;
