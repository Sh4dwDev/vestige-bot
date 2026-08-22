import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { baseImage, decodes, forgetBaseImage, renderHeatmap, toFraction, } from './heatimage.js';
import { postOrEdit } from './pinned.js';
/**
 * Where everybody is, as a panel.
 *
 * Rendered as a text grid rather than a picture. A drawn map would need the
 * game's own map image shipped in the repo, and a set of world-to-pixel numbers
 * nobody has published — so it would be a copyright question answered with
 * guessed constants. A grid needs neither and says the same thing: where the
 * island is busy and where it is empty.
 *
 * **The bounds calibrate themselves.** The playable extent of Isle V3 is not
 * documented anywhere I could find, and inventing numbers would put everybody
 * in one corner of a grid that is mostly empty. So the panel widens its own
 * bounds as it sees people, and remembers them. It is roughly right after one
 * busy evening and exact after a few.
 *
 * Coordinates are shown the way the game shows them — the in-game HUD reads
 * Lat/Long as world units over a thousand — so a cluster on the panel can be
 * matched to what somebody reads off their own screen.
 */
const CHANNEL_KEY = 'heatmap_channel';
export const HEATMAP_MESSAGE_KEY = 'heatmap_message';
const MINUTES_KEY = 'heatmap_minutes';
const BOUNDS_KEY = 'heatmap_bounds';
export const DEFAULT_MINUTES = 5;
/** Wide enough to see clusters, narrow enough to read on a phone. */
export const COLS = 24;
export const ROWS = 12;
/** Density ramp. Space reads as empty far better than a dot does. */
const RAMP = [' ', '.', ':', 'o', 'O', '#', '@'];
export function setHeatmapChannel(ctx, channelId) {
    const current = ctx.db.getSetting(CHANNEL_KEY) || '';
    ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
    // Only forget the panel when it is moving somewhere else. Re-running the
    // command against the channel it is already in should refresh the panel that
    // is there, not abandon it and leave a dead copy above the new one.
    if ((channelId ?? '') !== current)
        ctx.db.setSetting(HEATMAP_MESSAGE_KEY, '');
}
export function heatmapChannel(ctx) {
    return ctx.db.getSetting(CHANNEL_KEY) || null;
}
export function heatmapMinutes(ctx) {
    const raw = Number.parseInt(ctx.db.getSetting(MINUTES_KEY) ?? '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MINUTES;
}
export function setHeatmapMinutes(ctx, minutes) {
    ctx.db.setSetting(MINUTES_KEY, String(minutes));
}
const IMAGE_KEY = 'heatmap_image';
export function heatmapImageUrl(ctx) {
    return ctx.db.getSetting(IMAGE_KEY) || '';
}
export function setHeatmapImage(ctx, url) {
    ctx.db.setSetting(IMAGE_KEY, url ?? '');
    forgetBaseImage();
}
/**
 * Bounds an admin set by hand, in the Lat/Long the game shows.
 *
 * Self-calibration is fine for a bare grid, but it cannot line up with a real
 * map picture: the corners of the image are fixed and the learned bounds are
 * whatever people happened to walk to. Setting them makes the dots land in the
 * right place.
 */
export function setManualBounds(ctx, latMin, latMax, longMin, longMax) {
    // The HUD shows world units over a thousand, so that is the scale admins
    // read off an interactive map and the scale they type here.
    const bounds = {
        minY: latMin * 1000, maxY: latMax * 1000,
        minX: longMin * 1000, maxX: longMax * 1000,
    };
    saveBounds(ctx, bounds);
    ctx.db.setSetting('heatmap_manual', '1');
    return bounds;
}
export function boundsAreManual(ctx) {
    return ctx.db.getSetting('heatmap_manual') === '1';
}
/**
 * Puts a rectangle the right way round.
 *
 * A rectangle whose min is above its max is never a legitimate state, but it is
 * an easy one to write: calibrating under the old code — which had latitude
 * running the wrong way — stored the southern edge as `minY` and the northern
 * as `maxY`. The bounds outlived the code that made them, sitting in the
 * database long after the sign was fixed.
 *
 * The renderer then divided by a negative span and mirrored the island, so a
 * corrected build kept drawing the old, wrong map and every fix looked like it
 * had failed to deploy. Swapping here costs nothing and makes that whole class
 * of stale state harmless.
 */
function normalise(bounds) {
    return {
        minX: Math.min(bounds.minX, bounds.maxX),
        maxX: Math.max(bounds.minX, bounds.maxX),
        minY: Math.min(bounds.minY, bounds.maxY),
        maxY: Math.max(bounds.minY, bounds.maxY),
    };
}
export function storedBounds(ctx) {
    const raw = ctx.db.getSetting(BOUNDS_KEY);
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        const ok = ['minX', 'maxX', 'minY', 'maxY']
            .every((k) => typeof parsed[k] === 'number' && Number.isFinite(parsed[k]));
        return ok ? normalise(parsed) : null;
    }
    catch {
        return null;
    }
}
export function saveBounds(ctx, bounds) {
    ctx.db.setSetting(BOUNDS_KEY, JSON.stringify(normalise(bounds)));
}
export function resetBounds(ctx) {
    ctx.db.setSetting(BOUNDS_KEY, '');
    ctx.db.setSetting('heatmap_manual', '');
}
/**
 * Two places somebody stood and read the HUD, and where each sits in the map
 * picture.
 *
 * These are measurements. Everything before them was a guess at how big the
 * world is, and every guess was wrong in a way that only showed up far from
 * wherever the last one had been anchored.
 *
 * The picture fractions were found by scanning the image file — the hexagon by
 * its bright low-saturation shape, the crater by its bare rock — and both were
 * confirmed by drawing a crosshair at the result and looking at it.
 */
