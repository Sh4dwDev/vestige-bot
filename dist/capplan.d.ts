import type { Ctx } from './commands.js';
/**
 * A starting set of population caps, as a share of the server's slots.
 *
 * Written **per 100 players** so the numbers read as percentages, then scaled
 * to whatever `MaxPlayerCount` actually says. A cap table hardcoded to 100 goes
 * quietly wrong the day the slot count changes.
 *
 * The shape of it: apexes bind almost always, mid tiers bind only on a busy
 * night, and the small stuff never binds at all. That last part matters — a cap
 * table where every species can fill up is one where a player who logs in late
 * has nothing to play.
 *
 * These are a **starting point**, not a rule. Every one can be moved with
 * `/admin species cap`.
 */
/** Caps per 100 slots. Anything the server has that is not listed stays uncapped. */
export declare const PER_HUNDRED: Record<string, number>;
export interface PlannedCap {
    species: string;
    cap: number;
    tier: number;
}
/**
 * Scales the table to the real slot count.
 *
 * Only species the server actually reports are included — writing a cap for a
 * name this build does not have creates a row that can never unlock, and it
 * would show in the panel as a species nobody can play.
 */
export declare function planCaps(ctx: Ctx, maxPlayers: number, available: string[]): PlannedCap[];
export declare function applyCaps(ctx: Ctx, planned: PlannedCap[]): void;
