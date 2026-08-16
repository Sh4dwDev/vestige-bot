import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
/**
 * The kill feed and leaderboard.
 *
 * Attribution is partial and always will be in Lua: `ApplyDamage` only fires on
 * a direct player attack, so bleed, starvation, drowning, falls and AI produce
 * a real death with no killer. Rather than hide those, the feed shows them as
 * deaths and the leaderboard footer says how many are unattributed — otherwise
 * the numbers look broken to anyone who counts.
 */
const CHANNEL_KEY = 'killfeed_channel';
export function setKillfeedChannel(ctx, channelId) {
    ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
}
export function killfeedChannel(ctx) {
    return ctx.db.getSetting(CHANNEL_KEY) || null;
}
/** How a death with no attacker is described, by what the mod could tell. */
const CAUSE_TEXT = {
    health: 'died',
    vanished: 'died',
};
export function buildKillEmbed(event, nameFor) {
    const victim = `${nameFor(event.victim)}${event.species ? ` *(${event.species})*` : ''}`;
    if (event.killer) {
        return new EmbedBuilder()
            .setColor(0xed4245)
            .setDescription(`⚔️  ${nameFor(event.killer)} killed ${victim}`)
            .setTimestamp();
    }
    return new EmbedBuilder()
        .setColor(0x4f545c)
        .setDescription(`💀  ${victim} ${CAUSE_TEXT[event.cause] ?? 'died'}`)
        .setTimestamp();
}
export function buildKillsEmbed(rows, totals, nameFor) {
    const embed = new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle(`⚔️  Deadliest on ${SERVER}`)
        .setTimestamp();
    if (rows.length === 0) {
        return embed
            .setDescription('No kills recorded yet.')
            .setFooter({ text: SIGNATURE });
    }
    const medal = ['🥇', '🥈', '🥉'];
    embed.setDescription(rows
        .map((row, n) => `${medal[n] ?? `\`${String(n + 1).padStart(2)}\``} **${row.kills}** · ${nameFor(row.steamId)}`)
        .join('\n'));
    // Stated plainly, because someone will add the columns up and find a gap.
    const unattributed = totals.total - totals.attributed;
    embed.setFooter({
        text: `${totals.attributed} of ${totals.total} deaths had an attacker · ` +
            `${unattributed} were bleed, starvation, AI or falls\n${SIGNATURE}`,
    });
    return embed;
}
//# sourceMappingURL=kills.js.map