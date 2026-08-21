import { ChannelType, } from 'discord.js';
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
export async function postOrEdit(db, client, channelId, messageKey, embeds, components = [], files = []) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        throw new Error('That is not a text channel the bot can see.');
    }
    const text = channel;
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
            await existing.edit(files.length > 0 ? { embeds, components, files } : { embeds, components });
            // Self-heal, once and only once per message.
            //
            // If an edit leaves no attachment the panel is an empty frame forever, so
            // it is worth starting a fresh one. But a repost on every refresh is
            // exactly the duplicate-spam this whole function exists to prevent, so a
            // message that has already been replaced is never replaced again — and
            // the check reads the message from the API rather than the cache, because
            // a stale cached copy would make a healthy panel look broken.
            if (files.length > 0 && db.getSetting(`${messageKey}_healed`) !== existing.id) {
                const after = await text.messages.fetch({ message: existing.id, force: true })
                    .catch(() => null);
                if (after && after.attachments.size === 0) {
                    await existing.delete().catch(() => undefined);
                    const replacement = await text.send({ embeds, components, files });
                    db.setSetting(messageKey, replacement.id);
                    db.setSetting(`${messageKey}_healed`, replacement.id);
                }
            }
            return;
        }
    }
    const sent = await text.send({ embeds, components, files });
    db.setSetting(messageKey, sent.id);
}
//# sourceMappingURL=pinned.js.map