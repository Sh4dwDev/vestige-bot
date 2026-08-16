import { EmbedBuilder, type Client } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import { postOrEdit } from './pinned.js';
import { nextRestart, restartSettings } from './restarts.js';

/**
 * The at-a-glance server panel: up or down, how full, when it restarts next.
 *
 * Driven by the once-a-minute poll that already exists, so it costs no extra
 * RCON traffic. Like the population panel it always renders — an embed that
 * disappears when the server goes down is exactly when people most want to look
 * at it.
 */

const CHANNEL_KEY = 'status_channel';
const MESSAGE_KEY = 'status_message';

export function setStatusChannel(ctx: Ctx, channelId: string | null): void {
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
  // The stored message belongs to the old channel.
  ctx.db.setSetting(MESSAGE_KEY, '');
}

export function statusChannel(ctx: Ctx): string | null {
  return ctx.db.getSetting(CHANNEL_KEY) || null;
}

/**
 * Anyone at all gets one segment. A server with a player on it showing a
 * completely empty bar reads as broken, and at 1/100 honest rounding does
 * exactly that.
 */
function bar(online: number, max: number): string {
  const width = 10;
  if (max <= 0) return '';
  const exact = (online / max) * width;
  const filled = Math.min(width, online > 0 ? Math.max(1, Math.round(exact)) : 0);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export interface StatusView {
  /** null when the server did not answer. */
  online: number | null;
  max: number | null;
}

export function buildStatusEmbed(view: StatusView, restart: Date | null): EmbedBuilder {
  // The embed's own timestamp already shows freshness under the footer, so an
  // "updated N seconds ago" line was saying the same thing twice.
  const embed = new EmbedBuilder()
    .setTitle(`🌐  ${SERVER}`)
    .setFooter({ text: `Refreshes every minute · ${SIGNATURE}` })
    .setTimestamp();

  if (view.online === null) {
    return embed
      .setColor(0xed4245)
      .setDescription(
        '## 🔴  Offline\n' +
        `${SERVER} is not responding. It is most likely restarting — this ` +
        'usually sorts itself out within a few minutes.',
      );
  }

  const { online, max } = view;

  // An empty bar next to "0% full" is two ways of saying nothing is happening.
  // When nobody is on, say that in words and drop the meter entirely.
  const body = online === 0
    ? '## 🟢  Online\nNobody is playing right now — the island is wide open.'
    : '## 🟢  Online\n' +
      (max === null ? '' : `\`${bar(online, max)}\`  ${Math.round((online / max) * 100)}% full`);

  embed
    // Grey rather than green when empty: technically online, but "join, it is
    // busy" is the wrong impression to give.
    .setColor(online > 0 ? 0x57f287 : 0x4f545c)
    .setDescription(body)
    .addFields({
      name: '👥  Players',
      value: max === null ? `**${online}**` : `**${online}** / ${max}`,
      inline: true,
    });

  if (restart) {
    embed.addFields({
      name: '🔄  Next restart',
      value:
        `<t:${Math.floor(restart.getTime() / 1000)}:R>\n` +
        `<t:${Math.floor(restart.getTime() / 1000)}:t>`,
      inline: true,
    });
  }

  return embed;
}

/** Called from the minute poll, which already knows these numbers. */
export async function refreshStatusPanel(
  ctx: Ctx,
  client: Client,
  online: number | null,
): Promise<void> {
  const channelId = statusChannel(ctx);
  if (!channelId) return;

  const settings = restartSettings(ctx);
  const restart = settings.enabled ? nextRestart(new Date(), settings.intervalHours) : null;

  const embed = buildStatusEmbed({ online, max: ctx.admins.maxPlayers }, restart);
  await postOrEdit(ctx.db, client, channelId, MESSAGE_KEY, [embed]);
}
