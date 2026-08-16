import type { GuildMember } from 'discord.js';
import type { Ctx } from './commands.js';
export declare function joinRole(ctx: Ctx): string | null;
export declare function setJoinRole(ctx: Ctx, roleId: string | null): void;
export declare function giveJoinRole(ctx: Ctx, member: GuildMember, log: (m: string) => void): Promise<void>;
