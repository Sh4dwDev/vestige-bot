import type { Ctx } from './commands.js';
import { type Bounds, DEFAULT_BOUNDS, saveBounds } from './heatmap.js';

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

/**
 * The coastal fractions here are the extremes of the **main island**, found by
 * flood-filling out from the hexagon so the detached north-west islet cannot
 * count. An earlier attempt took the first row holding a wide run of land,
 * which is not the same thing at all: it missed the northern tip by 7% of the
 * picture, around 77,000 world units, and would have calibrated in that error.
 *
 * Two structures beat four coastlines. The hexagon and the crater each pin both
 * axes and are unmistakable on the ground, where "the northernmost point of the
 * island" is a sandbar that looks like every other sandbar.
 */
export const LANDMARKS: Landmark[] = [
  {
    id: 'dome',
    label: 'The hexagon',
    fx: 0.4138,
    fy: 0.6531,
    hint: 'Stand in the middle of the hexagonal structure.',
  },
  {
    id: 'crater',
    label: 'The crater',
    fx: 0.6760,
    fy: 0.2983,
    hint: 'Stand in the middle of the bare rock crater in the north-east.',
  },
  {
    id: 'north',
    label: 'Northern tip',
    fy: 0.0481,
    hint: 'The far north-east spit — walk north-east until the land runs out.',
  },
  {
    id: 'south',
    label: 'Southern tip',
    fy: 0.9468,
    hint: 'The southern beach — walk south until the land runs out.',
  },
  {
    id: 'west',
    label: 'Western tip',
    fx: 0.0287,
    hint: 'The far west beach — walk west until the land runs out.',
  },
  {
    id: 'east',
    label: 'Eastern tip',
    fx: 0.9713,
    hint: 'The far east shore — walk east until the land runs out.',
  },
];

export const landmarkById = (id: string): Landmark | undefined =>
  LANDMARKS.find((l) => l.id === id);

/** A reading: where somebody stood, and which landmark they stood on. */
export interface Reading {
  id: string;
  x: number;
  y: number;
}

interface Axis {
  min: number;
  max: number;
  /** False when the width was assumed rather than measured. */
  exact: boolean;
}

/**
 * Least squares through `world = a * fraction + b`.
 *
 * Two readings settle an axis exactly; more than two average out the fact that
 * nobody stands in precisely the same spot twice.
 *
 * **One reading still moves the map.** A single point cannot give the width of
 * the world — a line needs a gradient — but it does say exactly where that one
 * place sits, so the assumed width is slid until the point lands where it
 * belongs. That is wrong about scale and right about position, which beats
 * being wrong about both. Requiring two readings before anything visibly
 * changed made calibrating feel broken.
 */
function fit(samples: Array<{ f: number; world: number }>, span: number): Axis | null {
  if (samples.length === 0) return null;

  if (samples.length === 1 || allSameFraction(samples)) {
    // Every reading in one spot is one constraint however many times it was
    // taken, so it anchors the assumed width rather than measuring a new one.
    const anchor = samples[0]!;
    const min = anchor.world - (anchor.f * span);
    return { min, max: min + span, exact: false };
  }

  const n = samples.length;
  const sumF = samples.reduce((s, p) => s + p.f, 0);
  const sumW = samples.reduce((s, p) => s + p.world, 0);
  const sumFF = samples.reduce((s, p) => s + (p.f * p.f), 0);
  const sumFW = samples.reduce((s, p) => s + (p.f * p.world), 0);

  const denom = (n * sumFF) - (sumF * sumF);
  const a = ((n * sumFW) - (sumF * sumW)) / denom;
  const b = (sumW - (a * sumF)) / n;

  // The picture spans fraction 0 to 1, so those are its edges in world units.
  return { min: b, max: a + b, exact: true };
}

/** Whether every sample sits at the same place, to within rounding. */
function allSameFraction(samples: Array<{ f: number }>): boolean {
  const first = samples[0]!.f;
  return samples.every((s) => Math.abs(s.f - first) < 1e-9);
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
export function solve(readings: Reading[]): Solved {
  const xs: Array<{ f: number; world: number }> = [];
  const ys: Array<{ f: number; world: number }> = [];

  for (const reading of readings) {
    const mark = landmarkById(reading.id);
    if (!mark) continue;

    if (mark.fx !== undefined) xs.push({ f: mark.fx, world: reading.x });
    // The picture measures down from the top; the world measures north from the
    // bottom. Flipping here is what keeps north up.
    if (mark.fy !== undefined) ys.push({ f: 1 - mark.fy, world: reading.y });
  }

  // An axis nobody has stood on keeps the default it already had. Throwing the
  // whole answer away because one direction is unmeasured would discard a
  // perfectly good measurement of the other.
  const x = fit(xs, DEFAULT_BOUNDS.maxX - DEFAULT_BOUNDS.minX)
    ?? { min: DEFAULT_BOUNDS.minX, max: DEFAULT_BOUNDS.maxX, exact: false };
  const y = fit(ys, DEFAULT_BOUNDS.maxY - DEFAULT_BOUNDS.minY)
    ?? { min: DEFAULT_BOUNDS.minY, max: DEFAULT_BOUNDS.maxY, exact: false };

  const missing: string[] = [];
  if (!x.exact) missing.push('east to west');
  if (!y.exact) missing.push('north to south');

  return {
    // Nothing recorded at all means nothing to say — the panel keeps whatever
    // it was already using rather than being handed the defaults as a decision.
    bounds: readings.length === 0
      ? null
      : { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max },
    exact: x.exact && y.exact,
    missing,
  };
}

const READINGS_KEY = 'heatmap_readings';

export function storedReadings(ctx: Ctx): Reading[] {
  const raw = ctx.db.getSetting(READINGS_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((r): r is Reading =>
      typeof r === 'object' && r !== null
      && typeof (r as Reading).id === 'string'
      && Number.isFinite((r as Reading).x)
      && Number.isFinite((r as Reading).y));
  } catch {
    return [];
  }
}

/** Records a reading, replacing any earlier one for the same landmark. */
export function recordReading(ctx: Ctx, reading: Reading): Reading[] {
  const kept = storedReadings(ctx).filter((r) => r.id !== reading.id);
  const next = [...kept, reading];
  ctx.db.setSetting(READINGS_KEY, JSON.stringify(next));
  return next;
}

export function clearReadings(ctx: Ctx): void {
  ctx.db.setSetting(READINGS_KEY, '');
}

/**
 * Records a reading and, once the readings can settle both axes, saves the
 * bounds they imply.
 *
 * Marked manual, because these came from somebody standing on a real place —
 * the panel must stop widening them towards wherever people happen to walk.
 */
export function applyReading(ctx: Ctx, reading: Reading): {
  readings: Reading[];
  bounds: Bounds | null;
  exact: boolean;
  needed: Landmark[];
} {
  const readings = recordReading(ctx, reading);
  const { bounds, exact } = solve(readings);

  if (bounds) {
    saveBounds(ctx, bounds);
    ctx.db.setSetting('heatmap_manual', '1');
  }

  return { readings, bounds, exact, needed: stillNeeded(readings) };
}

/** Which landmarks would finish the job, given what is already recorded. */
export function stillNeeded(readings: Reading[]): Landmark[] {
  const { missing } = solve(readings);
  if (missing.length === 0) return [];

  const done = new Set(readings.map((r) => r.id));
  return LANDMARKS.filter((mark) => {
    if (done.has(mark.id)) return false;
    if (missing.includes('east to west') && mark.fx !== undefined) return true;
    if (missing.includes('north to south') && mark.fy !== undefined) return true;
    return false;
  });
}
