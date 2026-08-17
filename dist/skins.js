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
const LOOKS = {
    'Ash Wraith': {
        BodyColor: '#8A8F96', FlankColor: '#6E737A', UnderbellyColor: '#C9CDD2',
        MarkingsColor: '#4A4F55', Detail1Color: '#EDE6D6', EyesColor: '#BFD8E6',
    },
    Ember: {
        BodyColor: '#22242A', FlankColor: '#2E3038', UnderbellyColor: '#3A2A22',
        MarkingsColor: '#D45A19', Detail1Color: '#C8871B', EyesColor: '#D8A93A',
    },
    'Jungle Stalker': {
        BodyColor: '#2F4A2A', FlankColor: '#3D5C33', UnderbellyColor: '#7E8C5A',
        MarkingsColor: '#1E2E1B', Detail1Color: '#5A6B3B', EyesColor: '#7FBF2A',
    },
    Bonewalker: {
        BodyColor: '#EDE6D6', FlankColor: '#DDD4C0', UnderbellyColor: '#F5F0E4',
        MarkingsColor: '#B8AC93', Detail1Color: '#8A8F96', EyesColor: '#4A4F55',
    },
    Abyss: {
        BodyColor: '#1B3A5C', FlankColor: '#14293F', UnderbellyColor: '#2C5A7A',
        MarkingsColor: '#0B0B0D', Detail1Color: '#1F6F6B', EyesColor: '#BFD8E6',
    },
    Venom: {
        BodyColor: '#22242A', FlankColor: '#2A2E24', UnderbellyColor: '#4A5A2A',
        MarkingsColor: '#7FBF2A', Detail1Color: '#9BD84A', EyesColor: '#7FBF2A',
    },
    Sandstorm: {
        BodyColor: '#D9C08C', FlankColor: '#C2A874', UnderbellyColor: '#EDE6D6',
        MarkingsColor: '#B07A52', Detail1Color: '#8C6238', EyesColor: '#C8871B',
    },
    'Blood Moon': {
        BodyColor: '#3A1414', FlankColor: '#4E1A1A', UnderbellyColor: '#6E1414',
        MarkingsColor: '#0B0B0D', Detail1Color: '#8C3B1E', EyesColor: '#D45A19',
    },
    Frostbite: {
        BodyColor: '#BFD8E6', FlankColor: '#9CBCD0', UnderbellyColor: '#EDF4F8',
        MarkingsColor: '#4A5F70', Detail1Color: '#FFFFFF', EyesColor: '#1F6F6B',
    },
    Regal: {
        BodyColor: '#4A2545', FlankColor: '#5E3059', UnderbellyColor: '#8A5E80',
        MarkingsColor: '#D8A93A', Detail1Color: '#C8871B', EyesColor: '#D8A93A',
    },
    // --- naturalistic ---------------------------------------------------------
    Tiger: {
        BodyColor: '#C86A1E', FlankColor: '#B05614', UnderbellyColor: '#EDE0C8',
        MarkingsColor: '#1A1410', Detail1Color: '#8C4410', EyesColor: '#D8A93A',
    },
    Albino: {
        BodyColor: '#F6F1E7', FlankColor: '#EADFCE', UnderbellyColor: '#FFFFFF',
        MarkingsColor: '#E0CDB4', Detail1Color: '#F2D9D9', EyesColor: '#C9414B',
    },
    Melanistic: {
        BodyColor: '#101013', FlankColor: '#191A1F', UnderbellyColor: '#26282E',
        MarkingsColor: '#08080A', Detail1Color: '#33363D', EyesColor: '#9BA3AD',
    },
    Swamp: {
        BodyColor: '#4A4A2E', FlankColor: '#3B3B24', UnderbellyColor: '#6E6A46',
        MarkingsColor: '#2A2A18', Detail1Color: '#5F6B3A', EyesColor: '#A8B04A',
    },
    Savanna: {
        BodyColor: '#B08E5A', FlankColor: '#9A7A48', UnderbellyColor: '#E0CFAE',
        MarkingsColor: '#6E5430', Detail1Color: '#C8A96E', EyesColor: '#8C6238',
    },
    Autumn: {
        BodyColor: '#8C4A1E', FlankColor: '#A85E24', UnderbellyColor: '#D9B375',
        MarkingsColor: '#5A2C10', Detail1Color: '#D8A93A', EyesColor: '#C8871B',
    },
    Coral: {
        BodyColor: '#C2635E', FlankColor: '#A94E49', UnderbellyColor: '#F0CBBE',
        MarkingsColor: '#7A2E2E', Detail1Color: '#E08A5A', EyesColor: '#2E6E6E',
    },
    // --- striking -------------------------------------------------------------
    Nightstalker: {
        BodyColor: '#14161F', FlankColor: '#1B1F2C', UnderbellyColor: '#2A3040',
        MarkingsColor: '#0A0B10', Detail1Color: '#3E4A6B', EyesColor: '#5AA0FF',
    },
    Volcanic: {
        BodyColor: '#1A1412', FlankColor: '#241A16', UnderbellyColor: '#3A2018',
        MarkingsColor: '#C43A0E', Detail1Color: '#FF7A1A', EyesColor: '#FF9A3A',
    },
    Toxic: {
        BodyColor: '#2A2E14', FlankColor: '#3A4018', UnderbellyColor: '#C8D84A',
        MarkingsColor: '#1A1C0C', Detail1Color: '#9BD84A', EyesColor: '#D8F04A',
    },
    Obsidian: {
        BodyColor: '#15121C', FlankColor: '#1E1A28', UnderbellyColor: '#2C2438',
        MarkingsColor: '#0A080E', Detail1Color: '#6E4A9A', EyesColor: '#A87ADA',
    },
    Arctic: {
        BodyColor: '#E8EEF2', FlankColor: '#CFDAE2', UnderbellyColor: '#FFFFFF',
        MarkingsColor: '#8FA3B0', Detail1Color: '#B8CDD8', EyesColor: '#3A6E8C',
    },
    Copper: {
        BodyColor: '#8C4A2A', FlankColor: '#A85E36', UnderbellyColor: '#D9A06E',
        MarkingsColor: '#5A2E18', Detail1Color: '#C8871B', EyesColor: '#3A5A4A',
    },
    Stormfront: {
        BodyColor: '#3E4650', FlankColor: '#2E353E', UnderbellyColor: '#7A8894',
        MarkingsColor: '#1E2228', Detail1Color: '#C3CED6', EyesColor: '#7FC8E6',
    },
};
/**
 * The pattern each look is built around. Spread across the low indices, which
 * every species is most likely to have — a look is not lost if the pattern is
 * missing, it just wears the species' current one.
 */
