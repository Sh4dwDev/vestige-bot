import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
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
export function setStatusChannel(ctx, channelId) {
    ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
    // The stored message belongs to the old channel.
    ctx.db.setSetting(MESSAGE_KEY, '');
}
export function statusChannel(ctx) {
    return ctx.db.getSetting(CHANNEL_KEY) || null;
}
/** Full bar at capacity, empty when nobody is on. */
function bar(online, max) {
    const width = 12;
    const filled = max <= 0 ? 0 : Math.min(width, Math.round((online / max) * width));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}
export function buildStatusEmbed(view, restart) {
    const embed = new EmbedBuilder()
        .setTitle(`🌐  ${SERVER}`)
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
    const updated = `\n\nUpdated <t:${Math.floor(Date.now() / 1000)}:R> · refreshes every minute`;
    const restartLine = restart
        ? `\n\n**Next restart** <t:${Math.floor(restart.getTime() / 1000)}:R>, ` +
            `at <t:${Math.floor(restart.getTime() / 1000)}:t>`
        : '';
    if (view.online === null) {
        return embed
            .setColor(0xed4245)
            .setDescription(`### 🔴  Offline\n${SERVER} is not responding. It may be restarting — ` +
            `this usually sorts itself out within a few minutes.${restartLine}${updated}`);
    }
    const max = view.max;
    const capacity = max === null
        ? `**${view.online}** playing`
        : `**${view.online} / ${max}** playing\n\`${bar(view.online, max)}\``;
    return embed
        .setColor(0x57f287)
        .setDescription(`### 🟢  Online\n${capacity}${restartLine}${updated}`);
}
/** Called from the minute poll, which already knows these numbers. */
export async function refreshStatusPanel(ctx, client, online) {
    const channelId = statusChannel(ctx);
    if (!channelId)
        return;
    const settings = restartSettings(ctx);
    const restart = settings.enabled ? nextRestart(new Date(), settings.intervalHours) : null;
    const embed = buildStatusEmbed({ online, max: ctx.admins.maxPlayers }, restart);
    await postOrEdit(ctx.db, client, channelId, MESSAGE_KEY, [embed]);
}
//# sourceMappingURL=status.js.map