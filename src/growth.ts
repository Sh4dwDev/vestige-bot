import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';

/**
 * A growth floor that keeps applying itself.
 *
 * `/admin ingame grow` on its own is a one-off: it grows whoever happens to be
 * standing there when it runs. For an event that is not enough, because the
 * first thing that happens after a fight is somebody respawning as a juvenile
 * and being useless for the next hour.
 *
 * With the floor switched on, anybody who turns up smaller than it is grown to
 * it, for as long as it is on. It is a floor and never a ceiling: nothing here
 * ever shrinks anybody, because taking size away from somebody who earned it is
 * a different and much worse thing than handing it out.
 */

const PERCENT_KEY = 'grow_floor_percent';
const HEAL_KEY = 'grow_floor_heal';

/** Below this and it is not worth a round trip; growth reads back imprecisely. */
const SLACK = 0.01;

export interface GrowthFloor {
  /** 0.05 to 1. */
  growth: number;
  heal: boolean;
}

export function growthFloor(ctx: Ctx): GrowthFloor | null {
  const raw = Number.parseInt(ctx.db.getSetting(PERCENT_KEY) ?? '', 10);
  if (!Number.isFinite(raw) || raw < 5 || raw > 100) return null;

  return { growth: raw / 100, heal: ctx.db.getSetting(HEAL_KEY) !== '0' };
}

export function setGrowthFloor(ctx: Ctx, percent: number | null, heal = true): void {
  ctx.db.setSetting(PERCENT_KEY, percent === null ? '' : String(percent));
  ctx.db.setSetting(HEAL_KEY, heal ? '1' : '0');
}

/**
 * Who is currently below the floor.
 *
 * Pure, and reads the growth already in the player row rather than asking the
 * server, so deciding costs nothing. Only the growing itself is a round trip.
 */
export function belowFloor(players: PlayerRow[], floor: GrowthFloor): string[] {
  return players
    .filter((p) => p.steam !== undefined && p.steam !== ''
      && typeof p.growth === 'number'
      && p.growth < floor.growth - SLACK)
    .map((p) => p.steam as string);
}

/**
 * Grows everybody who has dropped below the floor.
 *
 * Called from the minute tick, so a respawn is caught within a minute rather
 * than instantly. That is deliberate: growing somebody the same second they
 * spawn lands in the middle of the engine settling a new pawn, and the restore
 * path already learned that bulk writes in that window are rejected.
 *
 * Never throws. A floor that cannot be applied must not stop the payout tick it
 * shares a pass with.
 */
export async function runGrowthFloor(
  ctx: Ctx,
  players: PlayerRow[],
  log: (m: string) => void,
): Promise<number> {
  const floor = growthFloor(ctx);
  if (!floor) return 0;

  const small = belowFloor(players, floor);
  if (small.length === 0) return 0;

  let grown = 0;
  for (const steamId of small) {
    try {
      const result = await ctx.mod.run('grow', steamId, {
        growth: floor.growth,
        heal: floor.heal,
      }, { quiet: true });
      if (result.ok) grown += 1;
    } catch {
      // Server unreachable, or a pawn mid-transition. Next pass tries again.
    }
  }

  if (grown > 0) {
    log(`growth: floor of ${Math.round(floor.growth * 100)}% applied to ${grown}`);
  }
  return grown;
}
