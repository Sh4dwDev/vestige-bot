import type { Ctx } from './commands.js';
export declare const DEFAULT_HOURS = 3;
export interface CleanupSettings {
    enabled: boolean;
    hours: number;
    clearAI: boolean;
}
export declare function cleanupSettings(ctx: Ctx): CleanupSettings;
export declare function setCleanupEnabled(ctx: Ctx, enabled: boolean): void;
export declare function setCleanupHours(ctx: Ctx, hours: number): void;
export declare function setCleanupAI(ctx: Ctx, clear: boolean): void;
/** Shares the restart scheduler's clock alignment, so times are predictable. */
export declare function nextCleanup(now: Date, hours: number): Date;
/**
 * True when this cleanup slot is close enough to a restart that the restart
 * should have it instead.
 */
export declare function collidesWithRestart(cleanupAt: Date, restartAt: Date, restartsOn: boolean): boolean;
/** Minutes before a cleanup at which players are told, in game. */
export declare const CLEANUP_WARNINGS: readonly [10, 1];
/**
 * These land in chat as <RCON>, where they persist and wrap, so they can say
 * what is actually about to happen rather than being clipped to a countdown.
 * ASCII only, like everything else the bot sends in game.
 */
export declare function cleanupWarning(minutes: number): string;
export declare function wipeNow(ctx: Ctx, log: (m: string) => void): Promise<boolean>;
/** `AI spawns are now On` / `... now Off` — the reply is the only state readout. */
export declare function aiStateFromReply(reply: string): boolean | null;
export type AIResult = 'cleared' | 'disabled' | 'failed' | 'inverted';
/**
 * Clears AI by cycling it off and back on.
 *
 * `ToggleAI` is a toggle, not a setter, and there is no separate way to read
 * the current state — but the reply names the state it landed in, so one flip
 * doubles as the readout.
 *
 * That matters more than it looks. A blind "flip twice" is only safe if AI was
 * running to begin with; if it was not, the first flip switches wildlife *on*
 * for the duration. So: flip once, read where it landed, and only complete the
 * cycle when there was something to clear.
 *
 * Whether the reply names the state it *entered* or the one it *left* is not
 * settled — it cannot be told apart over RCON alone. The design is deliberately
 * safe either way: the flips always balance, so the server ends in the state it
 * started in, and the worst case is one brief cycle rather than a lasting
 * change.
 */
export declare function clearAI(ctx: Ctx, log: (m: string) => void): Promise<AIResult>;
/**
 * Ticks every 20 seconds. The warning and the sweep each fire once per cycle,
 * tracked against the slot's own timestamp so a bot restart mid-cycle cannot
 * replay either.
 */
export declare function startCleanupScheduler(ctx: Ctx, log: (m: string) => void): void;
