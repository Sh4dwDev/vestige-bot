import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
export interface GrowthFloor {
    /** 0.05 to 1. */
    growth: number;
    heal: boolean;
}
export declare function growthFloor(ctx: Ctx): GrowthFloor | null;
export declare function setGrowthFloor(ctx: Ctx, percent: number | null, heal?: boolean): void;
/**
 * Who is currently below the floor.
 *
 * Pure, and reads the growth already in the player row rather than asking the
 * server, so deciding costs nothing. Only the growing itself is a round trip.
 */
export declare function belowFloor(players: PlayerRow[], floor: GrowthFloor): string[];
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
export declare function runGrowthFloor(ctx: Ctx, players: PlayerRow[], log: (m: string) => void): Promise<number>;
