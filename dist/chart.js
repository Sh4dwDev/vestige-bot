import { Jimp, JimpMime, loadFont, measureText } from 'jimp';
import { SANS_8_WHITE, SANS_16_WHITE } from 'jimp/fonts';
/**
 * The population history as an actual chart.
 *
 * It was block characters first, which is honest but unreadable: twenty-four
 * glyphs have eight possible heights between them, so a quiet Tuesday and a
 * dead one look identical. A drawn chart has a pixel per reading and room for
 * axes, which is the difference between decoration and something you can
 * plan an event around.
 *
 * Drawn by hand rather than with a charting library. Everything on npm that
 * renders a chart to a PNG wants either a headless browser or a native canvas
 * build, and the host installs production dependencies with no compiler — the
 * same constraint that put `dist/` in git. Jimp is already here for the
 * heatmap, so the line, the fill and the axes are rasterised directly.
 */
const WIDTH = 900;
const HEIGHT = 320;
/** Room for the axis labels, so the plot never overlaps them. */
const PAD = { left: 44, right: 16, top: 34, bottom: 26 };
const PLOT = {
    x0: PAD.left,
    y0: PAD.top,
    x1: WIDTH - PAD.right,
    y1: HEIGHT - PAD.bottom,
};
const COLOR = {
    /** Matches a Discord dark-theme embed, so it sits in the panel rather than on it. */
    background: 0x2b2d31ff,
    grid: 0x3f4248ff,
    axis: 0x4e5058ff,
    line: 0x57f287ff,
    fill: 0x57f287ff,
    peak: 0xfee75cff,
};
const rgba = (hex) => ({
    r: (hex >>> 24) & 0xff,
    g: (hex >>> 16) & 0xff,
    b: (hex >>> 8) & 0xff,
    a: hex & 0xff,
});
/** Alpha blend, so the area fill lets the grid show through. */
function blend(image, x, y, colour, alpha) {
    if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT || alpha <= 0)
        return;
    const under = rgba(image.getPixelColor(x, y));
    const a = Math.min(1, alpha);
    const mix = (over, beneath) => Math.round((over * a) + (beneath * (1 - a)));
    image.setPixelColor(((mix(colour.r, under.r) << 24)
        | (mix(colour.g, under.g) << 16)
        | (mix(colour.b, under.b) << 8)
        | 0xff) >>> 0, x, y);
}
function hLine(image, x0, x1, y, colour, alpha = 1) {
    for (let x = x0; x <= x1; x += 1)
        blend(image, x, y, colour, alpha);
}
function vLine(image, x, y0, y1, colour, alpha = 1) {
    for (let y = y0; y <= y1; y += 1)
        blend(image, x, y, colour, alpha);
}
/**
 * A line between two points, thickened vertically.
 *
 * Thickened in Y rather than perpendicular to the line: this chart is a
 * function of time, so it never doubles back, and a vertical thickness reads
 * the same while being a great deal simpler to get right.
 */
function segment(image, a, b, colour, thickness) {
    const steps = Math.max(1, Math.abs(b.x - a.x));
    for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const x = Math.round(a.x + ((b.x - a.x) * t));
        const y = Math.round(a.y + ((b.y - a.y) * t));
        for (let d = 0; d < thickness; d += 1) {
            blend(image, x, y - Math.floor(thickness / 2) + d, colour, 1);
        }
    }
}
/** Nice round steps, so the axis reads 0/5/10 rather than 0/3.7/7.4. */
export function niceStep(max, targetLines) {
    const raw = Math.max(1, max / targetLines);
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    for (const multiple of [1, 2, 2.5, 5, 10]) {
        const step = multiple * magnitude;
        if (step >= raw)
            return step;
    }
    return 10 * magnitude;
}
/**
 * Renders the chart.
 *
 * Gaps stay gaps: a slot with no reading breaks the line rather than being
 * joined through, because the bot being offline is not a quiet hour and a
 * continuous line across it would claim otherwise.
 */
