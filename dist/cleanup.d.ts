import type { Ctx } from './commands.js';
export declare const DEFAULT_HOURS = 3;
export interface CleanupSettings {
    enabled: boolean;
    hours: number;
}
export declare function cleanupSettings(ctx: Ctx): CleanupSettings;
export declare function setCleanupEnabled(ctx: Ctx, enabled: boolean): void;
export declare function setCleanupHours(ctx: Ctx, hours: number): void;
/** Shares the restart scheduler's clock alignment, so times are predictable. */
export declare function nextCleanup(now: Date, hours: number): Date;
export declare function wipeNow(ctx: Ctx, log: (m: string) => void): Promise<boolean>;
/**
 * Ticks every 20 seconds. The warning and the wipe each fire once per cycle,
 * tracked against the slot's own timestamp so a bot restart mid-cycle cannot
 * replay either.
 */
export declare function startCleanupScheduler(ctx: Ctx, log: (m: string) => void): void;