const HEXAGON = {
    y: 114_107.898,
    x: -40_634.836,
    fx: 0.4138,
    /** Measured down from the top of the picture. */
    fy: 0.6531,
};
const CRATER = {
    y: -278_431.438,
    x: 267_709.266,
    fx: 0.6760,
    fy: 0.2983,
};
/**
 * How wide the picture is in world units, which is the part still estimated.
 *
 * How much world the picture covers, solved from the two landmarks above
 * rather than guessed. A single anchor fixes where the map sits but not how
 * big it is, which is why every earlier version was exact at one spot and
 * wrong everywhere else - and why "walk north" kept landing in the wrong
 * place by an amount that grew with the distance walked.
 *
 * The two axes come out 6% apart, where a square world in a 975x977 picture
 * would give the same number twice. The likeliest cause is the crater
 * fraction: it is the centre of the bare rock as the image scan found it,
 * while the reading was taken at the cave mouth inside the crater, and the
 * gap between those is about 17 pixels - well inside a blob whose own spread
 * is 62. Each axis is therefore solved on its own, which costs nothing and
 * lands both known points exactly, instead of assuming a square world and
 * pushing that 6% into one of them.
 */
const SPAN_X = (CRATER.x - HEXAGON.x) / (CRATER.fx - HEXAGON.fx);
const SPAN_Y = (CRATER.y - HEXAGON.y) / (CRATER.fy - HEXAGON.fy);
/**
 * The two anchors, exposed so the running bot can check itself against them.
 *
 * Both are places somebody stood and read the HUD, and both must draw exactly
 * where they sit in the picture. If either does not, the code doing the drawing
 * disagrees with the code that solved the map — which is not a thing that can
 * be diagnosed from a screenshot, and was being guessed at instead.
 */
export const ANCHORS = [
    { label: 'Hexagon', ...HEXAGON },
    { label: 'Crater', ...CRATER },
];
/** The picture, in world coordinates. */
export const DEFAULT_BOUNDS = {
    minX: HEXAGON.x - (HEXAGON.fx * SPAN_X),
    maxX: HEXAGON.x - (HEXAGON.fx * SPAN_X) + SPAN_X,
    // No flip: the picture grows downward and so does Lat, so the fraction from
    // the top is used as it stands. minY is the NORTHERN edge.
    minY: HEXAGON.y - (HEXAGON.fy * SPAN_Y),
    maxY: HEXAGON.y - (HEXAGON.fy * SPAN_Y) + SPAN_Y,
};
/**
 * The bounds actually used to draw.
 *
 * Manual wins, and otherwise the fallback is used rather than what the panel
 * has learned — which is the opposite of what it did at first, and the reason
 * is the ocean.
 *
 * Learned bounds track where **people walk**, so they converge on the outline
 * of the island. The map picture is the island *plus the sea around it*.
 * Stretching one onto the other pushes anybody near a coast off the edge, and
 * it drifts every time somebody swims somewhere new. The fallback at least
 * models the same thing the picture does: a fixed square centred on the origin.
 *
 * Learned bounds are still kept, because they are the honest record of where
 * the playable area actually is, and they are what a proper calibration would
 * be built from.
 */
