import { EmbedBuilder, type Client } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './bridge.js';
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
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
  ctx.db.setSetting(HEATMAP_MESSAGE_KEY, '');
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

  // A single point, or everybody stood on one spot, gives a zero-width range.
  // Dividing by that is a NaN column, so it collapses to the middle instead.
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;

  for (const point of points) {
    const fx = spanX > 0 ? (point.x - bounds.minX) / spanX : 0.5;
    const fy = spanY > 0 ? (point.y - bounds.minY) / spanY : 0.5;

    const col = Math.min(COLS - 1, Math.max(0, Math.floor(fx * COLS)));
    // Y grows north, and the top row of the grid is north, so it is flipped.
    const row = Math.min(ROWS - 1, Math.max(0, Math.floor((1 - fy) * ROWS)));

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

/** The busiest cells, described in coordinates somebody can actually go to. */
export function hotspots(
  cells: number[][],
  bounds: Bounds,
  limit = 3,
): Array<{ lat: string; long: string; count: number }> {
  const found: Array<{ row: number; col: number; count: number }> = [];
  cells.forEach((row, r) => row.forEach((count, c) => {
    if (count > 0) found.push({ row: r, col: c, count });
  }));

  return found
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((cell) => {
      // The middle of the cell, which is as precise as a grid can honestly be.
      const fx = (cell.col + 0.5) / COLS;
      const fy = 1 - ((cell.row + 0.5) / ROWS);
      return {
        long: hud(bounds.minX + (fx * (bounds.maxX - bounds.minX))),
        lat: hud(bounds.minY + (fy * (bounds.maxY - bounds.minY))),
        count: cell.count,
      };
    });
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

  if (points.length === 0 || !bounds) {
    return embed.setColor(0x4f545c)
      .setDescription('## 🌙  All quiet\nNobody is out there right now.');
  }

  const cells = grid(points, bounds);
  const spots = hotspots(cells, bounds);

  return embed
    .setColor(0x5865f2)
    .setDescription(
      `**${points.length}** on the island. North is up.\n` +
      render(cells) +
      (spots.length > 0
        ? '\n**Busiest right now**\n' + spots
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

export function startHeatmapPanel(ctx: Ctx, client: Client, log: (m: string) => void): void {
  const tick = async (): Promise<void> => {
    const channelId = heatmapChannel(ctx);
    if (!channelId) return;

    let embed: EmbedBuilder;
    let bounds = storedBounds(ctx);

    try {
      const points = pointsFrom(await ctx.mod.players());

      // Learn the map from where people actually go, and keep it.
      const widened = widen(bounds, points);
      if (widened && JSON.stringify(widened) !== JSON.stringify(bounds)) {
        saveBounds(ctx, widened);
        bounds = widened;
      }

      embed = buildHeatmapEmbed(points, bounds, { minutes: heatmapMinutes(ctx) });
    } catch {
      // A panel that vanishes when the server hiccups looks broken.
      embed = buildHeatmapEmbed([], null, { unreachable: true });
    }

    await postOrEdit(ctx.db, client, channelId, HEATMAP_MESSAGE_KEY, [embed])
      .catch((err: unknown) => {
        log(`heatmap: could not post: ${err instanceof Error ? err.message : String(err)}`);
      });
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