const LOOK_PATTERNS = {
    'Ash Wraith': 1, Ember: 2, 'Jungle Stalker': 1, Bonewalker: 0, Abyss: 3,
    Venom: 2, Sandstorm: 0, 'Blood Moon': 3, Frostbite: 1, Regal: 2,
    Tiger: 3, Albino: 0, Melanistic: 1, Swamp: 2, Savanna: 0, Autumn: 1,
    Coral: 3, Nightstalker: 2, Volcanic: 3, Toxic: 1, Obsidian: 2,
    Arctic: 0, Copper: 1, Stormfront: 3,
};
export const BUILT_IN = Object.fromEntries(Object.entries(LOOKS).map(([name, colours]) => [
    name,
    LOOK_PATTERNS[name] === undefined
        ? { colours }
        : { colours, pattern: LOOK_PATTERNS[name] },
]));
/**
 * Patterns are numbered on the wire and lettered in the game, so the picker
 * speaks letters and the mod speaks numbers.
 */
export const patternLetter = (index) => index >= 0 && index < 26 ? String.fromCharCode(65 + index) : `#${index}`;
/**
 * How many to offer. The real count is **per species** and the game does not
 * tell us, so this is a generous menu — picking one a species does not have
 * simply does nothing visible, which is why patterns are never sent in the same
 * write as colours.
 */
export const PATTERN_CHOICES = 8;
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