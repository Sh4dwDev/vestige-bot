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
/**
 * Ready-made looks, available to every admin without anyone building one first.
 *
 * Each sets the six parts that read at distance — body, flanks, underbelly,
 * markings, detail and eyes — and leaves teeth, mouth and claws alone, since
 * those are barely visible and recolouring them tends to look wrong rather than
 * striking. A saved preset of the same name wins, so these can be overridden.
 */
export interface Look {
    colours: Record<string, string>;
    /**
     * Pattern index, where the species has one. The pattern changes which parts
     * of the body each colour lands on, so a look is only half-defined without
     * it — the same palette on pattern A and pattern C are different animals.
     *
     * How many a species has is not discoverable. Naming one it does not have
     * simply leaves the pattern alone; the colours still land, because the two
     * are always written separately.
     */
    pattern?: number;
}
export declare const BUILT_IN: Record<string, Look>;
/**
 * Patterns are numbered on the wire and lettered in the game, so the picker
 * speaks letters and the mod speaks numbers.
 */
export declare const patternLetter: (index: number) => string;
/**
 * How many to offer. The real count is **per species** and the game does not
 * tell us, so this is a generous menu — picking one a species does not have
 * simply does nothing visible, which is why patterns are never sent in the same
 * write as colours.
 */
export declare const PATTERN_CHOICES = 8;
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
/** Linear back to sRGB hex, for reading a live skin into a saveable preset. */
export declare function toSrgb(channel: number): number;
export declare function linearToHex(r: number, g: number, b: number): string;
/**
 * The wire format the mod's multi-colour apply expects: flat, one obvious
 * reading, no nested JSON through a hand-rolled Lua parser.
 */
export declare function encodeColours(colours: Record<string, string>): string;
/** For the embed's colour bar, so the reply shows what was actually applied. */
export declare function hexToInt(hex: string): number | null;
