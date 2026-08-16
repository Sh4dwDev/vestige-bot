import { EmbedBuilder } from 'discord.js';
import type { Ctx } from './commands.js';
export declare const DEFAULT_RATE_PER_HOUR = 60;
export declare function ratePerHour(ctx: Ctx): number;
export declare function setRatePerHour(ctx: Ctx, rate: number): void;
/**
 * How much to pay for a gap of `elapsedMs`, and how many minutes that counts
 * as. Pure, because the capping rule is the part worth testing.
 */
export declare function awardFor(elapsedMs: number, rate: number): {
    points: number;
    minutes: number;
};
/** Called from the minute poll, which already knows who is online. */
export declare function awardOnline(ctx: Ctx, steamIds: string[], elapsedMs: number): number;
/** Floored: showing 41.7 points invites arguments about rounding. */
export declare const display: (balance: number) => number;
export declare function buildBalanceEmbed(balance: number, minutes: number, rate: number): EmbedBuilder;
export declare function buildLeaderboardEmbed(rows: Array<{
    steamId: string;
    balance: number;
    minutes: number;
}>, nameFor: (steamId: string) => string): EmbedBuilder;
