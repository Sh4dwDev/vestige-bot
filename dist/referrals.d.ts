import { EmbedBuilder, type Client, type GuildMember } from 'discord.js';
import type { Ctx } from './commands.js';
export declare const referralsEnabled: (ctx: Ctx) => boolean;
export declare const setReferralsEnabled: (ctx: Ctx, on: boolean) => void;
export declare const referralReward: (ctx: Ctx) => number;
export declare const referralWelcome: (ctx: Ctx) => number;
export declare const referralMinutes: (ctx: Ctx) => number;
export declare const referralWeeklyCap: (ctx: Ctx) => number;
export declare function setReferralAmounts(ctx: Ctx, values: {
    reward?: number;
    welcome?: number;
    minutes?: number;
    weekly?: number;
}): void;
export declare function cacheInvites(client: Client, log: (m: string) => void): Promise<void>;
/** Exposed for tests: which code went up between two readings. */
export declare function whichInviteGrew(before: Map<string, number>, after: Map<string, number>): string | null;
/**
 * Works out who invited a new member, and records it.
 *
 * Never throws into the join handler: failing to credit somebody is a missed
 * reward, while throwing here would break the join role as well.
 */
export declare function noteJoin(ctx: Ctx, member: GuildMember, log: (m: string) => void): Promise<void>;
export type LinkOutcome = 'attached' | 'already-referred' | 'not-referred' | 'self' | 'existing';
/**
 * Called when somebody links, to tie their Steam account to their referral.
 *
 * This is where an alt is caught. The account has to be new to the bot: a
 * Steam ID already seen in game, or already carrying playtime, belongs to
 * somebody who was here anyway and was not brought by the person claiming them.
 */
export declare function noteLink(ctx: Ctx, discordId: string, steamId: string): LinkOutcome;
export interface Payout {
    inviterDiscord: string;
    inviteeDiscord: string;
    reward: number;
    welcome: number;
    welcomeSteam: string;
}
/**
 * Pays every referral that has come good since the last check.
 *
 * Deliberately not called from the link handler: the requirement is playtime,
 * which only accrues later, so this runs on the same poll that awards it.
 */
export declare function collectPayouts(ctx: Ctx, now?: Date): Payout[];
/** Best effort: a closed DM must not stop the points being paid. */
export declare function tellInviter(client: Client, payout: Payout): Promise<void>;
export declare function buildReferralEmbed(ctx: Ctx, counts: {
    total: number;
    paid: number;
    pending: number;
}, top: Array<{
    inviterDiscord: string;
    count: number;
}>): EmbedBuilder;
