import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { renderRegions } from './heatimage.js';
import { resolveMapImage, storedBounds } from './heatmap.js';
import { postOrEdit } from './pinned.js';
import { tell } from './tell.js';
/**
 * The Active Region: somewhere worth being, for a while.
 *
 * One broad area of the map is named for a stretch of time. Spend enough
 * *active* minutes inside it and the points land when it ends. Nothing is
 * marked on anybody's screen, nobody is moved, and taking part is optional —
 * the whole point is to give people a reason to drift toward each other
 * without telling anyone where anyone is.
 *
 * **Reuses what already runs.** Positions come from the same poll the contest
 * and heatmap use, identity is the linked Steam account, and points go through
 * the existing transaction. Nothing new enumerates the world.
 *
 * **Regions are circles, deliberately.** A polygon border would be more
 * faithful to the map and much harder to reason about; a centre and a radius
 * can be checked with one distance and explained to a player in a sentence.
 */
const STATE_KEY = 'region_event';
const KEYS = {
    channel: 'region_channel',
    mapChannel: 'region_map_channel',
    mapMessage: 'region_map_message',
    auto: 'region_auto',
    reward: 'region_reward',
    minutes: 'region_minutes',
    required: 'region_required_minutes',
    minPlayers: 'region_min_players',
    roleMention: 'region_role',
    overrides: 'region_overrides',
    lastRegion: 'region_last',
};
export const DEFAULTS = {
    reward: 300,
    /** How long an event runs. */
    minutes: 45,
    /** Active time inside it before somebody qualifies. */
    requiredMinutes: 15,
    minPlayers: 2,
    /** The gap between automatic events is drawn from this range. */
    gapMinMinutes: 60,
    gapMaxMinutes: 90,
};
/** How often participation is counted. Cheap: it reads the existing poll. */
export const CHECK_SECONDS = 30;
/**
 * No meaningful movement for this long and somebody stops accruing.
 *
 * Generous on purpose. Resting, hiding and eating are all things a player
 * should be able to do inside the region without being called AFK, so this
 * only catches somebody who has not moved at all for a long stretch.
 */
export const AFK_MINUTES = 10;
/** Movement below this between two checks does not count as having moved. */
const MOVED_UNITS = 2000;
/**
 * The regions, as shipped.
 *
 * ⚠️ **EVERY COORDINATE BELOW IS A PLACEHOLDER.** They are spaced out across
 * the map so the feature can be exercised, but none of them has been measured
 * against the real Gateway landmarks and none should be trusted for a live
 * event until it has been.
 *
 * To fix one: stand in the middle of the area in game, read your position from
 * `/active-region status`, and set it with `/active-region move`. That writes
 * an override to the database, so no redeploy is needed and this list stays as
 * the fallback.
 *
 * The radius is in world units, the same scale positions arrive in — roughly
 * 1000 per HUD unit. 150000 is about 150 HUD units across the radius, which is
 * a large area on purpose: this is meant to gather people loosely, not to
 * stand them on a spot.
 */
