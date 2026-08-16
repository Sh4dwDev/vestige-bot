import { ChannelType } from 'discord.js';
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
export async function postOrEdit(db, client, channelId, messageKey, embeds) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error('That is not a text channel the bot can see.');
    }
    const text = channel;
    const existingId = db.getSetting(messageKey);
    if (existingId) {
        const existing = await text.messages.fetch(existingId).catch(() => null);
        if (existing) {
            await existing.edit({ embeds });
            return;
        }
    }
    const sent = await text.send({ embeds });
    db.setSetting(messageKey, sent.id);
}
//# sourceMappingURL=pinned.js.map