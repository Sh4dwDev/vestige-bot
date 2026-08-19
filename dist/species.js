import { EmbedBuilder } from 'discord.js';
import { SIGNATURE } from './brand.js';
import { speciesList } from './catalog.js';
import { describeError } from './commands.js';
import { enforcementEnabled, syncPlayables } from './enforce.js';
import { tally } from './population.js';
/**
 * Per-species population caps.
 *
 * Announcing is the half that always works. Actually *blocking* the spawn is
 * opt-in and lives in [enforce.ts](./enforce.ts) — it removes the species from
 * the spawn menu over RCON, and disables itself if the server does not take the
 * write. With enforcement off, a locked species is a rule players and staff act
 * on rather than a wall.
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
export function buildLockEmbed(change, enforced = false) {
    return new EmbedBuilder()
        .setColor(change.locked ? 0xed4245 : 0x57f287)
        .setTitle(change.locked ? `🔒  ${change.species} is locked` : `🔓  ${change.species} is open`)
        .setDescription(change.locked
        ? `**${change.count}** playing, and the cap is **${change.cap}**.\n\n` +
            (enforced
                ? 'It has been taken out of the spawn menu, and comes back the ' +
                    'moment someone stops playing it.'
                : 'Please pick something else until it opens up again.')
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
    // Write the new state before announcing it, so the menu and the notice agree.
    for (const change of changes)
        ctx.db.setSpeciesLocked(change.species, change.locked);
    let enforced = false;
    if (enforcementEnabled(ctx)) {
        try {
            enforced = (await syncPlayables(ctx, await speciesList(ctx), log)).verified;
        }
        catch (err) {
            log(`species: could not update the spawn menu: ${describeError(err)}`);
        }
    }
    const channelId = speciesChannel(ctx);
    const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
    for (const change of changes) {
        log(`species: ${change.species} ${change.locked ? 'locked' : 'unlocked'} ` +
            `(${change.count}/${change.cap})`);
        if (channel?.isTextBased() && 'send' in channel) {
            await channel.send({ embeds: [buildLockEmbed(change, enforced)] }).catch(() => undefined);
        }
        // In game as well: the people who need to know are the ones about to spawn
        // it, and they are not reading Discord at that moment.
        //
        // These land in chat as <RCON>, where they persist and wrap, so they say
        // what happened and why rather than being clipped to a code. A line reading
        // "Rex LOCKED (5/5)" makes people ask what it means; this does not.
        await ctx.rcon
            .announce(change.locked
            ? `${change.species} has been locked (population limit reached: ` +
                `${change.count}/${change.cap}). Please pick another species for now.`
            : `${change.species} has been unlocked (population below limit).`)
            .catch(() => undefined);
    }
}
//# sourceMappingURL=species.js.map