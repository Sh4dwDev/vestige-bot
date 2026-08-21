import { saveBounds } from './heatmap.js';
export const LANDMARKS = [
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
export const landmarkById = (id) => LANDMARKS.find((l) => l.id === id);
/**
 * Least squares through `world = a * fraction + b`.
 *
 * Two readings solve it exactly; more than two average out the fact that
 * nobody stands in precisely the same spot twice. Returns null below two,
 * because one point through an unknown gradient is not a line.
 */
function fit(samples) {
    if (samples.length < 2)
        return null;
    const n = samples.length;
    const sumF = samples.reduce((s, p) => s + p.f, 0);
    const sumW = samples.reduce((s, p) => s + p.world, 0);
    const sumFF = samples.reduce((s, p) => s + (p.f * p.f), 0);
    const sumFW = samples.reduce((s, p) => s + (p.f * p.world), 0);
    const denom = (n * sumFF) - (sumF * sumF);
    // Every reading at the same fraction: a vertical line, no gradient to find.
    if (Math.abs(denom) < 1e-9)
        return null;
    const a = ((n * sumFW) - (sumF * sumW)) / denom;
    const b = (sumW - (a * sumF)) / n;
    // The picture spans fraction 0 to 1, so those are its edges in world units.
    return { min: b, max: a + b };
}
/**
 * Turns readings into bounds.
 *
 * Solved per axis, because the readings are per axis: two coastal tips north
 * and south settle latitude while telling you nothing about longitude.
 */
export function solve(readings) {
    const xs = [];
    const ys = [];
    for (const reading of readings) {
        const mark = landmarkById(reading.id);
        if (!mark)
            continue;
        if (mark.fx !== undefined)
            xs.push({ f: mark.fx, world: reading.x });
        // The picture measures down from the top; the world measures north from the
        // bottom. Flipping here is what keeps north up.
        if (mark.fy !== undefined)
            ys.push({ f: 1 - mark.fy, world: reading.y });
    }
    const x = fit(xs);
    const y = fit(ys);
    const missing = [];
    if (!x)
        missing.push('east to west');
    if (!y)
        missing.push('north to south');
    return {
        bounds: x && y
            ? { minX: x.min, maxX: x.max, minY: y.min, maxY: y.max }
            : null,
        missing,
    };
}
const READINGS_KEY = 'heatmap_readings';
export function storedReadings(ctx) {
    const raw = ctx.db.getSetting(READINGS_KEY);
    if (!raw)
        return [];
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((r) => typeof r === 'object' && r !== null
            && typeof r.id === 'string'
            && Number.isFinite(r.x)
            && Number.isFinite(r.y));
    }
    catch {
        return [];
    }
}
/** Records a reading, replacing any earlier one for the same landmark. */
export function recordReading(ctx, reading) {
    const kept = storedReadings(ctx).filter((r) => r.id !== reading.id);
    const next = [...kept, reading];
    ctx.db.setSetting(READINGS_KEY, JSON.stringify(next));
    return next;
}
export function clearReadings(ctx) {
    ctx.db.setSetting(READINGS_KEY, '');
}
/**
 * Records a reading and, once the readings can settle both axes, saves the
 * bounds they imply.
 *
 * Marked manual, because these came from somebody standing on a real place —
 * the panel must stop widening them towards wherever people happen to walk.
 */
export function applyReading(ctx, reading) {
    const readings = recordReading(ctx, reading);
    const { bounds } = solve(readings);
    if (bounds) {
        saveBounds(ctx, bounds);
        ctx.db.setSetting('heatmap_manual', '1');
    }
    return { readings, bounds, needed: stillNeeded(readings) };
}
/** Which landmarks would finish the job, given what is already recorded. */
export function stillNeeded(readings) {
    const { missing } = solve(readings);
    if (missing.length === 0)
        return [];
    const done = new Set(readings.map((r) => r.id));
    return LANDMARKS.filter((mark) => {
        if (done.has(mark.id))
            return false;
        if (missing.includes('east to west') && mark.fx !== undefined)
            return true;
        if (missing.includes('north to south') && mark.fy !== undefined)
            return true;
        return false;
    });
}
//# sourceMappingURL=calibrate.js.map