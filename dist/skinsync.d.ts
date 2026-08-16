import type { Ctx } from './commands.js';
import type { PlayerRow } from './bridge.js';
/** Called when a pawn is replaced, so the next poll repaints it. */
export declare function skinNeedsReapply(steamId: string): void;
export declare function forgetPainted(steamId: string): void;
export declare function reapplySkins(ctx: Ctx, players: PlayerRow[], log: (m: string) => void): Promise<void>;
