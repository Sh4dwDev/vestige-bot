import { EmbedBuilder, type ChatInputCommandInteraction, type Client } from 'discord.js';

import { SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';

/**
 * A record of what staff did, in a channel.
 *
 * **What it can see:** every `/admin` and `/setup` command, with who ran it,
 * what they typed, and whether it worked. That is one chokepoint — every staff
 * action the bot offers passes through the same dispatcher — so nothing can be
 * added later and quietly escape the log.
 *
 * **What it cannot see:** actions taken with the game's own admin panel. Those
 * never reach the bot, and the only way to catch them would be hooking the
 * engine's admin path from Lua, which this project has twice taken the server
 * down attempting. The log says so on the panel rather than implying a
 * completeness it does not have.
 *
 * Failures are logged too, and refusals loudest of all: somebody without
 * permission trying `/admin give` is the single most interesting line this will
 * ever write.
 */

const CHANNEL_KEY = 'audit_channel';

const COLORS = { ok: 0x57f287, denied: 0xed4245, failed: 0xfee75c };

export const auditChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(CHANNEL_KEY) || null;

export const setAuditChannel = (ctx: Ctx, channelId: string | null): void =>
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');

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

/** Discord's own limit on an embed field. */
const MAX_FIELD = 1024;

/**
 * Flattens the options somebody actually typed.
 *
 * Values are included because "gave points" without the number is not an audit
 * trail. Attachments and long text are truncated rather than dropped, so a line
 * is never silently misleading about what was passed.
 */
export function describeOptions(i: ChatInputCommandInteraction): string {
  const parts: string[] = [];

  for (const option of i.options.data) {
    // Subcommands and groups arrive as options with children; those are already
    // reported separately, so only their children are worth flattening.
    const children = option.options ?? [];
    if (children.length > 0) {
      for (const child of children) {
        const nested = child.options ?? [];
        if (nested.length > 0) {
          for (const leaf of nested) parts.push(`${leaf.name}: ${String(leaf.value ?? '')}`);
        } else if (child.value !== undefined) {
          parts.push(`${child.name}: ${String(child.value)}`);
        }
      }
      continue;
    }
    if (option.value !== undefined) parts.push(`${option.name}: ${String(option.value)}`);
  }

  const joined = parts.join(' · ');
  return joined.length > MAX_FIELD ? `${joined.slice(0, MAX_FIELD - 1)}…` : joined;
}

export function buildAuditEmbed(entry: AuditEntry): EmbedBuilder {
  const path = [`/${entry.command}`, entry.group, entry.action]
    .filter((p) => p !== undefined && p !== '')
    .join(' ');

  const title = entry.outcome === 'denied'
    ? '⛔  Refused'
    : entry.outcome === 'failed'
      ? '⚠️  Failed'
      : '🛠️  Staff action';

  const embed = new EmbedBuilder()
    .setColor(COLORS[entry.outcome])
    .setTitle(title)
    .setDescription(`<@${entry.userId}> ran \`${path}\``)
    .setTimestamp();

  if (entry.options) {
    embed.addFields({ name: 'With', value: entry.options.slice(0, MAX_FIELD) });
  }
  if (entry.detail) {
    embed.addFields({ name: 'Detail', value: entry.detail.slice(0, MAX_FIELD) });
  }

  // The Discord ID as well as the mention: a mention stops resolving once
  // somebody leaves the server, and an audit trail that forgets who did
  // something is not one.
  embed.setFooter({ text: `${entry.userId} · ${SIGNATURE}` });

  return embed;
}

/**
 * Writes one line to the audit channel.
 *
 * Never throws and never awaits anything the caller depends on: a staff action
 * must not fail because the log channel was deleted.
 */
export async function writeAudit(
  ctx: Ctx,
  client: Client,
  entry: AuditEntry,
): Promise<void> {
  const channelId = auditChannel(ctx);
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return;

    await channel.send({
      embeds: [buildAuditEmbed(entry)],
      // The actor is mentioned in the text; pinging them for their own action
      // would make the channel unusable for anybody who works in it.
      allowedMentions: { parse: [] },
    });
  } catch {
    // A missing channel, lost permissions, or a rate limit. None of them are
    // worth surfacing to the person who just ran a command.
  }
}
