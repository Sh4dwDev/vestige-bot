import type { Guild, GuildMember } from 'discord.js';
import type { Ctx } from './commands.js';
export declare function earlyRole(ctx: Ctx): string | null;
export declare function setEarlyRole(ctx: Ctx, roleId: string | null): void;
export declare const holders: (guild: Guild, roleId: string) => number;
export declare const hasEarlyRole: (member: GuildMember, roleId: string) => boolean;
export type GrantResult = 'given' | 'already' | 'full' | 'no-role' | 'failed';
/**
 * Gives the role if there is room.
 *
 * The cap is checked against Discord's own membership immediately before the
 * add. Two people joining at the same instant can still both pass it — Discord
 * offers no atomic way to do this — so the cap is a limit rather than a
 * guarantee, and being one over is a far smaller problem than refusing somebody
 * who was inside it.
 */
export declare function grantEarlyRole(ctx: Ctx, member: GuildMember, limit: number, log: (m: string) => void): Promise<GrantResult>;
export interface Backfill {
    given: number;
    already: number;
    skipped: number;
    full: boolean;
}
/**
 * Hands the role to people who were already here, oldest first.
 *
 * Oldest first is the only ordering that matches what the role claims to mean.
 * Doing it by whoever happens to be cached, or alphabetically, would hand
 * "early member" to whoever joined last week.
 */
export declare function backfillEarlyRole(ctx: Ctx, guild: Guild, limit: number, log: (m: string) => void): Promise<Backfill>;
