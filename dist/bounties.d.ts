import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './population.js';
/** Points per claim before the tier multiplier. */
export declare const DEFAULT_BASE = 150;
export interface Bounty {
    species: string;
    /** Points per kill. */
    reward: number;
    /** How many payouts are left. */
    claims: number;
    /** How far over the cap it was when posted, which is why it exists. */
    over: number;
    postedAt: number;
}
export interface BountySettings {
    enabled: boolean;
    base: number;
}
export declare function bountySettings(ctx: Ctx): BountySettings;
export declare function setBountiesEnabled(ctx: Ctx, enabled: boolean): void;
export declare function setBountyBase(ctx: Ctx, points: number): void;
export declare function activeBounties(ctx: Ctx): Bounty[];
/**
 * What the island should have a bounty on, given the live counts.
 *
 * Pure so the balance is testable: the reward is deliberately a function of how
 * far over the cap a species is, so a badly overpopulated apex is worth going
 * out of your way for and a species one over its limit is not.
 */
export declare function bountiesFor(caps: Array<{
    species: string;
    cap: number;
}>, counts: Map<string, number>, base: number, tier: (species: string) => number, endangered?: Set<string>): Bounty[];
/**
 * Recomputes the board from live counts.
 *
 * Existing bounties keep their remaining claims: refreshing must not quietly
 * top somebody's pot back up while they are working through it.
 */
export declare function refreshBounties(ctx: Ctx, players: PlayerRow[]): {
    posted: Bounty[];
    ended: string[];
};
/**
 * Pays a bounty for a kill, if one is on that species.
 *
 * Returns what was paid so the caller can say so. Spending the last claim
 * closes the bounty, which is what stops a permanently over-cap species paying
 * out forever.
 */
export declare function claimBounty(ctx: Ctx, species: string): Bounty | null;
/** One line per bounty, for the population panel. */
export declare function bountyLines(bounties: Bounty[]): string;
export declare function buildBountyEmbed(bounty: Bounty): EmbedBuilder;
/** ASCII and a full sentence: this lands in chat as <RCON> and stays there. */
export declare function bountyAnnounce(bounty: Bounty): string;
export declare function bountyPaidAnnounce(species: string, reward: number, left: number): string;
/** Called from the population poll, which already has the counts. */
export declare function checkBounties(ctx: Ctx, client: Client, players: PlayerRow[], log: (m: string) => void): Promise<void>;
