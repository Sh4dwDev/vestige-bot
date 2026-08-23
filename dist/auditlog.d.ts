import { EmbedBuilder, type ChatInputCommandInteraction, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
export declare const auditChannel: (ctx: Ctx) => string | null;
export declare const setAuditChannel: (ctx: Ctx, channelId: string | null) => void;
export type AuditOutcome = 'ok' | 'denied' | 'failed';
export interface AuditEntry {
    /** Who ran it. */
    userId: string;
    /** `admin` or `setup`. */
    command: string;
    /** The subcommand group, where there was one. */
    group?: string;
    /** The subcommand. */
    action?: string;
    /** What they typed, already flattened for display. */
    options: string;
    outcome: AuditOutcome;
    /** Why it failed, for the outcomes that have a reason. */
    detail?: string;
}
/**
 * Flattens the options somebody actually typed.
 *
 * Values are included because "gave points" without the number is not an audit
 * trail. Attachments and long text are truncated rather than dropped, so a line
 * is never silently misleading about what was passed.
 */
export declare function describeOptions(i: ChatInputCommandInteraction): string;
export declare function buildAuditEmbed(entry: AuditEntry): EmbedBuilder;
/**
 * Writes one line to the audit channel.
 *
 * Never throws and never awaits anything the caller depends on: a staff action
 * must not fail because the log channel was deleted.
 */
export declare function writeAudit(ctx: Ctx, client: Client, entry: AuditEntry): Promise<void>;
