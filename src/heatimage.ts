import { Jimp, JimpMime } from 'jimp';

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

export const SIZE = 720;

/** How far one player's heat reaches, in pixels. */
const RADIUS = 46;

/** Cold to hot. Alpha rises with density so an empty map stays clean. */
const RAMP: Array<{ at: number; rgb: [number, number, number]; alpha: number }> = [
  { at: 0.00, rgb: [56, 132, 255], alpha: 0 },
  { at: 0.18, rgb: [56, 132, 255], alpha: 130 },
  { at: 0.40, rgb: [64, 220, 170], alpha: 165 },
  { at: 0.62, rgb: [245, 214, 74], alpha: 195 },
  { at: 0.82, rgb: [245, 138, 48], alpha: 220 },
  { at: 1.00, rgb: [232, 60, 48], alpha: 240 },
];

function colourFor(t: number): { r: number; g: number; b: number; a: number } {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i += 1) {
    const low = RAMP[i - 1]!;
    const high = RAMP[i]!;
    if (clamped > high.at && i < RAMP.length - 1) continue;

    const span = high.at - low.at || 1;
    const f = Math.max(0, Math.min(1, (clamped - low.at) / span));
    return {
      r: Math.round(low.rgb[0] + ((high.rgb[0] - low.rgb[0]) * f)),
      g: Math.round(low.rgb[1] + ((high.rgb[1] - low.rgb[1]) * f)),
      b: Math.round(low.rgb[2] + ((high.rgb[2] - low.rgb[2]) * f)),
      a: Math.round(low.alpha + ((high.alpha - low.alpha) * f)),
    };
  }
  return { r: 232, g: 60, b: 48, a: 240 };
}

/** World coordinates to pixels. North is up, so Y is flipped. */
export function toPixel(point: Point, bounds: Bounds, size = SIZE): { px: number; py: number } {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;

  // Everybody on one spot gives a zero span; dividing by it is NaN, and a NaN
  // pixel index silently draws nothing at all.
  const fx = spanX > 0 ? (point.x - bounds.minX) / spanX : 0.5;
  const fy = spanY > 0 ? (point.y - bounds.minY) / spanY : 0.5;

  return {
    px: Math.round(Math.max(0, Math.min(1, fx)) * (size - 1)),
    py: Math.round((1 - Math.max(0, Math.min(1, fy))) * (size - 1)),
  };
}

/** A faint grid, so an empty map is not an unreadable dark square. */
function drawGrid(image: ReturnType<typeof makeCanvas>, size: number): void {
  const step = Math.round(size / 12);
  const line = 0x232936ff;
  for (let n = step; n < size; n += step) {
    for (let p = 0; p < size; p += 1) {
      image.setPixelColor(line, n, p);
      image.setPixelColor(line, p, n);
    }
  }
}

/**
 * One instantiation for everything.
 *
 * A supplied map is composited onto this rather than being the image itself:
 * `Jimp.read` and `new Jimp` produce differently instantiated generics, and the
 * union of the two has no callable `getBuffer`.
 */
function makeCanvas(size: number) {
  return new Jimp({ width: size, height: size, color: 0x11141bff });
}

/**
 * Draws the heat over a base image and returns a PNG.
 *
 * Always returns a picture, including with nobody online: a panel that swaps
 * between an image and a line of text looks broken rather than quiet.
 */
export async function renderHeatmap(
  points: Point[],
  bounds: Bounds | null,
  base: Buffer | null,
  size = SIZE,
): Promise<Buffer> {
  const image = makeCanvas(size);

  if (base) {
    image.composite((await Jimp.read(base)).resize({ w: size, h: size }), 0, 0);
  } else {
    drawGrid(image, size);
  }

  if (points.length > 0 && bounds) {
    // Accumulate first, colour second, so overlapping players compound.
    const density = new Float32Array(size * size);
    let peak = 0;

    for (const point of points) {
      const { px, py } = toPixel(point, bounds, size);

      const x0 = Math.max(0, px - RADIUS);
      const x1 = Math.min(size - 1, px + RADIUS);
      const y0 = Math.max(0, py - RADIUS);
      const y1 = Math.min(size - 1, py + RADIUS);

      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const dx = x - px;
          const dy = y - py;
          const dist = Math.sqrt((dx * dx) + (dy * dy));
          if (dist > RADIUS) continue;

          // Smooth falloff: a hard-edged disc reads as a sticker, not heat.
          const fall = (1 - (dist / RADIUS)) ** 2;
          const at = (y * size) + x;
          const next = (density[at] ?? 0) + fall;
          density[at] = next;
          if (next > peak) peak = next;
        }
      }
    }

    if (peak > 0) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const value = density[(y * size) + x] ?? 0;
          if (value <= 0) continue;

          const { r, g, b, a } = colourFor(value / peak);
          if (a <= 0) continue;

          const existing = image.getPixelColor(x, y);
          const er = (existing >>> 24) & 0xff;
          const eg = (existing >>> 16) & 0xff;
          const eb = (existing >>> 8) & 0xff;

          const f = a / 255;
          const mix = (over: number, under: number): number =>
            Math.round((over * f) + (under * (1 - f)));

          image.setPixelColor(
            (((mix(r, er) << 24) >>> 0) + (mix(g, eg) << 16) + (mix(b, eb) << 8) + 0xff) >>> 0,
            x, y,
          );
        }
      }
    }
  }

  // JimpMime.png rather than the bare string: the overloads on getBuffer do
  // not resolve from a plain literal.
  return Buffer.from(await image.getBuffer(JimpMime.png));
}

// ------------------------------------------------------------- base image --

let cached: { url: string; data: Buffer } | null = null;

/**
 * Fetches the configured map picture, once.
 *
 * Cached by URL: this runs every few minutes forever, and re-downloading a
 * megabyte each time to draw a dozen dots on it would be rude to whoever is
 * hosting the image.
 */
export async function baseImage(url: string): Promise<Buffer | null> {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (cached && cached.url === trimmed) return cached.data;

  try {
    const response = await fetch(trimmed);
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());

    // Prove it decodes now rather than failing inside the panel later.
    await Jimp.read(data);
    cached = { url: trimmed, data };
    return data;
  } catch {
    return null;
  }
}

export function forgetBaseImage(): void {
  cached = null;
}
