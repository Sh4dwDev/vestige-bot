import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { MAX_SLOTS } from './bridge.js';
import { display } from './points.js';
/** 5312 becomes "88h". Under an hour stays in minutes, so a new player sees movement. */
export function playtime(minutes) {
    const whole = Math.floor(minutes);
    if (whole < 60)
        return `${whole}m`;
    return `${Math.floor(whole / 60)}h`;
}
/**
 * Kills per death, to one decimal.
 *
 * Deaths of zero is not an error and not infinity: somebody who has killed
 * three things and died to none has a ratio of 3, which is what they would say
 * themselves.
 */
export function ratio(kills, deaths) {
    if (deaths === 0)
        return kills === 0 ? '0.0' : kills.toFixed(1);
    return (kills / deaths).toFixed(1);
}
/**
 * Reads everything for one player.
 *
 * The database parts are immediate. The slot count is the only thing that needs
 * the game server, and it is allowed to fail: a profile that refuses to load
 * because the server is restarting is worse than one that admits it does not
 * know how many slots are in use.
 */
export async function gatherProfile(ctx, discordId, steamId) {
    const { balance, minutes } = ctx.db.pointsFor(steamId);
    const { rank, of } = ctx.db.pointsRank(steamId);
    const { kills, deaths } = ctx.db.killStats(steamId);
    const slots = await ctx.mod
        .run('list', steamId, {}, { quiet: true })
        .then((r) => (r.ok && Array.isArray(r.data) ? r.data.length : null))
        .catch(() => null);
    return {
        name: ctx.db.gameName(steamId),
        steamId,
        points: display(balance),
        rank,
        players: of,
        minutes,
        kills,
        deaths,
        skins: ctx.db.ownedSkins(steamId).map((s) => s.preset),
        slots,
        maxSlots: MAX_SLOTS,
        firstSeen: ctx.db.firstSeen(steamId),
        // Since the beginning: a profile is a lifetime record, not a season one.
        referrals: ctx.db.paidReferralsSince(discordId, new Date(0)),
    };
}
/** Pure, so the wording and the awkward cases can be tested without a server. */
export function buildProfileEmbed(data) {
    const embed = new EmbedBuilder()
        .setColor(0xd6a03a)
        .setTitle(`📇  ${data.name ?? 'Your profile'}`)
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
    embed.addFields({
        name: '🪙  Points',
        value: `**${data.points.toLocaleString('en-GB')}**\n`
            + `-# ${data.rank} of ${data.players}`,
        inline: true,
    }, {
        name: '⏱️  Played',
        value: `**${playtime(data.minutes)}**`,
        inline: true,
    }, {
        name: '⚔️  Kills',
        value: `**${data.kills}** / ${data.deaths} died\n-# ${ratio(data.kills, data.deaths)} per death`,
        inline: true,
    });
    embed.addFields({
        name: '📦  Storage',
        value: data.slots === null
            // Said plainly. An empty vault and an unreachable server look identical
            // otherwise, and one of those reads as "my dinosaurs are gone".
            ? 'The game server did not answer, so this could not be read. Nothing is lost.'
            : `**${data.slots}** of ${data.maxSlots} slot${data.maxSlots === 1 ? '' : 's'} used`,
        inline: false,
    });
    if (data.skins.length > 0) {
        // Capped: somebody with thirty skins would push everything else off screen.
        const shown = data.skins.slice(0, 8);
        embed.addFields({
            name: `🎨  Skins owned (${data.skins.length})`,
            value: shown.map((s) => `\`${s}\``).join(' ')
                + (data.skins.length > shown.length ? ` and ${data.skins.length - shown.length} more` : ''),
            inline: false,
        });
    }
    const footnotes = [];
    if (data.firstSeen) {
        const seen = Date.parse(data.firstSeen);
        if (Number.isFinite(seen)) {
            footnotes.push(`First seen <t:${Math.floor(seen / 1000)}:D>`);
        }
    }
    if (data.referrals > 0) {
        footnotes.push(`Brought **${data.referrals}** player${data.referrals === 1 ? '' : 's'} here`);
    }
    embed.setDescription(footnotes.length > 0
        ? footnotes.join(' · ')
        : `Your record on ${SERVER}. Only you can see this.`);
    return embed;
}
//# sourceMappingURL=profile.js.map