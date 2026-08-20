import type { Ctx } from './commands.js';
import type { PlayerRow } from './bridge.js';
/** Called when a pawn is replaced, so the next poll repaints it. */
export declare function skinNeedsReapply(steamId: string): void;
export declare function forgetPainted(steamId: string): void;
/**
 * Forget everything, so the next pass repaints regardless.
 *
 * Called when the server has been unreachable: a restart gives everyone a new
 * pawn, but the bot never sees them leave — the poll simply fails — so without
 * this it concludes they are still painted and leaves them plain. That is
 * exactly the "skins do not survive a restart" case.
 */
export declare function forgetAllPainted(): void;
export declare const DEFAULT_EXPIRY_HOURS = 6;
export declare function skinExpiryHours(ctx: Ctx): number;
export declare function setSkinExpiryHours(ctx: Ctx, hours: number): void;
/** Called from the poll. Returns how many were forgotten. */
export declare function expireOldSkins(ctx: Ctx, log: (m: string) => void): number;
export declare function reapplySkins(ctx: Ctx, players: PlayerRow[], log: (m: string) => void): Promise<void>;
