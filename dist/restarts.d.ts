import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
export declare const DEFAULT_INTERVAL_HOURS = 6;
/** Minutes before a restart at which players are told, in game. */
export declare const WARNINGS: readonly [60, 30, 15, 5, 1];
/**
 * The next restart at or after `now`, aligned to midnight UTC.
 *
 * Exported and pure because every subtle bug in a scheduler is an off-by-one at
 * a boundary — exactly on the hour, or across midnight.
 */
export declare function nextRestart(now: Date, intervalHours: number): Date;
/** Whole minutes until the restart, rounded up so "1 minute" never reads as 0. */
export declare function minutesUntil(now: Date, restart: Date): number;
/** How often both schedulers wake up. */
export declare const TICK_MS = 20000;
/**
 * Whether a scheduled slot should fire on this tick.
 *
 * The subtle part, and a bug that sat here unnoticed: `nextRestart` returns the
 * next slot **strictly after** `now`, so waiting for "minutes <= 0" waits
 * forever — the moment the clock reaches the slot, the answer jumps a whole
 * interval ahead. Firing needs a window instead, one tick wide plus a little
 * slack for a late timer.
 *
 * A slot missed entirely — the bot was down across it — is not fired late. A
 * surprise restart on startup is worse than a skipped one.
 */
export declare function isDue(now: Date, slot: Date): boolean;
export interface RestartSettings {
    enabled: boolean;
    intervalHours: number;
    channelId: string | null;
    roleId: string | null;
}
export declare function restartSettings(ctx: Ctx): RestartSettings;
export declare function setRestartsEnabled(ctx: Ctx, enabled: boolean): void;
export declare function setRestartInterval(ctx: Ctx, hours: number): void;
export declare function setRestartAnnounce(ctx: Ctx, channelId: string, roleId: string | null): void;
export declare function buildRestartEmbed(minutes: number, restart: Date): EmbedBuilder;
/**
 * Warns, saves, and asks the panel to restart.
 *
 * Ticks every 20 seconds. Each warning fires once per cycle, tracked against
 * the restart's own timestamp so a bot restart mid-cycle cannot replay warnings
 * that already went out.
 */
export declare function startRestartScheduler(ctx: Ctx, client: Client, log: (m: string) => void): void;
/**
 * Restart on demand, with a short countdown.
 *
 * This is the documented fix for stuck AI, wedged herds and similar: upstream
 * is explicit that clearing AI from Lua crashes the server, and that a restart
 * is the only supported cleanup. So the tool for "something is broken, fix it
 * now" is this, not a destroy path.
 */
export declare function restartNow(ctx: Ctx, minutes: number, log: (m: string) => void): Promise<string>;
