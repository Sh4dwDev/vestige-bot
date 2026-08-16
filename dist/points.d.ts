import { EmbedBuilder } from 'discord.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './population.js';
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
/**
 * Pays everyone currently playing, scaled by the tier of what they are on.
 *
 * Takes the mod's player rows rather than a list of Steam IDs, because the tier
 * depends on the species — which means someone sitting on the spawn screen
 * earns nothing. That is the intended reading of "earned by playing".
 */
export declare function awardOnline(ctx: Ctx, players: PlayerRow[], elapsedMs: number): number;
/** Floored: showing 41.7 points invites arguments about rounding. */
export declare const display: (balance: number) => number;
export declare function buildBalanceEmbed(balance: number, minutes: number, rate: number): EmbedBuilder;
export declare function buildLeaderboardEmbed(rows: Array<{
    steamId: string;
    balance: number;
    minutes: number;
}>, nameFor: (steamId: string) => string): EmbedBuilder;
