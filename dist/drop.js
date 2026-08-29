import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { distance, hud } from './contest.js';
/**
 * The Drop: something died out there, and the first one to reach it takes it.
 *
 * Built for a server with a handful of people on it. Every other event here
 * needs a crowd to be worth running — a contest with six players means five
 * wasted evenings, and an endangered bonus needs a population to be scarce
 * within. **A race needs two people to be a race**, and the winner is whoever
 * turns up first, so nobody who logs in has wasted the trip.
 *
 * The hook is the hints. The location is never announced outright: it starts as
 * a quarter of the island and narrows every couple of minutes until somebody
 * finds it. That turns "go to these coordinates" into a search that people
 * talk to each other during, which is the actual point of running an event on a
 * quiet night.
 *
 * Nothing here spawns anything in the world. The drop is a point on the map the
 * bot remembers, which means it cannot fail the way spawning an actor can, and
 * the two crashes on 2026-08-23 are a good enough reason to keep it that way.
 */
const KEY = 'drop_state';
const CHANNEL_KEY = 'drop_channel';
/**
 * How precise each hint is, in HUD units.
 *
 * The first is deliberately useless on its own: a 200 unit square is a quarter
 * of the island, and the point of it is to get people moving in roughly the
 * right direction while they still have to search. The last one is tight
 * enough that anybody standing in it can find the drop by looking around.
 */
export const HINT_PRECISION = [200, 100, 50, 25];
/** Gap between hints. Long enough to travel, short enough to keep interest. */
export const HINT_EVERY_MS = 150_000;
export const activeDrop = (ctx) => {
    const raw = ctx.db.getSetting(KEY);
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
};
export const saveDrop = (ctx, drop) => ctx.db.setSetting(KEY, drop ? JSON.stringify(drop) : '');
export const dropChannel = (ctx) => ctx.db.getSetting(CHANNEL_KEY) || null;
export const setDropChannel = (ctx, channelId) => ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
/**
 * Where the drop lands.
 *
 * Between two players who are actually online, rather than anywhere on the map.
 * A random point risks the sea, a cliff, or the far corner nobody plays in, and
 * an event whose prize cannot be reached is worse than no event. Halfway
 * between two living dinosaurs is terrain somebody just walked across.
 *
 * With one player online it is offset from them instead, far enough to be a
 * journey and near enough to be their half of the island.
 *
 * Pure, given the random source, so the awkward cases can be tested.
 */
export function placeDrop(players, random = Math.random) {
    const located = players.filter((p) => p.x !== undefined && p.y !== undefined);
    if (located.length === 0)
        return null;
    const first = located[Math.floor(random() * located.length)];
    if (!first)
        return null;
    if (located.length === 1) {
        // A lap of a few hundred metres in a random direction.
        const angle = random() * Math.PI * 2;
        const away = 250_000 + (random() * 250_000);
        return { x: first.x + (Math.cos(angle) * away), y: first.y + (Math.sin(angle) * away) };
    }
    const others = located.filter((p) => p !== first);
    const second = others[Math.floor(random() * others.length)] ?? first;
    // Not exactly the midpoint: two people who can see each other would otherwise
    // both be standing on it already.
    const jitter = () => (random() - 0.5) * 120_000;
    return {
        x: ((first.x + second.x) / 2) + jitter(),
        y: ((first.y + second.y) / 2) + jitter(),
    };
}
/** Rounds a coordinate to a precision, so a hint names an area and not a spot. */
export const blur = (value, precision) => Math.round(hud(value) / precision) * precision;
/**
 * A hint, written as the area it is in.
 *
 * The number is the middle of a square this wide, which is stated outright.
 * Leaving people to work out how much slack a rounded coordinate carries is how
 * a search turns into an argument.
 */
export function hintText(drop, index) {
    const precision = HINT_PRECISION[Math.min(index, HINT_PRECISION.length - 1)]
        ?? HINT_PRECISION[HINT_PRECISION.length - 1];
    return `Somewhere within ${precision} of Lat ${blur(drop.y, precision)}, `
        + `Long ${blur(drop.x, precision)}`;
}
/**
 * One pass: has anybody reached it, is a hint due, is it over.
 *
 * Pure. The caller saves and announces, which keeps the rules testable without
 * a game server or a Discord client.
 */
