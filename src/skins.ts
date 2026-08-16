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
export const PARTS: Array<{ field: string; label: string }> = [
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
export const PRESETS: Array<{ name: string; hex: string }> = [
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

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Accepts `#RGB`, `#RRGGBB`, with or without the hash. */
export function parseHex(input: string): Rgb | null {
  const cleaned = input.trim().replace(/^#/, '');

  const full = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned;

  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;

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
export function toLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

export function hexToLinear(hex: string): Rgb | null {
  const srgb = parseHex(hex);
  if (!srgb) return null;
  return { r: toLinear(srgb.r), g: toLinear(srgb.g), b: toLinear(srgb.b) };
}

/** For the embed's colour bar, so the reply shows what was actually applied. */
export function hexToInt(hex: string): number | null {
  const cleaned = hex.trim().replace(/^#/, '');
  const full = cleaned.length === 3
    ? cleaned.split('').map((c) => c + c).join('')
    : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return Number.parseInt(full, 16);
}