export function effectiveBounds(ctx, learned) {
    if (learned && boundsAreManual(ctx))
        return learned;
    return DEFAULT_BOUNDS;
}
/**
 * Widens known bounds to include everything just seen.
 *
 * Only ever grows. Shrinking to fit whoever happens to be online would make the
 * grid mean something different every refresh, and a panel whose axes move is
 * not a map of anything.
 */
export function widen(bounds, points) {
    if (points.length === 0)
        return bounds;
    const next = bounds ? { ...bounds } : {
        minX: points[0].x, maxX: points[0].x, minY: points[0].y, maxY: points[0].y,
    };
    for (const point of points) {
        next.minX = Math.min(next.minX, point.x);
        next.maxX = Math.max(next.maxX, point.x);
        next.minY = Math.min(next.minY, point.y);
        next.maxY = Math.max(next.maxY, point.y);
    }
    return next;
}
/** Counts per cell, row 0 being the top of the rendered grid. */
export function grid(points, bounds) {
    const cells = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    for (const point of points) {
        // Shared with the drawn map, so the grid and the picture cannot disagree
        // about which way is north.
        const { fx, fy } = toFraction(point, bounds);
        const col = Math.min(COLS - 1, Math.max(0, Math.floor(fx * COLS)));
        const row = Math.min(ROWS - 1, Math.max(0, Math.floor(fy * ROWS)));
        cells[row][col] = (cells[row][col] ?? 0) + 1;
    }
    return cells;
}
/** The grid as a monospace block, scaled so the busiest cell is the darkest. */
export function render(cells) {
    const peak = Math.max(1, ...cells.flat());
    const lines = cells.map((row) => row.map((count) => {
        if (count === 0)
            return RAMP[0];
        const step = Math.ceil((count / peak) * (RAMP.length - 1));
        return RAMP[Math.min(RAMP.length - 1, Math.max(1, step))];
    }).join(''));
    return ['```', ...lines, '```'].join('\n');
}
/** In-game HUD coordinates: the game shows world units over a thousand. */
const hud = (world) => (world / 1000).toFixed(0);
/**
 * The busiest places, in the coordinates the players are actually standing on.
 *
 * This used to reconstruct a position by inverting the grid maths — cell index
 * back to a fraction, fraction back through the bounds. That was wrong twice
 * over: it reported the middle of a cell rather than where anybody was, and it
 * inherited every error in the bounds, so a guessed extent produced confidently
 * wrong coordinates. A player at Lat -143,646 was reported at Lat 25.
 *
 * The mod already sends exact positions. Averaging the real ones in a cluster
 * is both simpler and correct however wrong the bounds happen to be, because it
 * never converts anything.
 */