export const REGIONS = [
    { id: 'highlands', name: 'Highlands', x: -143_000, y: 60_000, radius: 150_000, enabled: true },
    { id: 'hexagon', name: 'Hexagon', x: -40_634, y: 114_107, radius: 150_000, enabled: true },
    { id: 'crater', name: 'Crater', x: 267_709, y: -278_431, radius: 150_000, enabled: true },
    { id: 'lakes', name: 'The Lakes', x: 0, y: 0, radius: 150_000, enabled: true },
    { id: 'swamp', name: 'The Swamp', x: 150_000, y: 150_000, radius: 150_000, enabled: true },
];
/** Regions with any admin overrides applied. */
export function regionsFor(ctx) {
    let overrides = {};
    try {
        const raw = ctx.db.getSetting(KEYS.overrides);
        if (raw)
            overrides = JSON.parse(raw);
    }
    catch {
        // A broken override must not hide every region.
    }
    return REGIONS.map((region) => ({ ...region, ...(overrides[region.id] ?? {}) }));
}
export function setRegionOverride(ctx, id, patch) {
    let overrides = {};
    try {
        const raw = ctx.db.getSetting(KEYS.overrides);
        if (raw)
            overrides = JSON.parse(raw);
    }
    catch {
        overrides = {};
    }
    overrides[id] = { ...(overrides[id] ?? {}), ...patch };
    ctx.db.setSetting(KEYS.overrides, JSON.stringify(overrides));
}
export const regionById = (ctx, id) => regionsFor(ctx).find((r) => r.id === id) ?? null;
// ----------------------------------------------------------------- settings --
const num = (ctx, key, fallback) => {
    const raw = Number.parseFloat(ctx.db.getSetting(key) ?? '');
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};
export const regionChannel = (ctx) => ctx.db.getSetting(KEYS.channel) || null;
export const regionMapChannel = (ctx) => ctx.db.getSetting(KEYS.mapChannel) || null;
export const REGION_MAP_MESSAGE_KEY = KEYS.mapMessage;
export const regionRole = (ctx) => ctx.db.getSetting(KEYS.roleMention) || null;
export const autoRegions = (ctx) => ctx.db.getSetting(KEYS.auto) === '1';
export const regionSettings = (ctx) => ({
    reward: num(ctx, KEYS.reward, DEFAULTS.reward),
    minutes: num(ctx, KEYS.minutes, DEFAULTS.minutes),
    requiredMinutes: num(ctx, KEYS.required, DEFAULTS.requiredMinutes),
    minPlayers: num(ctx, KEYS.minPlayers, DEFAULTS.minPlayers),
});
export const setRegionSetting = (ctx, key, value) => ctx.db.setSetting(KEYS[key], value);
export function activeEvent(ctx) {
    const raw = ctx.db.getSetting(STATE_KEY);
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed.eventId === 'string' && typeof parsed.endsAt === 'number'
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export const saveEvent = (ctx, event) => ctx.db.setSetting(STATE_KEY, event ? JSON.stringify(event) : '');
/** Straight-line distance, which is what "inside" means for a circle. */
export const distanceTo = (region, x, y) => Math.hypot(x - region.x, y - region.y);
export const inside = (region, player) => typeof player.x === 'number' && typeof player.y === 'number'
    && distanceTo(region, player.x, player.y) <= region.radius;
/**
 * Picks the next region, avoiding an immediate repeat.
 *
 * Pure so the "never twice running" rule can be tested without a clock.
 */
export function pickRegion(regions, lastId, roll = Math.random()) {
    const usable = regions.filter((r) => r.enabled);
    if (usable.length === 0)
        return null;
    // Only exclude the last one when there is something else to pick.
    const choices = usable.length > 1 ? usable.filter((r) => r.id !== lastId) : usable;
    const at = Math.min(choices.length - 1, Math.floor(roll * choices.length));
    return choices[at] ?? null;
}
/**
 * One participation check.
 *
 * Pure: this is the part that decides who gets paid, so it is testable without
 * a server. Time is credited between two checks rather than on first sighting,
 * the same way the contest does it — being seen once says only that somebody
 * arrived at some point in the last interval.
 */
export function tickEvent(event, region, players, now) {
    const elapsed = Math.max(0, Math.min(now - event.lastCheck, CHECK_SECONDS * 4 * 1000));
    const next = {
        ...event,
        participants: { ...event.participants },
        lastCheck: now,
    };
    const counted = [];
    const afk = [];
    const insideNow = new Set();
    for (const player of players) {
        // No Steam account is no identity, and nothing can be paid to it.
        if (!player.steam)
            continue;
        // A stored or dead dinosaur is not somebody standing in the region.
        if (player.x === undefined || player.y === undefined)
            continue;
        if (!inside(region, player))
            continue;
        const before = next.participants[player.steam];
        const moved = before?.lastX === undefined || before.lastY === undefined
            ? true
            : Math.hypot(player.x - before.lastX, player.y - before.lastY) > MOVED_UNITS;
        const movedAt = moved ? now : (before?.movedAt ?? now);
        const idleMs = now - movedAt;
        const entry = {
            seconds: before?.seconds ?? 0,
            lastX: player.x,
            lastY: player.y,
            movedAt,
        };
        // Resting, hiding and eating are all fine. Only somebody who has not moved
        // at all for a long stretch stops accruing.
        if (idleMs > AFK_MINUTES * 60_000) {
            afk.push(player.steam);
            next.participants[player.steam] = entry;
            continue;
        }
        // Credited only between two sightings INSIDE the region. `lastX` is
        // cleared on the way out, so somebody who left and came back is treated
        // like a fresh arrival — otherwise the whole time they were away is paid
        // for on their first check back.
        if (before?.lastX !== undefined && elapsed > 0) {
            entry.seconds = before.seconds + Math.round(elapsed / 1000);
            counted.push(player.steam);
        }
        next.participants[player.steam] = entry;
        insideNow.add(player.steam);
    }
    // Edges, from who was inside last time. `lastX` is only set for somebody seen
    // in the region, so its presence is the record of having been there.
    const wasInside = new Set(Object.entries(event.participants)
        .filter(([, p]) => p.lastX !== undefined)
        .map(([steam]) => steam));
    const entered = [...insideNow].filter((s) => !wasInside.has(s));
    const left = [...wasInside].filter((s) => !insideNow.has(s));
    // Somebody who left stops being "inside" without losing their time.
    for (const steam of left) {
        const held = next.participants[steam];
        if (held)
            next.participants[steam] = { ...held, lastX: undefined, lastY: undefined };
    }
    return { event: next, counted, afk, entered, left };
}
/** Who has put in the time. */
export const qualified = (event) => Object.entries(event.participants)
    .filter(([, p]) => p.seconds >= event.requiredMinutes * 60)
    .map(([steam]) => steam);
/**
 * Pays everybody who qualified, once.
 *
 * `rewarded` is set before the payments and saved immediately, so a crash
 * midway cannot pay the same event twice on the next start. Each payment is
 * its own transaction: one failure must not cost everybody else theirs.
 */
export function payOut(ctx, event, log) {
    const winners = qualified(event);
    const enough = winners.length >= event.minPlayers;
    const dryRun = event.dryRun === true;
    if (event.rewarded) {
        log(`region: ${event.eventId} was already paid, skipping`);
        return { paid: [], reward: event.reward, enough, dryRun };
    }
    saveEvent(ctx, { ...event, rewarded: true });
    if (!enough || dryRun)
        return { paid: [], reward: event.reward, enough, dryRun };
    const paid = [];
    for (const steam of winners) {
        try {
            ctx.db.addPoints(steam, event.reward, 0);
            paid.push(steam);
        }
        catch (err) {
            log(`region: could not pay ${steam}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    log(`region: ${event.eventId} paid ${paid.length} of ${winners.length} qualified`);
    return { paid, reward: event.reward, enough, dryRun };
}
// ------------------------------------------------------------------ embeds --
export function buildStartEmbed(event) {
    return new EmbedBuilder()
        .setColor(0xff6b35)
        .setTitle(`🔥  Active Region: ${event.regionName}`)
        .setDescription(`**${event.regionName}** is the Active Region for the next `
        + `**${Math.round((event.endsAt - event.startedAt) / 60_000)} minutes**.\n\n`
        + `Spend at least **${event.requiredMinutes} active minutes** inside it to `
        + `earn **${event.reward}** points.`
        + (event.dryRun ? '\n\n🧪 This is a test event. Nobody is paid.' : ''))
        .addFields({
        name: 'How it works',
        value: 'No exact locations are shown and nobody is moved. Taking part is '
            + 'optional — resting, hiding and eating all still count, so long as you '
            + 'are somewhere in the region.',
    })
        .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
        .setTimestamp(new Date(event.startedAt));
}
export function buildEndEmbed(event, payout, gapMinutes) {
    const embed = new EmbedBuilder()
        .setColor(payout.paid.length > 0 ? 0x57f287 : 0x4f545c)
        .setTitle('Active Region ended')
        .setDescription(`The **${event.regionName}** event has finished.`)
        .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
        .setTimestamp();
    if (payout.dryRun) {
        embed.addFields({
            name: '🧪  Test event',
            value: `**${qualified(event).length}** would have qualified. No points were paid.`,
        });
        return embed;
    }
    if (!payout.enough) {
        embed.addFields({
            name: 'No rewards this time',
            value: `Only **${qualified(event).length}** qualified, and **${event.minPlayers}** `
                + 'are needed. Nothing was paid.',
        });
    }
    else {
        embed.addFields({ name: 'Qualified players', value: String(payout.paid.length), inline: true }, { name: 'Reward', value: `${payout.reward} points each`, inline: true });
    }
    embed.addFields({
        name: 'Next region',
        value: `approximately ${gapMinutes[0]}–${gapMinutes[1]} minutes`,
    });
    return embed;
}
// ------------------------------------------------------------------ running --
/** When the next automatic event is due. Stored so a restart does not reset it. */
const NEXT_KEY = 'region_next_at';
export const nextEventAt = (ctx) => {
    const raw = Number.parseInt(ctx.db.getSetting(NEXT_KEY) ?? '', 10);
    return Number.isFinite(raw) ? raw : 0;
};
export function scheduleNext(ctx, now = Date.now(), roll = Math.random()) {
    const span = DEFAULTS.gapMaxMinutes - DEFAULTS.gapMinMinutes;
    const minutes = DEFAULTS.gapMinMinutes + Math.round(roll * span);
    const at = now + (minutes * 60_000);
    ctx.db.setSetting(NEXT_KEY, String(at));
    return at;
}
/**
 * Opens an event.
 *
 * Refuses while one is running: two at once would split everybody and neither
 * would gather anyone, which is the entire point of the feature.
 */
export function startEvent(ctx, options = {}, now = Date.now()) {
    if (activeEvent(ctx))
        return { ok: false, reason: 'An Active Region is already running.' };
    const settings = regionSettings(ctx);
    const regions = regionsFor(ctx);
    const region = options.regionId
        ? regions.find((r) => r.id === options.regionId) ?? null
        : pickRegion(regions, ctx.db.getSetting(KEYS.lastRegion) || null);
    if (!region) {
        return {
            ok: false,
            reason: options.regionId
                ? 'No region with that id.'
                : 'No regions are enabled. Check `/active-region regions`.',
        };
    }
    const minutes = options.minutes ?? settings.minutes;
    const event = {
        eventId: `AR-${now}`,
        regionId: region.id,
        regionName: region.name,
        startedAt: now,
        endsAt: now + (minutes * 60_000),
        reward: options.reward ?? settings.reward,
        requiredMinutes: options.requiredMinutes ?? settings.requiredMinutes,
        minPlayers: settings.minPlayers,
        participants: {},
        rewarded: false,
        ...(options.dryRun ? { dryRun: true } : {}),
        lastCheck: now,
    };
    saveEvent(ctx, event);
    ctx.db.setSetting(KEYS.lastRegion, region.id);
    return { ok: true, event };
}
/**
 * Finishes an event: pays, clears, and schedules the next.
 *
 * Safe to call twice — `payOut` refuses a second payment on the same event, so
 * a restart that finds an expired event finalises it exactly once.
 */
export function finishEvent(ctx, event, log) {
    const payout = payOut(ctx, event, log);
    saveEvent(ctx, null);
    scheduleNext(ctx);
    return payout;
}
// ------------------------------------------------------------- the runner --
/** Posts an embed to the announcement channel, mentioning a role if configured. */
export async function announceRegion(ctx, client, embed, log) {
    const channelId = regionChannel(ctx);
    if (!channelId) {
        log('region: no announcement channel configured');
        return;
    }
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || !('send' in channel)) {
            log(`region: announcement channel ${channelId} is unreachable`);
            return;
        }
        // Off by default. Nobody wants an every-hour ping, so it is opt-in and
        // limited to the one role that asked for it.
        const role = regionRole(ctx);
        await channel.send({
            ...(role ? { content: `<@&${role}>` } : {}),
            embeds: [embed],
            allowedMentions: role ? { roles: [role] } : { parse: [] },
        });
    }
    catch (err) {
        log(`region: could not announce: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * One pass of the whole feature: count participation, finish what is due, and
 * start the next when it is time.
 *
 * Called from the poll that already reads positions, so it costs nothing
 * extra. Never throws: an Active Region must not be able to take the poll down.
 */
export async function runRegions(ctx, client, players, log) {
    const now = Date.now();
    const event = activeEvent(ctx);
    if (event) {
        const region = regionById(ctx, event.regionId);
        // The region was disabled or renamed mid-event. Finish rather than leaving
        // it running against something that no longer exists.
        if (!region) {
            log(`region: ${event.regionId} is gone, finishing ${event.eventId}`);
            const payout = finishEvent(ctx, event, log);
            await announceRegion(ctx, client, buildEndEmbed(event, payout, [DEFAULTS.gapMinMinutes, DEFAULTS.gapMaxMinutes]), log);
            return;
        }
        if (now >= event.endsAt) {
            const payout = finishEvent(ctx, event, log);
            log(`region: ${event.eventId} ended, ${payout.paid.length} paid`);
            await announceRegion(ctx, client, buildEndEmbed(event, payout, [DEFAULTS.gapMinMinutes, DEFAULTS.gapMaxMinutes]), log);
            await drawRegionMap(ctx, client, log);
            return;
        }
        // Only every CHECK_SECONDS, however often the poll runs.
        if (now - event.lastCheck < CHECK_SECONDS * 1000)
            return;
        const result = tickEvent(event, region, players, now);
        saveEvent(ctx, result.event);
        // The same on-screen notices the contest gives, for the same reason: the
        // boundary is invisible, so crossing it is the only way anybody knows they
        // are in. Edges only — one every check would be unreadable.
        for (const steam of result.entered) {
            void tell(ctx, steam, `ACTIVE REGION: you are inside ${region.name}. `
                + `${event.requiredMinutes} active minutes earns ${event.reward} points.`);
        }
        for (const steam of result.left) {
            const held = Math.round((result.event.participants[steam]?.seconds ?? 0) / 60);
            void tell(ctx, steam, `ACTIVE REGION: you left ${region.name}. `
                + `${held} minute${held === 1 ? '' : 's'} kept - come back to carry on.`);
        }
        return;
    }
    // Nothing running. Start one when automatic events are on and it is due.
    if (!autoRegions(ctx))
        return;
    if (!regionChannel(ctx))
        return;
    const due = nextEventAt(ctx);
    if (due === 0) {
        // First run after the channel was set: schedule rather than firing now.
        scheduleNext(ctx, now);
        return;
    }
    if (now < due)
        return;
    const started = startEvent(ctx, {}, now);
    if (!started.ok) {
        log(`region: could not start — ${started.reason}`);
        scheduleNext(ctx, now);
        return;
    }
    log(`region: ${started.event.eventId} started in ${started.event.regionName}`);
    await announceRegion(ctx, client, buildStartEmbed(started.event), log);
    await drawRegionMap(ctx, client, log);
}
/**
 * The region map: the areas, and deliberately not the players.
 *
 * Shares the heatmap's projection and base image, so a region drawn here lands
 * where the same coordinates land there — which is what makes it possible to
 * check a placeholder against the real map.
 */
export async function drawRegionMap(ctx, client, log) {
    const channelId = regionMapChannel(ctx);
    if (!channelId)
        return;
    try {
        const event = activeEvent(ctx);
        const shapes = regionsFor(ctx)
            .filter((r) => r.enabled)
            .map((r) => ({
            name: r.name,
            x: r.x,
            y: r.y,
            radius: r.radius,
            active: event?.regionId === r.id,
        }));
        const base = await resolveMapImage(ctx);
        const png = await renderRegions(shapes, storedBounds(ctx), base);
        const embed = new EmbedBuilder()
            .setColor(event ? 0xff6b35 : 0x5865f2)
            .setTitle(event ? `🔥  Active Region: ${event.regionName}` : '🗺️  Active Regions')
            .setDescription(event
            ? `**${event.regionName}** is active until <t:${Math.floor(event.endsAt / 1000)}:t>.`
            : 'These are the areas that can become active. No player positions are '
                + 'shown here, and none ever will be.')
            .setImage('attachment://regions.png')
            .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
            .setTimestamp();
        await postOrEdit(ctx.db, client, channelId, REGION_MAP_MESSAGE_KEY, [embed], [], [{ attachment: png, name: 'regions.png' }]);
    }
    catch (err) {
        log(`region: could not draw the map: ${err instanceof Error ? err.message : String(err)}`);
    }
}
//# sourceMappingURL=regions.js.map