import type { Ctx } from './commands.js';
import { type Bounds, saveBounds } from './heatmap.js';

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

export const LANDMARKS: Landmark[] = [
  {
    id: 'dome',
    label: 'The dome',
    fx: 0.4138,
    fy: 0.6531,
    hint: 'Stand in the middle of the hexagonal structure.',
  },
  {
    id: 'north',
    label: 'Northern tip',
    fy: 0.1157,
    hint: 'Walk to the water at the very north of the island.',
  },
  {
    id: 'south',
    label: 'Southern tip',
    fy: 0.9089,
    hint: 'Walk to the water at the very south of the island.',
  },
  {
    id: 'west',
    label: 'Western tip',
    fx: 0.0882,
    hint: 'Walk to the water at the very west of the island.',
  },
  {
    id: 'east',
    label: 'Eastern tip',
    fx: 0.9344,
    hint: 'Walk to the water at the very east of the island.',
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

/**
 * Least squares through `world = a * fraction + b`.
 *
 * Two readings solve it exactly; more than two average out the fact that
 * nobody stands in precisely the same spot twice. Returns null below two,
 * because one point through an unknown gradient is not a line.
 */
function fit(samples: Array<{ f: number; world: number }>): { min: number; max: number } | null {
  if (samples.length < 2) return null;

  const n = samples.length;
  const sumF = samples.reduce((s, p) => s + p.f, 0);
  const sumW = samples.reduce((s, p) => s + p.world, 0);
  const sumFF = samples.reduce((s, p) => s + (p.f * p.f), 0);
  const sumFW = samples.reduce((s, p) => s + (p.f * p.world), 0);

  const denom = (n * sumFF) - (sumF * sumF);
  // Every reading at the same fraction: a vertical line, no gradient to find.
  if (Math.abs(denom) < 1e-9) return null;

  const a = ((n * sumFW) - (sumF * sumW)) / denom;
  const b = (sumW - (a * sumF)) / n;

  // The picture spans fraction 0 to 1, so those are its edges in world units.
  return { min: b, max: a + b };
}

export interface Solved {
  bounds: Bounds | null;
  /** Which axes still need another reading. */
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

  const x = fit(xs);
  const y = fit(ys);

  const missing: string[] = [];
  if (!x) missing.push('east to west');
  if (!y) missing.push('north to south');

  return {
    bounds: x && y
      ? { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max }
      : null,
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
  needed: Landmark[];
} {
  const readings = recordReading(ctx, reading);
  const { bounds } = solve(readings);

  if (bounds) {
    saveBounds(ctx, bounds);
    ctx.db.setSetting('heatmap_manual', '1');
  }

  return { readings, bounds, needed: stillNeeded(readings) };
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
