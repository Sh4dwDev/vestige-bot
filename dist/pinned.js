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
            // Self-heal: if the edit still left no attachment behind, the message is
            // unusable for a picture panel, so start a fresh one rather than editing
            // an empty frame forever.
            if (files.length > 0) {
                const after = await text.messages.fetch(existing.id).catch(() => null);
                if (after && after.attachments.size === 0) {
                    await existing.delete().catch(() => undefined);
                    const replacement = await text.send({ embeds, components, files });
                    db.setSetting(messageKey, replacement.id);
                }
            }
            return;
        }
    }
    const sent = await text.send({ embeds, components, files });
    db.setSetting(messageKey, sent.id);
}
//# sourceMappingURL=pinned.js.map