import type { Ctx } from './commands.js';
export declare function enforcementEnabled(ctx: Ctx): boolean;
export declare function setEnforcement(ctx: Ctx, enabled: boolean): void;
/** Set when a verified write failed to take, so the reason survives a restart. */
export declare function enforcementFault(ctx: Ctx): string | null;
export interface PlayableSync {
    /** Species that should not be spawnable right now. */
    remove: string[];
    /** Species wrongly missing from the menu. */
    add: string[];
}
/**
 * Pure: what has to change to make `live` match the caps.
 *
 * `known` is every species this build has, so a species removed earlier can be
 * added back even though it is currently absent from `live`.
 */
export declare function diffPlayables(caps: Array<{
    species: string;
    cap: number;
    locked: boolean;
}>, live: string[], known: string[]): PlayableSync;
/**
 * Brings the spawn menu in line with the caps.
 *
 * Returns what it changed. A thrown RCON error is left to the caller — the
 * population poll swallows those, and a server that is down has no menu to fix.
 */
export declare function syncPlayables(ctx: Ctx, known: string[], log: (m: string) => void): Promise<PlayableSync & {
    verified: boolean;
}>;
/**
 * Puts every species back, used when enforcement is switched off and on
 * startup if it is off — otherwise a species locked when the bot died stays
 * unspawnable with nothing left to unlock it.
 */
export declare function restoreAllPlayables(ctx: Ctx, known: string[], log: (m: string) => void): Promise<string[]>;
