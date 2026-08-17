import { EmbedBuilder } from 'discord.js';
import { SIGNATURE } from './brand.js';
import { tally } from './population.js';
/**
 * Per-species population caps.
 *
 * **This announces, it does not enforce.** Nothing in Evrima lets a server
 * refuse a spawn from Lua — the documented hooks for it do not fire — so a
 * "locked" species is a rule players and staff act on, not a wall. Saying so
 * plainly beats implying an enforcement that is not there.
 *
 * State is stored rather than held in memory, so a bot restart does not
 * re-announce a lock that was already reported.
 */
const CHANNEL_KEY = 'species_channel';
export function setSpeciesChannel(ctx, channelId) {
    ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
}
export function speciesChannel(ctx) {
    return ctx.db.getSetting(CHANNEL_KEY) || null;
}
/**
 * Compares live counts against the caps and returns only what changed.
 *
 * Pure so the hysteresis is testable: a species sitting exactly on its cap must
 * not flap between locked and unlocked as one player logs in and out.
 */
export function lockChanges(caps, counts) {
    const changes = [];
    for (const entry of caps) {
        const count = counts.get(entry.species) ?? 0;
        const shouldLock = count >= entry.cap;
        if (shouldLock !== entry.locked) {
            changes.push({ species: entry.species, cap: entry.cap, count, locked: shouldLock });
        }
    }
    return changes;
}
export function buildLockEmbed(change) {
    return new EmbedBuilder()
        .setColor(change.locked ? 0xed4245 : 0x57f287)
        .setTitle(change.locked ? `🔒  ${change.species} is locked` : `🔓  ${change.species} is open`)
        .setDescription(change.locked
        ? `**${change.count}** playing, and the cap is **${change.cap}**.\n\n` +
            'Please pick something else until it opens up again.'
        : `Down to **${change.count}** of **${change.cap}**. You can play it again.`)
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
}
/**
 * Called from the population poll, which already has the player list — so this
 * costs no extra round trip.
 */
export async function checkSpeciesLocks(ctx, client, players, log) {
    const caps = ctx.db.speciesCaps();
    if (caps.length === 0)
        return;
    const counts = new Map();
    for (const row of tally(players))
        counts.set(row.species, row.online);
    const changes = lockChanges(caps, counts);
    if (changes.length === 0)
        return;
    const channelId = speciesChannel(ctx);
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    for (const change of changes) {
        ctx.db.setSpeciesLocked(change.species, change.locked);
        log(`species: ${change.species} ${change.locked ? 'locked' : 'unlocked'} ` +
            `(${change.count}/${change.cap})`);
        if (channel?.isTextBased() && 'send' in channel) {
            await channel.send({ embeds: [buildLockEmbed(change)] }).catch(() => undefined);
        }
        // In game as well: the people who need to know are the ones about to spawn
        // it, and they are not reading Discord at that moment.
        await ctx.rcon
            // Short: these draw over the game's own ANNOUNCEMENT label.
            .announce(change.locked
            ? `${change.species} LOCKED (${change.count}/${change.cap})`
            : `${change.species} open again`)
            .catch(() => undefined);
    }
}
//# sourceMappingURL=species.js.map