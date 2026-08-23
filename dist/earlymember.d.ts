import type { Guild, GuildMember } from 'discord.js';
import type { Ctx } from './commands.js';
/** An hour, in minutes. Long enough to mean something, short enough to reach. */
export declare const DEFAULT_MINUTES = 60;
export declare function earlyMinutes(ctx: Ctx): number;
export declare const setEarlyMinutes: (ctx: Ctx, minutes: number) => void;
/**
 * How long this Discord member has played, or null when nobody knows.
 *
 * Null and zero are different answers: an unlinked member has no Steam account
 * to look up, which is not the same as one who has linked and played nothing.
 */
export declare function minutesPlayed(ctx: Ctx, discordId: string): number | null;
/** Whether they have put in the time. Pure enough to test without Discord. */
export declare const hasPlayedEnough: (minutes: number | null, required: number) => boolean;
export declare function earlyRole(ctx: Ctx): string | null;
export declare function setEarlyRole(ctx: Ctx, roleId: string | null): void;
export declare const holders: (guild: Guild, roleId: string) => number;
export declare const hasEarlyRole: (member: GuildMember, roleId: string) => boolean;
export type GrantResult = 'given' | 'already' | 'full' | 'no-role' | 'failed'
/** Linked or not, they have not played the required time yet. */
 | 'unqualified';
/**
 * Gives the role if there is room.
 *
 * The cap is checked against Discord's own membership immediately before the
 * add. Two people joining at the same instant can still both pass it — Discord
 * offers no atomic way to do this — so the cap is a limit rather than a
 * guarantee, and being one over is a far smaller problem than refusing somebody
 * who was inside it.
 *
 * Playtime is checked **before** the cap, so somebody who has not earned it yet
 * is never the reason a seat is reported as gone.
 */
export declare function grantEarlyRole(ctx: Ctx, member: GuildMember, limit: number, log: (m: string) => void): Promise<GrantResult>;
export interface Backfill {
    given: number;
    already: number;
    skipped: number;
    full: boolean;
    /** Members who have not played the hour yet, so nobody thinks they were lost. */
    unqualified: number;
}
/**
 * Hands the role to everyone who has already earned it, most played first.
 *
 * Ordering changed with the rule. Discord join date was right when the role was
 * given at the door; now that it is earned in game, the person who has played
 * most is the one who reached the hour first, and the bot does not record the
 * moment anybody crossed it. Going forward the online poll grants in real time,
 * which is genuinely first-come-first-served — this ordering only decides who
 * gets the seats among people who already qualified before the rule existed.
 */
export declare function backfillEarlyRole(ctx: Ctx, guild: Guild, limit: number, log: (m: string) => void): Promise<Backfill>;
