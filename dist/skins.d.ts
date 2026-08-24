import type { Ctx } from './commands.js';
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
    /**
     * The other two indexes on the customizer, which nothing used to write.
     *
     * Reported in play as "some parts the skin changer doesn't change": a
     * repainted dinosaur kept rust markings down its back and tail that none of
     * the ten colours touched. Asking the engine what the struct actually holds
     * (mod v3.38.0) found `ThemeIndex` and `SkinVariation` beside `PatternIndex`
     * — the markings belong to the variation, so no colour could ever have moved
     * them.
     *
     * Left undefined means **0**, not "leave alone": a skin that only half
     * replaces the look is the bug being fixed here.
     */
    theme?: number;
    variation?: number;
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
/**
 * Remembers what a dinosaur looked like before anybody painted it.
 *
 * There is no "reset to default" to ask the game for, and the colours a
 * dinosaur hatches with are its own — so undoing a skin is only possible if the
 * original was kept first. Captured on the way in, before the first paint, and
 * never overwritten: the second paint must not record the first one as if it
 * were natural.
 *
 * Failure is deliberately quiet. Not being able to read the current colours is
 * a reason to skip the safety net, never a reason to refuse the paint somebody
 * actually asked for.
 */
/**
 * Sets the pattern/theme/variation part of a look.
 *
 * Separate from the colours on purpose and always sent first: an out-of-range
 * pattern makes the client abandon the whole rebuild, which would take the
 * colours down with it if they shared a write.
 *
 * Theme and variation default to 0 rather than being left alone. A skin is
 * supposed to replace the look, and leaving the dinosaur's own variation in
 * place is exactly what made half of it stay unchanged.
 */
export declare function applyLookIndexes(ctx: Ctx, steamId: string, look: Pick<Look, 'theme' | 'variation'>): Promise<boolean>;
export declare function captureBaseline(ctx: Ctx, steamId: string, species: string): Promise<void>;
export type ResetResult = 'restored' | 'no-baseline' | 'failed';
/**
 * Puts the original colours back on the live dinosaur.
 *
 * The point of this over simply forgetting: a forgotten skin stays on the
 * animal until it dies or the player relogs, which is not what anybody means
 * by "reset". This writes the original back immediately.
 */
export declare function restoreBaseline(ctx: Ctx, steamId: string, species: string): Promise<ResetResult>;
/**
 * A look by name, from the saved presets **or** the built-in ones.
 *
 * There are two places a preset can live and only one of them is the database,
 * so `ctx.db.preset(name)` alone answers "no" for every ready-made look. The
 * autocomplete offers both, which is how somebody comes to pick `Camouflage`
 * from a list and be told it does not exist.
 *
 * Saved wins: an admin who names their own preset after a built-in meant theirs.
 */
/**
 * Fills in the colour fields a palette does not name.
 *
 * Every ready-made look defines six of the ten: body, flanks, underbelly,
 * markings, detail and eyes. The other four were simply left alone, so a
 * repainted dinosaur kept the male display, teeth, mouth and claws it hatched
 * with — reported as "the orange part won't change with the presets", which on
 * a male Carnotaurus is `MaleDisplayColor` down the back and neck.
 *
 * The missing four are derived from the palette rather than given fixed
 * values, so a look stays internally consistent instead of acquiring a stock
 * mouth in somebody else's colour. An explicit value always wins, so a palette
 * that does name all ten is untouched.
 */
export declare function completeLook(colours: Record<string, string>): Record<string, string>;
export declare const presetLook: (ctx: Ctx, name: string) => Look | null;
