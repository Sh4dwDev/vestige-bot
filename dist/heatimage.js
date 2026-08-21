import fs from 'node:fs/promises';
import { Jimp, JimpMime } from 'jimp';
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
/**
 * How far one player's heat reaches, in pixels.
 *
 * Tighter than it was. The same heat spread over a wide disc is a faint wash
 * nobody can pick out against terrain; concentrated, it is a mark you can find
 * at a glance.
 */
const RADIUS = 52;
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
 * How hard the low end is lifted.
 *
 * A flat floor was tried first and gave every blob a hard circular edge: if the
 * faintest pixel in the radius paints at a third strength, the rim of the disc
 * is a step rather than a fade. A power curve lifts the quiet values just as
 * much but still passes through zero, so a lone player is easy to spot and the
 * edge of the glow still melts into the map.
 */
const LIFT = 0.55;
const MAX_WEIGHT = 0.88;
/**
 * Cold to hot: bright blue, through cyan, to green at the centre of a crowd.
 *
 * The cold end is **light**, not navy. It was navy, and mixed a third of the
 * way over sunlit grass that is very nearly no change at all — the low end has
 * to contrast with the map, not sink into it.
 */
const RAMP = [
    { at: 0.00, rgb: [90, 170, 255] },
    { at: 0.30, rgb: [60, 200, 255] },
    { at: 0.58, rgb: [50, 235, 225] },
    { at: 0.80, rgb: [70, 250, 170] },
    { at: 1.00, rgb: [150, 255, 110] },
];
function colourFor(t) {
    const clamped = Math.max(0, Math.min(1, t));
    for (let i = 1; i < RAMP.length; i += 1) {
        const low = RAMP[i - 1];
        const high = RAMP[i];
        if (clamped > high.at && i < RAMP.length - 1)
            continue;
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
/**
 * Where a world position sits in the picture, as fractions from the top left.
 *
 * **The world's Y grows southward.** The hexagon reads Lat 114, and the
 * highlands north of it read Lat -143. So a larger Lat is further DOWN the
 * picture, not up.
 *
 * That sign was wrong from the first version and outlived every other fix,
 * because it is invisible while everyone stands in one place. Walking north
 * moved the dot south, and the symptom kept getting blamed on the bounds. Every
 * conversion goes through here now, so there is exactly one place for it to be
 * right or wrong.
 *
 * `minY` is therefore the NORTHERN edge of the picture - the smallest Lat - and
 * `maxY` the southern. The rectangle stays an ordinary one, min below max.
 */
export function toFraction(point, bounds) {
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    // Everybody on one spot gives a zero span; dividing by it is NaN, and a NaN
    // pixel index silently draws nothing at all.
    return {
        fx: spanX !== 0 ? (point.x - bounds.minX) / spanX : 0.5,
        fy: spanY !== 0 ? (point.y - bounds.minY) / spanY : 0.5,
    };
}
/** World coordinates to pixels, measured from the top left. */
export function toPixel(point, bounds, size = SIZE) {
    const { fx, fy } = toFraction(point, bounds);
    const clamp = (f) => Math.max(0, Math.min(1, f));
    return {
        px: Math.round(clamp(fx) * (size - 1)),
        py: Math.round(clamp(fy) * (size - 1)),
    };
}
/** A faint grid, so an empty map is not an unreadable dark square. */
function drawGrid(image, size) {
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
function makeCanvas(size) {
    return new Jimp({ width: size, height: size, color: 0x11141bff });
}
/**
 * Draws the heat over a base image and returns a PNG.
 *
 * Always returns a picture, including with nobody online: a panel that swaps
 * between an image and a line of text looks broken rather than quiet.
 */
export async function renderHeatmap(points, bounds, base, size = SIZE) {
    const image = makeCanvas(size);
    if (base) {
        image.composite((await Jimp.read(base)).resize({ w: size, h: size }), 0, 0);
    }
    else {
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
                    if (d > 1)
                        continue;
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
                if (value <= 0.012)
                    continue;
                // Saturating curve rather than a clamp. Clamping made a crowd render as
                // a flat green puck: everything past the ceiling came out identical, so
                // the gradient inside the blob disappeared. This approaches full heat
                // without ever reaching it, so a cluster keeps a bright core and a soft
                // edge however many people pile in.
                const t = 1 - Math.exp(-value / FULL_HEAT);
                const [r, g, b] = colourFor(t);
                // Never opaque: the map has to stay visible through it, which is the
                // difference between a heatmap and a sheet of coloured plastic.
                const weight = MAX_WEIGHT * (t ** LIFT);
                const existing = image.getPixelColor(x, y);
                // Blend toward the heat colour rather than adding to what is there.
                // Adding light works on the dark greyscale maps these are usually drawn
                // on, but this island is bright green — every hot core came out white,
                // because adding to an already-bright pixel saturates all three
                // channels. Mixing keeps the hue, so hot still reads as green.
                const add = (over, under) => Math.round((over * weight) + (under * (1 - weight)));
                image.setPixelColor((((add(r, (existing >>> 24) & 0xff) << 24) >>> 0)
                    + (add(g, (existing >>> 16) & 0xff) << 16)
                    + (add(b, (existing >>> 8) & 0xff) << 8) + 0xff) >>> 0, x, y);
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
 * `data/` because that directory already exists on the host and is already
 * where the bot keeps its own files, and the bot root because that is where
 * somebody uploading through a file manager tends to drop things.
 */
export const SEARCH_DIRS = ['data', '.'];
/** Anything named like a map, whatever the case or extension. */
const LOOKS_LIKE_A_MAP = /^map.*\.(png|jpe?g|webp)$/i;
export const DEFAULT_PATHS = ['data/map.png'];
/**
 * Every image the bot can see that looks like a map, and everything else in
 * those directories — so a failure can say what it actually found rather than
 * only that it found nothing.
 */
export async function findMaps() {
    const maps = [];
    const sawInstead = [];
    for (const dir of SEARCH_DIRS) {
        let entries;
        try {
            entries = await fs.readdir(dir);
        }
        catch {
            continue;
        }
        for (const name of entries) {
            const full = dir === '.' ? name : `${dir}/${name}`;
            if (LOOKS_LIKE_A_MAP.test(name))
                maps.push(full);
            else if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(name))
                sawInstead.push(full);
        }
    }
    return { maps, sawInstead };
}
/** Cached by source AND mtime, so replacing the file on disk is picked up. */
let cached = null;
async function readLocal(file) {
    try {
        const stat = await fs.stat(file);
        if (!stat.isFile())
            return null;
        return { key: `${file}:${stat.mtimeMs}`, data: await fs.readFile(file) };
    }
    catch {
        return null;
    }
}
/**
 * The map picture: a file on the host, or a link, or nothing.
 *
 * `source` empty means look in the default places. A value containing `://` is
 * fetched; anything else is read as a path relative to where the bot runs.
 */
export async function baseImage(source) {
    const trimmed = source.trim();
    if (!trimmed || !trimmed.includes('://')) {
        // An explicit path first, then anything in the usual places that looks
        // like a map. Case-insensitive and loose about the exact name, because
        // "Map.PNG" and "map-v3.png" are the same intent.
        const candidates = trimmed
            ? [trimmed, ...(await findMaps()).maps]
            : (await findMaps()).maps;
        for (const file of candidates) {
            const found = await readLocal(file);
            if (!found)
                continue;
            if (cached?.key === found.key)
                return cached.data;
            try {
                // Prove it decodes now rather than failing inside the panel later.
                await Jimp.read(found.data);
                cached = found;
                return found.data;
            }
            catch {
                // Not an image after all. Skip it: somebody will eventually drop a
                // readme or a corrupt download in that folder.
            }
        }
        return null;
    }
    if (cached?.key === trimmed)
        return cached.data;
    try {
        const response = await fetch(trimmed);
        if (!response.ok)
            return null;
        const data = Buffer.from(await response.arrayBuffer());
        await Jimp.read(data);
        cached = { key: trimmed, data };
        return data;
    }
    catch {
        return null;
    }
}
/**
 * What a file actually is, from its first bytes.
 *
 * The extension is not evidence. A picture saved from a browser as `map.png`
 * is very often a WebP, jimp reads the bytes rather than the name, and refuses
 * it — which surfaced as "no map" with nothing pointing at the real cause.
 * Naming the true format turns that into a one-line fix.
 */
export function sniffFormat(data) {
    if (data.length < 12)
        return 'not an image';
    const head = data.subarray(0, 12);
    if (head[0] === 0x89 && head.subarray(1, 4).toString('latin1') === 'PNG')
        return 'PNG';
    if (head[0] === 0xff && head[1] === 0xd8)
        return 'JPEG';
    if (head.subarray(0, 4).toString('latin1') === 'RIFF'
        && head.subarray(8, 12).toString('latin1') === 'WEBP')
        return 'WebP';
    if (head.subarray(0, 3).toString('latin1') === 'GIF')
        return 'GIF';
    if (head.subarray(0, 2).toString('latin1') === 'BM')
        return 'BMP';
    return 'not a picture the bot recognises';
}
/** Formats jimp can actually draw on. WebP is readable by neither. */
export const SUPPORTED = ['PNG', 'JPEG', 'BMP'];
/** Whether a buffer is actually an image this can draw on. */
export async function decodes(data) {
    try {
        await Jimp.read(data);
        return true;
    }
    catch {
        return false;
    }
}
export function forgetBaseImage() {
    cached = null;
}
//# sourceMappingURL=heatimage.js.map