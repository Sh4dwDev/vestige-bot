import { EmbedBuilder, type Client } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './bridge.js';
import {
  baseImage, decodes, forgetBaseImage, renderHeatmap, toFraction,
} from './heatimage.js';
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
const RAMP = [' ', '.', ':', 'o', 'O', '#', '@'] as const;

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface Point {
  x: number;
  y: number;
}

export function setHeatmapChannel(ctx: Ctx, channelId: string | null): void {
  const current = ctx.db.getSetting(CHANNEL_KEY) || '';
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');

  // Only forget the panel when it is moving somewhere else. Re-running the
  // command against the channel it is already in should refresh the panel that
  // is there, not abandon it and leave a dead copy above the new one.
  if ((channelId ?? '') !== current) ctx.db.setSetting(HEATMAP_MESSAGE_KEY, '');
}

export function heatmapChannel(ctx: Ctx): string | null {
  return ctx.db.getSetting(CHANNEL_KEY) || null;
}

export function heatmapMinutes(ctx: Ctx): number {
  const raw = Number.parseInt(ctx.db.getSetting(MINUTES_KEY) ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MINUTES;
}

export function setHeatmapMinutes(ctx: Ctx, minutes: number): void {
  ctx.db.setSetting(MINUTES_KEY, String(minutes));
}

const IMAGE_KEY = 'heatmap_image';

export function heatmapImageUrl(ctx: Ctx): string {
  return ctx.db.getSetting(IMAGE_KEY) || '';
}

export function setHeatmapImage(ctx: Ctx, url: string | null): void {
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
export function setManualBounds(
  ctx: Ctx,
  latMin: number, latMax: number, longMin: number, longMax: number,
): Bounds {
  // The HUD shows world units over a thousand, so that is the scale admins
  // read off an interactive map and the scale they type here.
  const bounds: Bounds = {
    minY: latMin * 1000, maxY: latMax * 1000,
    minX: longMin * 1000, maxX: longMax * 1000,
  };
  saveBounds(ctx, bounds);
  ctx.db.setSetting('heatmap_manual', '1');
  return bounds;
}

export function boundsAreManual(ctx: Ctx): boolean {
  return ctx.db.getSetting('heatmap_manual') === '1';
}

export function storedBounds(ctx: Ctx): Bounds | null {
  const raw = ctx.db.getSetting(BOUNDS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Bounds>;
    const ok = (['minX', 'maxX', 'minY', 'maxY'] as const)
      .every((k) => typeof parsed[k] === 'number' && Number.isFinite(parsed[k]));
    return ok ? (parsed as Bounds) : null;
  } catch {
    return null;
  }
}

export function saveBounds(ctx: Ctx, bounds: Bounds): void {
  ctx.db.setSetting(BOUNDS_KEY, JSON.stringify(bounds));
}

export function resetBounds(ctx: Ctx): void {
  ctx.db.setSetting(BOUNDS_KEY, '');
  ctx.db.setSetting('heatmap_manual', '');
}

/**
 * Where the hexagon stands, read off the HUD while standing in it.
 *
 * This is a measurement rather than a guess, and it is the one fixed point the
 * whole picture hangs from. The fractions are where that structure sits in the
 * supplied map image, found by scanning the file for it and confirmed by
 * drawing a crosshair at the result.
 */
const DOME = {
  y: 114_107.9,
  x: -40_634.8,
  fx: 0.4138,
  /** Measured down from the top of the picture. */
  fy: 0.6531,
};

/**
 * How wide the picture is in world units, which is the part still estimated.
 *
 * Briefly widened to 1,100,000 to stop players drawing in the sea below the
 * island. That was treating a symptom. They were not too far south because the
 * picture was too narrow — they were mirrored, because Lat grows southward and
 * every conversion assumed it grew northward. Widening the picture to fit a
 * mirrored position is fitting the wrong curve, so it is back at 800,000 now
 * the direction is right.
 *
 * Still an estimate. It puts the highlands at 33% down against a crater
 * measured at 30%, which is close enough to be believable and not close enough
 * to call measured. Superseded the moment two landmarks are calibrated.
 */
const ASSUMED_SPAN = 800_000;

/**
 * The island, anchored on the hexagon and scaled by the estimate above.
 *
 * Anchoring beats centring on the origin: the world is not centred on the
 * origin, and assuming it was is what put the hexagon in the wrong place to
 * begin with.
 */
export const DEFAULT_BOUNDS: Bounds = {
  minX: DOME.x - (DOME.fx * ASSUMED_SPAN),
  maxX: DOME.x - (DOME.fx * ASSUMED_SPAN) + ASSUMED_SPAN,
  // No flip: the picture grows downward and so does Lat, so the fraction from
  // the top is used as it stands. minY is the NORTHERN edge.
  minY: DOME.y - (DOME.fy * ASSUMED_SPAN),
  maxY: DOME.y - (DOME.fy * ASSUMED_SPAN) + ASSUMED_SPAN,
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
export function effectiveBounds(ctx: Ctx, learned: Bounds | null): Bounds {
  if (learned && boundsAreManual(ctx)) return learned;
  return DEFAULT_BOUNDS;
}

/**
 * Widens known bounds to include everything just seen.
 *
 * Only ever grows. Shrinking to fit whoever happens to be online would make the
 * grid mean something different every refresh, and a panel whose axes move is
 * not a map of anything.
 */
export function widen(bounds: Bounds | null, points: Point[]): Bounds | null {
  if (points.length === 0) return bounds;

  const next: Bounds = bounds ? { ...bounds } : {
    minX: points[0]!.x, maxX: points[0]!.x, minY: points[0]!.y, maxY: points[0]!.y,
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
export function grid(points: Point[], bounds: Bounds): number[][] {
  const cells: number[][] = Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));

  for (const point of points) {
    // Shared with the drawn map, so the grid and the picture cannot disagree
    // about which way is north.
    const { fx, fy } = toFraction(point, bounds);

    const col = Math.min(COLS - 1, Math.max(0, Math.floor(fx * COLS)));
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor(fy * ROWS)));

    cells[row]![col] = (cells[row]![col] ?? 0) + 1;
  }

  return cells;
}

/** The grid as a monospace block, scaled so the busiest cell is the darkest. */
export function render(cells: number[][]): string {
  const peak = Math.max(1, ...cells.flat());

  const lines = cells.map((row) => row.map((count) => {
    if (count === 0) return RAMP[0];
    const step = Math.ceil((count / peak) * (RAMP.length - 1));
    return RAMP[Math.min(RAMP.length - 1, Math.max(1, step))];
  }).join(''));

  return ['```', ...lines, '```'].join('\n');
}

/** In-game HUD coordinates: the game shows world units over a thousand. */
const hud = (world: number): string => (world / 1000).toFixed(0);

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
export function hotspots(
  points: Point[],
  bounds: Bounds,
  limit = 3,
): Array<{ lat: string; long: string; count: number }> {
  if (points.length === 0) return [];

  // Grouped by grid cell, since that is the same grouping the picture shows.
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const clusters = new Map<string, Point[]>();

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

export function buildHeatmapEmbed(
  points: Point[],
  bounds: Bounds | null,
  options: { unreachable?: boolean; minutes?: number } = {},
): EmbedBuilder {
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
  embed.setImage('attachment://heatmap.png');

  if (points.length === 0 || !bounds) {
    return embed.setColor(0x4f545c)
      .setDescription('🌙  **All quiet.** Nobody is out there right now.');
  }

  const spots = hotspots(points, bounds);

  return embed
    .setColor(0x5865f2)
    .setDescription(
      `**${points.length}** on the island. North is up.` +
      (spots.length > 0
        ? '\n\n**Busiest right now**\n' + spots
          .map((s) => `**${s.count}** around Lat \`${s.lat}\` Long \`${s.long}\``)
          .join('\n')
        : '') +
      '\n\nCoordinates match your in-game HUD.',
    );
}

/** Positions from the mod, skipping anyone whose pawn would not give one. */
export function pointsFrom(players: PlayerRow[]): Point[] {
  return players
    .filter((p): p is PlayerRow & Point =>
      typeof p.x === 'number' && typeof p.y === 'number'
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
export async function resolveMapImage(ctx: Ctx): Promise<Buffer | null> {
  const local = await baseImage(heatmapImageUrl(ctx));
  if (local) return local;

  const remote = await ctx.mod.findFile(SERVER_MAP_MATCH).catch(() => null);
  if (remote && remote.length > 0 && await decodes(remote)) return remote;
  return null;
}

export function startHeatmapPanel(ctx: Ctx, client: Client, log: (m: string) => void): void {
  const tick = async (): Promise<void> => {
    const channelId = heatmapChannel(ctx);
    if (!channelId) return;

    let embed: EmbedBuilder;
    let bounds = storedBounds(ctx);
    let points: Point[] = [];

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

      embed = buildHeatmapEmbed(points, effectiveBounds(ctx, bounds),
        { minutes: heatmapMinutes(ctx) });
    } catch {
      // A panel that vanishes when the server hiccups looks broken.
      embed = buildHeatmapEmbed([], null, { unreachable: true });
    }

    try {
      const picture = await renderHeatmap(
        points, effectiveBounds(ctx, bounds), await resolveMapImage(ctx),
      );
      await postOrEdit(ctx.db, client, channelId, HEATMAP_MESSAGE_KEY, [embed], [],
        [{ attachment: picture, name: 'heatmap.png' }]);
    } catch (err) {
      log(`heatmap: could not post: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Checked every minute, but only refreshed when the chosen interval is up:
  // this is the one panel somebody will want to turn down, and editing a
  // message every minute when they asked for fifteen is just rate limit spend.
  let lastRun = 0;
  const due = async (): Promise<void> => {
    if (Date.now() - lastRun < heatmapMinutes(ctx) * 60_000) return;
    lastRun = Date.now();
    await tick();
  };

  setInterval(() => void due(), 60_000).unref();
  void due();
}
