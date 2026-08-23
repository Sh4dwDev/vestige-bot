import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
export interface Tryout {
    species: string;
    steamId: string;
    until: number;
}
export declare function activeTryout(ctx: Ctx): Tryout | null;
export declare const saveTryout: (ctx: Ctx, tryout: Tryout | null) => void;
export declare const startTryout: (ctx: Ctx, species: string, steamId: string) => Tryout;
export type TryoutEnd = 'spawned' | 'timeout' | null;
/**
 * Whether the window should close, and why.
 *
 * Pure, so both endings can be tested without a server: the admin got what they
 * came for, or they did not and it must close anyway. Leaving it open because
 * somebody wandered off is how a hidden species quietly becomes a public one.
 */
export declare function tryoutEnded(tryout: Tryout, players: PlayerRow[], now: number): TryoutEnd;
/**
 * Closes the window when it is due, taking the species back off the menu.
 *
 * Returns what happened, or null while it is still open.
 */
export declare function advanceTryout(ctx: Ctx, players: PlayerRow[], log: (m: string) => void): Promise<TryoutEnd>;
