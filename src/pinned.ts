import {
  ChannelType,
  type ActionRowBuilder,
  type ButtonBuilder,
  type Client,
  type EmbedBuilder,
  type TextChannel,
} from 'discord.js';

import type { Database } from './db.js';

/**
 * A message the bot owns and keeps in a channel.
 *
 * The message id is remembered, so re-running the command that created it edits
 * what is already there instead of posting a second copy — otherwise a channel
 * meant to hold one reference embed slowly fills with stale duplicates.
 *
 * If the message is gone (deleted, or the channel changed) a fresh one is
 * posted and the new id recorded.
 */
export async function postOrEdit(
  db: Database,
  client: Client,
  channelId: string,
  messageKey: string,
  embeds: EmbedBuilder[],
  components: ActionRowBuilder<ButtonBuilder>[] = [],
): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error('That is not a text channel the bot can see.');
  }

  const text = channel as TextChannel;
  const existingId = db.getSetting(messageKey);

  if (existingId) {
    const existing = await text.messages.fetch(existingId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds, components });
      return;
    }
  }

  const sent = await text.send({ embeds, components });
  db.setSetting(messageKey, sent.id);
}