export function hotspots(points, bounds, limit = 3) {
    if (points.length === 0)
        return [];
    // Grouped by grid cell, since that is the same grouping the picture shows.
    const spanX = bounds.maxX - bounds.minX;
    const spanY = bounds.maxY - bounds.minY;
    const clusters = new Map();
    for (const point of points) {
        const fx = spanX > 0 ? (point.x - bounds.minX) / spanX : 0.5;
        const fy = spanY > 0 ? (point.y - bounds.minY) / spanY : 0.5;
        const col = Math.min(COLS - 1, Math.max(0, Math.floor(fx * COLS)));
        const row = Math.min(ROWS - 1, Math.max(0, Math.floor((1 - fy) * ROWS)));
        const key = `${row}:${col}`;
        const group = clusters.get(key) ?? [];
        group.push(point);
        clusters.set(key, group);
    }
    return [...clusters.values()]
        .sort((a, b) => b.length - a.length)
        .slice(0, limit)
        .map((group) => ({
        // The middle of where they actually are, not the middle of a cell.
        lat: hud(group.reduce((sum, p) => sum + p.y, 0) / group.length),
        long: hud(group.reduce((sum, p) => sum + p.x, 0) / group.length),
        count: group.length,
    }));
}
export function buildHeatmapEmbed(points, bounds, options = {}) {
    const embed = new EmbedBuilder()
        .setTitle(`🗺️  Where everyone is on ${SERVER}`)
        .setFooter({ text: options.minutes
            ? `Refreshes every ${options.minutes} min · ${SIGNATURE}`
            : SIGNATURE })
        .setTimestamp();
    if (options.unreachable) {
        return embed.setColor(0xed4245)
            .setDescription(`## 🔴  Unreachable\n${SERVER} is not responding.`);
    }
    // The picture is attached by the caller and always present, including on
    // an empty server: a panel that swaps between an image and a line of text
    // reads as broken rather than quiet.
    //
    // **Nothing but the map.** The counts and hotspot coordinates were written
    // before the picture worked, when a list of Lat/Long pairs was the only way
    // to say where anyone was. Now that the heat is drawn where the players are,
    // repeating it in text says the same thing worse — and printing a busiest
    // spot to the nearest thousand units is a hunting aid nobody asked for.
    return embed
        .setColor(points.length > 0 && bounds ? 0x5865f2 : 0x4f545c)
        .setImage('attachment://heatmap.png');
}
/** Positions from the mod, skipping anyone whose pawn would not give one. */
export function pointsFrom(players) {
    return players
        .filter((p) => typeof p.x === 'number' && typeof p.y === 'number'
        && Number.isFinite(p.x) && Number.isFinite(p.y))
        .map((p) => ({ x: p.x, y: p.y }));
}
/** Anything named like a map, beside the mod on the game server. */
export const SERVER_MAP_MATCH = /^map.*\.(png|jpe?g|webp)$/i;
/**
 * The map picture, from wherever it actually is.
 *
 * Three places, in order: whatever an admin configured, a file on the bot host,
 * then the mod directory on the **game** server. The last one matters because
 * the bot and the game run on different hosts, and the game host is the one
 * whose file manager people already have open.
 */
export async function resolveMapImage(ctx) {
    const local = await baseImage(heatmapImageUrl(ctx));
    if (local)
        return local;
    const remote = await ctx.mod.findFile(SERVER_MAP_MATCH).catch(() => null);
    if (remote && remote.length > 0 && await decodes(remote))
        return remote;
    return null;
}
export function startHeatmapPanel(ctx, client, log) {
    const tick = async () => {
        const channelId = heatmapChannel(ctx);
        if (!channelId)
            return;
        let embed;
        let bounds = storedBounds(ctx);
        let points = [];
        try {
            points = pointsFrom(await ctx.mod.players());
            // Learn the map from where people actually go — unless an admin has
            // pinned the bounds to a real map picture, in which case widening them
            // would slide every dot off the landmarks they were aligned to.
            if (!boundsAreManual(ctx)) {
                const widened = widen(bounds, points);
                if (widened && JSON.stringify(widened) !== JSON.stringify(bounds)) {
                    saveBounds(ctx, widened);
                    bounds = widened;
                }
            }
            embed = buildHeatmapEmbed(points, effectiveBounds(ctx, bounds), { minutes: heatmapMinutes(ctx) });
        }
        catch {
            // A panel that vanishes when the server hiccups looks broken.
            embed = buildHeatmapEmbed([], null, { unreachable: true });
        }
        try {
            const picture = await renderHeatmap(points, effectiveBounds(ctx, bounds), await resolveMapImage(ctx));
            await postOrEdit(ctx.db, client, channelId, HEATMAP_MESSAGE_KEY, [embed], [], [{ attachment: picture, name: 'heatmap.png' }]);
        }
        catch (err) {
            log(`heatmap: could not post: ${err instanceof Error ? err.message : String(err)}`);
        }
    };
    // Checked every minute, but only refreshed when the chosen interval is up:
    // this is the one panel somebody will want to turn down, and editing a
    // message every minute when they asked for fifteen is just rate limit spend.
    let lastRun = 0;
    const due = async () => {
        if (Date.now() - lastRun < heatmapMinutes(ctx) * 60_000)
            return;
        lastRun = Date.now();
        await tick();
    };
    setInterval(() => void due(), 60_000).unref();
    void due();
}
//# sourceMappingURL=heatmap.js.map