export async function renderChart(buckets, labels) {
    const image = new Jimp({ width: WIDTH, height: HEIGHT, color: COLOR.background });
    const highest = Math.max(...buckets.map((b) => b.peak ?? 0), 0);
    // Never a flat ceiling at zero, and always a little headroom above the peak
    // so the line is not welded to the top edge.
    const step = niceStep(Math.max(1, highest), 4);
    const top = Math.max(step, Math.ceil((highest + (step * 0.35)) / step) * step);
    const plotWidth = PLOT.x1 - PLOT.x0;
    const plotHeight = PLOT.y1 - PLOT.y0;
    const xFor = (index) => buckets.length <= 1
        ? PLOT.x0 + (plotWidth / 2)
        : PLOT.x0 + ((index / (buckets.length - 1)) * plotWidth);
    const yFor = (value) => PLOT.y1 - ((value / top) * plotHeight);
    const grid = rgba(COLOR.grid);
    const axis = rgba(COLOR.axis);
    const line = rgba(COLOR.line);
    const fill = rgba(COLOR.fill);
    const font8 = await loadFont(SANS_8_WHITE);
    const font16 = await loadFont(SANS_16_WHITE);
    // Horizontal gridlines and their labels.
    for (let value = 0; value <= top + 1e-9; value += step) {
        const y = Math.round(yFor(value));
        hLine(image, PLOT.x0, PLOT.x1, y, grid, value === 0 ? 1 : 0.55);
        const text = String(Math.round(value));
        image.print({
            font: font8,
            x: PLOT.x0 - 8 - measureText(font8, text),
            y: y - 4,
            text,
        });
    }
    vLine(image, PLOT.x0, PLOT.y0, PLOT.y1, axis);
    // The area under the line, drawn before the line so the line sits on top.
    const points = buckets.map((b, index) => (b.peak === null
        ? null
        : { x: Math.round(xFor(index)), y: Math.round(yFor(b.peak)), value: b.peak }));
    for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        if (!from || !to)
            continue;
        for (let x = from.x; x <= to.x; x += 1) {
            const t = to.x === from.x ? 0 : (x - from.x) / (to.x - from.x);
            const y = Math.round(from.y + ((to.y - from.y) * t));
            for (let py = y; py <= PLOT.y1; py += 1) {
                // Strongest just under the line and fading downward, which is what
                // makes the shape readable rather than a solid green slab.
                const depth = (py - y) / Math.max(1, PLOT.y1 - y);
                blend(image, x, py, fill, 0.32 * (1 - (depth * 0.75)));
            }
        }
    }
    for (let index = 0; index < points.length - 1; index += 1) {
        const from = points[index];
        const to = points[index + 1];
        if (!from || !to)
            continue;
        segment(image, from, to, line, 3);
    }
    // A lone reading with gaps either side would otherwise draw nothing at all.
    for (let index = 0; index < points.length; index += 1) {
        const here = points[index];
        if (!here)
            continue;
        const alone = !points[index - 1] && !points[index + 1];
        if (!alone)
            continue;
        for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1)
                blend(image, here.x + dx, here.y + dy, line, 1);
        }
    }
    // The peak, marked where it happened.
    const peakPoint = points.reduce((best, p) => (p && (!best || p.value > best.value) ? p : best), null);
    if (peakPoint && peakPoint.value > 0) {
        const peak = rgba(COLOR.peak);
        for (let dx = -3; dx <= 3; dx += 1) {
            for (let dy = -3; dy <= 3; dy += 1) {
                if ((dx * dx) + (dy * dy) > 9)
                    continue;
                blend(image, peakPoint.x + dx, peakPoint.y + dy, peak, 1);
            }
        }
        const text = String(peakPoint.value);
        const width = measureText(font8, text);
        image.print({
            font: font8,
            // Nudged inside the plot when the peak sits against an edge.
            x: Math.min(PLOT.x1 - width, Math.max(PLOT.x0, peakPoint.x - Math.round(width / 2))),
            y: Math.max(PLOT.y0 - 2, peakPoint.y - 18),
            text,
        });
    }
    hLine(image, PLOT.x0, PLOT.x1, PLOT.y1, axis);
    // Time labels along the bottom, first left-aligned and last right-aligned so
    // neither runs off the edge.
    labels.ticks.forEach((text, index) => {
        const width = measureText(font8, text);
        const centre = xFor((index / Math.max(1, labels.ticks.length - 1)) * (buckets.length - 1));
        const x = index === 0
            ? PLOT.x0
            : index === labels.ticks.length - 1
                ? PLOT.x1 - width
                : Math.round(centre - (width / 2));
        image.print({ font: font8, x, y: PLOT.y1 + 8, text });
    });
    image.print({ font: font16, x: PAD.left, y: 6, text: labels.heading });
    return image.getBuffer(JimpMime.png);
}
//# sourceMappingURL=chart.js.map