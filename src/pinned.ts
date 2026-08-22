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
  files: Array<{ attachment: Buffer; name: string }> = [],
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
      // No `attachments` key when sending files.
      //
      // On edit that field is the AUTHORITATIVE final list, so passing `[]`
      // does not mean "drop the old ones" - it means "end up with none", and
      // it threw away the picture uploaded in the same call. The panel showed
      // an embed pointing at an attachment that was no longer there. Leaving
      // the key out lets discord.js describe the upload itself.
      await existing.edit(
        files.length > 0 ? { embeds, components, files } : { embeds, components },
      );

      // There was a self-heal here that deleted and reposted the message when
      // an edit left it with no attachments. It was wrong.
      //
      // An edited message legitimately reports `attachments: []` while its
      // embed points at a CDN upload made in that same edit — confirmed by
      // reading a live panel back from the API. So the trigger was true every
      // time, and every picture panel got one spurious delete-and-repost, which
      // is precisely the duplicate this function exists to prevent.
      //
      // Nothing replaces it. A panel that occasionally loses its picture is a
      // visible, reportable problem; a panel that reposts itself is noise in
      // somebody's channel forever.
      return;
    }
  }

  const sent = await text.send({ embeds, components, files });
  db.setSetting(messageKey, sent.id);
}