export function dropStep(drop, players, now) {
    // Finding it beats the clock: somebody standing on the drop as the timer
    // runs out has found it, and telling them otherwise would be indefensible.
    for (const player of players) {
        if (!player.steam || player.x === undefined || player.y === undefined)
            continue;
        if (distance(player.x, player.y, drop.x, drop.y) <= drop.radius) {
            return { kind: 'found', steam: player.steam, drop };
        }
    }
    if (now >= drop.endsAt)
        return { kind: 'expired', drop };
    const due = drop.lastHintAt + HINT_EVERY_MS;
    if (now >= due && drop.hintsGiven < HINT_PRECISION.length) {
        const next = { ...drop, hintsGiven: drop.hintsGiven + 1, lastHintAt: now };
        return { kind: 'hint', drop: next, text: hintText(next, next.hintsGiven - 1) };
    }
    return { kind: 'waiting' };
}
/**
 * Who has just come close enough to be told so, and the updated drop.
 *
 * Once each, and only for the last stretch. A running commentary would take the
 * searching out of it, and the notice is there to tell somebody their next
 * thirty seconds matter, not to walk them in.
 */
export function warming(drop, players) {
    const warmed = new Set(drop.warmed ?? []);
    const fresh = [];
    for (const player of players) {
        if (!player.steam || player.x === undefined || player.y === undefined)
            continue;
        if (warmed.has(player.steam))
            continue;
        if (distance(player.x, player.y, drop.x, drop.y) <= drop.radius * 3) {
            warmed.add(player.steam);
            fresh.push(player.steam);
        }
    }
    return { drop: { ...drop, warmed: [...warmed] }, steam: fresh };
}
// ------------------------------------------------------------ what is said --
export const dropAnnounce = (drop) => `THE DROP: something died out there. First one to it takes ${drop.reward} points. `
    + hintText(drop, 0);
export const hintAnnounce = (text) => `THE DROP: ${text}`;
export const foundAnnounce = (who, drop) => `THE DROP: ${who} got there first and takes ${drop.reward} points.`;
export const expiredAnnounce = () => 'THE DROP: nobody found it. The carrion goes to the flies.';
/** The on-screen notice for somebody who has come close. */
export const warmNotice = () => 'THE DROP: the scent is strong here. It is close.';
export function buildDropEmbed(drop, hint) {
    return new EmbedBuilder()
        .setColor(0xd6a03a)
        .setTitle('🩸  The Drop')
        .setDescription(`Something died out on the island. **First one to reach it** takes `
        + `**${drop.reward}** points`
        + (drop.skin ? ` and the **${drop.skin}** skin` : '') + '.\n\n'
        + `**${hint}**\n`
        + '-# The area narrows every couple of minutes until somebody finds it.')
        .addFields({
        name: 'Ends',
        value: `<t:${Math.floor(drop.endsAt / 1000)}:R>`,
        inline: true,
    })
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
}
export function buildDropOverEmbed(drop, winner) {
    return new EmbedBuilder()
        .setColor(winner ? 0x57f287 : 0x4f545c)
        .setTitle(winner ? '🩸  Found' : '🩸  Nobody found it')
        .setDescription(winner
        ? `**${winner}** reached it first and takes **${drop.reward}** points`
            + (drop.skin ? ` and the **${drop.skin}** skin` : '') + '.'
        : `It was at Lat **${hud(drop.y)}**, Long **${hud(drop.x)}**. `
            + `Nobody got there in time.`)
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
}
/**
 * Starts one, or says why not.
 *
 * Refuses with nobody online rather than dropping it into an empty island: the
 * location comes from where people actually are, and a drop nobody is there to
 * hunt is just a number in the database.
 */
export function startDrop(ctx, players, options, now = Date.now(), random = Math.random) {
    if (activeDrop(ctx)) {
        return { ok: false, reason: 'There is already a drop out there. Stop it first.' };
    }
    const where = placeDrop(players, random);
    if (!where) {
        return {
            ok: false,
            reason: `Nobody is on ${SERVER} right now, and the drop lands near the people `
                + 'hunting it. Try again when somebody is in game.',
        };
    }
    const drop = {
        x: where.x,
        y: where.y,
        radius: options.radius * 1000,
        reward: options.reward,
        ...(options.skin ? { skin: options.skin } : {}),
        startedAt: now,
        endsAt: now + (options.minutes * 60_000),
        // The opening announcement carries the first hint, so the clock for the
        // second one starts now.
        hintsGiven: 1,
        lastHintAt: now,
    };
    saveDrop(ctx, drop);
    return { ok: true, drop };
}
/** Pays the finder and clears it. */
export function claimDrop(ctx, drop, steamId) {
    ctx.db.addPoints(steamId, drop.reward, 0);
    if (drop.skin)
        ctx.db.grantSkin(steamId, drop.skin, 'Found the drop');
    saveDrop(ctx, null);
}
//# sourceMappingURL=drop.js.map