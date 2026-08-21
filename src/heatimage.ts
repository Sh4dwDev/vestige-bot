import fs from 'node:fs/promises';

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
 * own terms. Drop one at `data/map.png` on the host and it is picked up with no
 * configuration at all; a link works too. Without either, the heat is drawn on
 * a plain grid so the panel still shows something.
 */

export const SIZE = 720;

/** How far one player's heat reaches, in pixels. Wide, so it reads as a haze. */
const RADIUS = 78;

/**
 * How much stacked heat counts as "hot".
 *
 * Deliberately an **absolute** scale rather than per-frame. Normalising against
 * whoever happens to be on would paint a single player in a quiet hour the same
 * colour as a warband at prime time, and the whole point of a heatmap is that
 * the colours mean the same thing every time you look.
 *
 * Roughly: one player alone is faint blue, three or four stacked is green.
 */
const FULL_HEAT = 3.2;

/**
 * Cold to hot: haze blue, through cyan, to green at the centre of a crowd.
 *
 * Blended additively, so this is light being added to the map rather than paint
 * being laid over it. That is what makes overlapping groups glow instead of
 * turning into a flat sticker, and it keeps the map readable underneath.
 */
const RAMP: Array<{ at: number; rgb: [number, number, number] }> = [
  { at: 0.00, rgb: [18, 34, 120] },
  { at: 0.30, rgb: [30, 70, 210] },
  { at: 0.55, rgb: [40, 140, 235] },
  { at: 0.78, rgb: [50, 210, 200] },
  { at: 1.00, rgb: [90, 245, 120] },
];

function colourFor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < RAMP.length; i += 1) {
    const low = RAMP[i - 1]!;
    const high = RAMP[i]!;
    if (clamped > high.at && i < RAMP.length - 1) continue;

    const span = high.at - low.at || 1;
    const f = Math.max(0, Math.min(1, (clamped - low.at) / span));
    return [
      Math.round(low.rgb[0] + ((high.rgb[0] - low.rgb[0]) * f)),
      Math.round(low.rgb[1] + ((high.rgb[1] - low.rgb[1]) * f)),
      Math.round(low.rgb[2] + ((high.rgb[2] - low.rgb[2]) * f)),
    ];
  }
  return [90, 245, 120];
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
    // Accumulate first, colour second, so overlapping players compound into one
    // brighter blob rather than stamping discs on top of each other.
    const density = new Float32Array(size * size);

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
          const d = Math.sqrt((dx * dx) + (dy * dy)) / RADIUS;
          if (d > 1) continue;

          // Gaussian rather than a linear cone: a bright core with a wide soft
          // skirt is what reads as a glow. A cone reads as a traffic sign.
          const at = (y * size) + x;
          density[at] = (density[at] ?? 0) + Math.exp(-4.5 * d * d);
        }
      }
    }

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const value = density[(y * size) + x] ?? 0;
        if (value <= 0.008) continue;

        // Saturating curve rather than a clamp. Clamping made a crowd render as
        // a flat green puck: everything past the ceiling came out identical, so
        // the gradient inside the blob disappeared. This approaches full heat
        // without ever reaching it, so a cluster keeps a bright core and a soft
        // edge however many people pile in.
        const t = 1 - Math.exp(-value / FULL_HEAT);
        const [r, g, b] = colourFor(t);

        // Never opaque: the map has to stay visible through it, which is the
        // difference between a heatmap and a sheet of coloured plastic.
        const weight = 0.75 * t;

        const existing = image.getPixelColor(x, y);
        const add = (over: number, under: number): number =>
          Math.min(255, Math.round(under + (over * weight)));

        image.setPixelColor(
          (((add(r, (existing >>> 24) & 0xff) << 24) >>> 0)
            + (add(g, (existing >>> 16) & 0xff) << 16)
            + (add(b, (existing >>> 8) & 0xff) << 8) + 0xff) >>> 0,
          x, y,
        );
      }
    }
  }

  // JimpMime.png rather than the bare string: the overloads on getBuffer do
  // not resolve from a plain literal.
  return Buffer.from(await image.getBuffer(JimpMime.png));
}

// ------------------------------------------------------------- base image --

/**
 * Where a map picture is looked for when nothing is configured.
 *
 * Next to the database, because that directory already exists on the host and
 * is already the place the bot keeps its own files. Dropping a picture in is
 * the whole setup — no command, no link, no hosting it anywhere.
 */
export const DEFAULT_PATHS = [
  'data/map.png', 'data/map.jpg', 'data/map.jpeg', 'data/map.webp',
];

/** Cached by source AND mtime, so replacing the file on disk is picked up. */
let cached: { key: string; data: Buffer } | null = null;

async function readLocal(file: string): Promise<{ key: string; data: Buffer } | null> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return null;
    return { key: `${file}:${stat.mtimeMs}`, data: await fs.readFile(file) };
  } catch {
    return null;
  }
}

/**
 * The map picture: a file on the host, or a link, or nothing.
 *
 * `source` empty means look in the default places. A value containing `://` is
 * fetched; anything else is read as a path relative to where the bot runs.
 */
export async function baseImage(source: string): Promise<Buffer | null> {
  const trimmed = source.trim();

  if (!trimmed || !trimmed.includes('://')) {
    const candidates = trimmed ? [trimmed, ...DEFAULT_PATHS] : DEFAULT_PATHS;
    for (const file of candidates) {
      const found = await readLocal(file);
      if (!found) continue;
      if (cached?.key === found.key) return cached.data;

      try {
        // Prove it decodes now rather than failing inside the panel later.
        await Jimp.read(found.data);
        cached = found;
        return found.data;
      } catch {
        // A file that is not an image is worth skipping rather than throwing:
        // somebody may have dropped a readme in there.
      }
    }
    return null;
  }

  if (cached?.key === trimmed) return cached.data;

  try {
    const response = await fetch(trimmed);
    if (!response.ok) return null;
    const data = Buffer.from(await response.arrayBuffer());

    await Jimp.read(data);
    cached = { key: trimmed, data };
    return data;
  } catch {
    return null;
  }
}

export function forgetBaseImage(): void {
  cached = null;
}
