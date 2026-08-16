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
export const PARTS = [
    { field: 'BodyColor', label: 'Body' },
    { field: 'MarkingsColor', label: 'Markings' },
    { field: 'FlankColor', label: 'Flanks' },
    { field: 'UnderbellyColor', label: 'Underbelly' },
    { field: 'Detail1Color', label: 'Detail' },
    { field: 'EyesColor', label: 'Eyes' },
    { field: 'MaleDisplayColor', label: 'Male display' },
    { field: 'TeethColor', label: 'Teeth' },
    { field: 'MouthColor', label: 'Mouth' },
    { field: 'ClawsColor', label: 'Claws' },
];
/** A starting palette, so nobody has to invent hex codes to get something decent. */
export const PRESETS = [
    { name: 'Bone white', hex: '#EDE6D6' },
    { name: 'Sand', hex: '#D9C08C' },
    { name: 'Clay', hex: '#B07A52' },
    { name: 'Rust', hex: '#8C3B1E' },
    { name: 'Blood', hex: '#6E1414' },
    { name: 'Moss', hex: '#5A6B3B' },
    { name: 'Jungle', hex: '#2F4A2A' },
    { name: 'Teal', hex: '#1F6F6B' },
    { name: 'Ocean', hex: '#1B3A5C' },
    { name: 'Storm grey', hex: '#4A4F55' },
    { name: 'Charcoal', hex: '#22242A' },
    { name: 'Black', hex: '#0B0B0D' },
    { name: 'Ash', hex: '#8A8F96' },
    { name: 'Plum', hex: '#4A2545' },
    { name: 'Amber', hex: '#C8871B' },
    { name: 'Gold', hex: '#D8A93A' },
    { name: 'Ember orange', hex: '#D45A19' },
    { name: 'Rose', hex: '#B4676B' },
    { name: 'Ice', hex: '#BFD8E6' },
    { name: 'Venom green', hex: '#7FBF2A' },
];
/** Accepts `#RGB`, `#RRGGBB`, with or without the hash. */
export function parseHex(input) {
    const cleaned = input.trim().replace(/^#/, '');
    const full = cleaned.length === 3
        ? cleaned.split('').map((c) => c + c).join('')
        : cleaned;
    if (!/^[0-9a-fA-F]{6}$/.test(full))
        return null;
    return {
        r: Number.parseInt(full.slice(0, 2), 16) / 255,
        g: Number.parseInt(full.slice(2, 4), 16) / 255,
        b: Number.parseInt(full.slice(4, 6), 16) / 255,
    };
}
/**
 * sRGB to linear, the standard piecewise transfer function.
 *
 * Skipping this is the classic mistake: 50% grey picked in any colour picker is
 * 0.5 in sRGB but 0.214 linear, so a naive write lands roughly twice as bright
 * as intended.
 */
export function toLinear(channel) {
    return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
}
export function hexToLinear(hex) {
    const srgb = parseHex(hex);
    if (!srgb)
        return null;
    return { r: toLinear(srgb.r), g: toLinear(srgb.g), b: toLinear(srgb.b) };
}
/** Linear back to sRGB hex, for reading a live skin into a saveable preset. */
export function toSrgb(channel) {
    const clamped = Math.min(1, Math.max(0, channel));
    return clamped <= 0.0031308
        ? clamped * 12.92
        : 1.055 * clamped ** (1 / 2.4) - 0.055;
}
export function linearToHex(r, g, b) {
    const byte = (c) => Math.round(toSrgb(c) * 255).toString(16).padStart(2, '0').toUpperCase();
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}
/**
 * The wire format the mod's multi-colour apply expects: flat, one obvious
 * reading, no nested JSON through a hand-rolled Lua parser.
 */
export function encodeColours(colours) {
    return Object.entries(colours)
        .map(([field, hex]) => {
        const linear = hexToLinear(hex);
        if (!linear)
            return null;
        return `${field}=${linear.r.toFixed(5)},${linear.g.toFixed(5)},${linear.b.toFixed(5)}`;
    })
        .filter((part) => part !== null)
        .join('|');
}
/** For the embed's colour bar, so the reply shows what was actually applied. */
export function hexToInt(hex) {
    const cleaned = hex.trim().replace(/^#/, '');
    const full = cleaned.length === 3
        ? cleaned.split('').map((c) => c + c).join('')
        : cleaned;
    if (!/^[0-9a-fA-F]{6}$/.test(full))
        return null;
    return Number.parseInt(full, 16);
}
//# sourceMappingURL=skins.js.map