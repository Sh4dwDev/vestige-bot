import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { hud } from './contest.js';
/**
 * One player is the quarry. Kill them and the prize is yours; keep them alive
 * to the end and nobody gets anything.
 *
 * The whole event rests on the killfeed knowing **who** killed whom, which is
 * exactly what the damage hook records. A quarry who breaks off wounded and
 * bleeds out still pays whoever last hit them — that is how most fights here
 * actually end, and calling it a survival made the fight look like it never
 * happened. Drowning, starving and wildlife still leave nobody to pay, and
 * those are treated as the quarry surviving rather than quietly awarding it to
 * whoever was nearest: guessing a winner is worse than having none.
 *
 * Position is announced on a timer rather than continuously. A quarry whose
 * exact spot is always known cannot play, and one who is never located cannot
 * be found — a stale fix every few minutes is what makes it a hunt.
 */
const KEY = 'hunt_state';
/**
 * How close counts as close, in HUD units, nearest first.
 *
 * HUD units because that is what the position call already speaks: a hunter is
 * given `Lat -317, Long 120` and can read their own coordinates off the same
 * display, so a distance in the same scale is one they can act on.
 */
export const BANDS = [
    {
        within: 8,
        hunter: 'You are right on top of them.',
        target: 'They are right on top of you.',
    },
    {
        within: 20,
        hunter: 'You are close.',
        target: 'Somebody is close.',
    },
    {
        within: 45,
        hunter: 'You are getting warm.',
        target: 'Somebody is getting warm.',
    },
];
export function activeHunt(ctx) {
    const raw = ctx.db.getSetting(KEY);
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed.targetSteam === 'string' && typeof parsed.endsAt === 'number'
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export const saveHunt = (ctx, hunt) => ctx.db.setSetting(KEY, hunt ? JSON.stringify(hunt) : '');
/**
 * What the hunt should do next, given the clock and where everyone is.
 *
 * Pure. A kill is handled separately because it arrives as an event rather than
 * being visible in a snapshot of positions.
 */
export function huntStep(hunt, players, now) {
    if (now >= hunt.endsAt)
        return { kind: 'survived' };
    if (now - hunt.lastRevealAt < hunt.revealEveryMs)
        return { kind: 'waiting' };
    const target = players.find((p) => p.steam === hunt.targetSteam);
    // Offline or unlocatable: nothing to say, and saying nothing is better than
    // announcing a position from ten minutes ago as though it were current.
    if (!target || target.x === undefined || target.y === undefined) {
        return { kind: 'waiting' };
    }
    return { kind: 'reveal', x: target.x, y: target.y, species: target.species };
}
/** ASCII only: these go out over RCON, which drops anything else silently. */
export const huntAnnounce = (hunt) => `HUNT: ${hunt.targetName} is the target`
    + (hunt.targetSpecies ? ` (${hunt.targetSpecies})` : '')
    + `. Kill them for ${hunt.reward} points. `
    + `Their position is called out every ${Math.round(hunt.revealEveryMs / 60000)} minutes.`;
export const revealAnnounce = (hunt, x, y, species) => `HUNT: ${hunt.targetName} was last seen at Lat ${hud(y)}, Long ${hud(x)}`
    + (species ? ` playing ${species}.` : '.');
export const caughtAnnounce = (hunt, killer) => `HUNT: ${killer} killed ${hunt.targetName} and takes ${hunt.reward} points.`;
export const survivedAnnounce = (hunt) => `HUNT: ${hunt.targetName} survived. Nobody wins.`;
export function buildHuntEmbed(hunt, state, killer) {
    const colour = state === 'caught' ? 0x57f287 : state === 'survived' ? 0xed4245 : 0xfee75c;
    return new EmbedBuilder()
        .setColor(colour)
        .setTitle(state === 'running' ? `🎯  Hunt: ${hunt.targetName}` : `🎯  Hunt over`)
        .setDescription(state === 'caught'
        ? `**${killer}** killed **${hunt.targetName}**` +
            (hunt.targetSpecies ? ` *(${hunt.targetSpecies})*` : '') + ' and takes ' +
            `**${hunt.reward}** points` +
            (hunt.skin ? ` and the **${hunt.skin}** skin` : '') + '.'
        : state === 'survived'
            ? `**${hunt.targetName}** survived. Nobody wins.\n\n` +
                'It has to be a player kill — drowning, starving or wildlife ' +
                'leaves nobody to pay.'
            : `**${hunt.targetName}** is the target` +
                (hunt.targetSpecies ? `, playing **${hunt.targetSpecies}**` : '') +
                '.\n\n' +
                `🏆 **${hunt.reward}** points` +
                (hunt.skin ? ` and the **${hunt.skin}** skin` : '') +
                ' to whoever kills them.\n' +
                `📢 Their position is called out every ` +
                `**${Math.round(hunt.revealEveryMs / 60000)} minutes**.\n` +
                `⏳ Ends <t:${Math.floor(hunt.endsAt / 1000)}:R>.`)
        .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
        .setTimestamp();
}
/**
 * Who is close enough to be told so, and what they are told.
 *
 * Both sides get a notice. Telling only the hunters makes the quarry a sitting
 * target who never knows to run; telling only the quarry makes the hunters
 * wander. The pair of them is what turns a coordinate into a chase.
 *
 * Pure, and it only speaks on a change of band — including the change to "no
 * longer close", which is how somebody knows they have lost the trail.
 */
export function proximityStep(hunt, players) {
    const target = players.find((p) => p.steam === hunt.targetSteam);
    const bands = { ...(hunt.bands ?? {}) };
    const notices = [];
    if (!target || target.x === undefined || target.y === undefined) {
        // Unlocatable: nothing can be said about distance, and the bands are
        // cleared so coming back into view speaks again rather than staying silent.
        return { hunt: { ...hunt, bands: {} }, notices };
    }
    // The nearest hunter, so the quarry is warned once rather than once per
    // person chasing them.
    let closest = Number.POSITIVE_INFINITY;
    for (const player of players) {
        if (!player.steam || player.steam === hunt.targetSteam)
            continue;
        if (player.x === undefined || player.y === undefined)
            continue;
        const away = Math.hypot(player.x - target.x, player.y - target.y) / 1000;
        const band = BANDS.findIndex((b) => away <= b.within);
        const was = bands[player.steam] ?? -1;
        if (band >= 0 && away < closest)
            closest = away;
        if (band === was)
            continue;
        if (band < 0) {
            delete bands[player.steam];
            // Only worth saying to somebody who had been told they were close.
            if (was >= 0) {
                notices.push({ steam: player.steam, text: `HUNT: you have lost ${hunt.targetName}.` });
            }
            continue;
        }
        bands[player.steam] = band;
        // Only on the way in. Drifting from "close" back to "warm" already says
        // enough by not saying "right on top of them" any more.
        if (was < 0 || band < was) {
            notices.push({
                steam: player.steam,
                text: `HUNT: ${BANDS[band]?.hunter ?? ''} ${hunt.targetName} is `
                    + `about ${Math.round(away)} out.`,
            });
        }
    }
    const targetBand = BANDS.findIndex((b) => closest <= b.within);
    const targetWas = bands[hunt.targetSteam] ?? -1;
    if (targetBand !== targetWas) {
        if (targetBand < 0) {
            delete bands[hunt.targetSteam];
            if (targetWas >= 0) {
                notices.push({ steam: hunt.targetSteam, text: 'HUNT: you have lost them.' });
            }
        }
        else {
            bands[hunt.targetSteam] = targetBand;
            if (targetWas < 0 || targetBand < targetWas) {
                notices.push({
                    steam: hunt.targetSteam,
                    text: `HUNT: ${BANDS[targetBand]?.target ?? ''} Run.`,
                });
            }
        }
    }
    return { hunt: { ...hunt, bands }, notices };
}
const CHANNEL_KEY = 'hunt_channel';
export const huntChannel = (ctx) => ctx.db.getSetting(CHANNEL_KEY) || null;
export const setHuntChannel = (ctx, channelId) => ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
/**
 * Pays the killer and ends it.
 *
 * Called from the kill handler rather than the poll: a death is an event, and
 * looking for it in a snapshot of who is alive would miss anybody who died and
 * respawned between two readings.
 *
 * Returns the hunt that was ended, or null when this kill had nothing to do
 * with one.
 */
export function claimHunt(ctx, killerSteam, victimSteam) {
    const hunt = activeHunt(ctx);
    if (!hunt || victimSteam !== hunt.targetSteam)
        return null;
    // The quarry killing themselves, by slay or otherwise, is not a win for
    // anybody. Nor is it a survival — it just ends.
    if (!killerSteam || killerSteam === hunt.targetSteam) {
        saveHunt(ctx, null);
        return null;
    }
    ctx.db.addPoints(killerSteam, hunt.reward, 0);
    if (hunt.skin)
        ctx.db.grantSkin(killerSteam, hunt.skin, `Won the hunt for ${hunt.targetName}`);
    saveHunt(ctx, null);
    return hunt;
}
/**
 * Marks a reveal as done, so the timer advances even if announcing fails.
 *
 * The species is refreshed at the same time: it is only knowable while they are
 * locatable, and this is the one moment we know they were.
 */
export const markRevealed = (ctx, hunt, now, species) => saveHunt(ctx, {
    ...hunt,
    lastRevealAt: now,
    ...(species ? { targetSpecies: species } : {}),
});
//# sourceMappingURL=hunt.js.map