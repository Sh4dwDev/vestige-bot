/**
 * The Early Member role: the first N people, and nobody after.
 *
 * Held as a **Discord role** rather than a list in the database, because the
 * role is the thing people can see and the thing a channel is gated on. Two
 * records of the same fact drift apart, and the one an admin can edit by hand
 * is the one that wins — so Discord is the record and this only ever adds to it.
 *
 * That also makes the count self-correcting: remove somebody from the role and
 * a slot genuinely frees up, with nothing left holding a stale claim.
 *
 * **It is earned by playing, not by joining Discord.** Handing it out at the
 * door meant fifty seats could go to people who never opened the game, which is
 * the opposite of what "early member" is for. A seat now costs an hour on the
 * server, counted from the same `minutes` the points system already accrues on
 * its own poll — so there is no second clock to disagree with the first.
 *
 * Nobody who already holds it loses it. Nothing here ever removes the role, and
 * the playtime rule is only ever consulted before an add.
 */
const ROLE_KEY = 'early_member_role';
const MINUTES_KEY = 'early_member_minutes';
/** An hour, in minutes. Long enough to mean something, short enough to reach. */
export const DEFAULT_MINUTES = 60;
export function earlyMinutes(ctx) {
    const raw = Number.parseInt(ctx.db.getSetting(MINUTES_KEY) ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_MINUTES;
}
export const setEarlyMinutes = (ctx, minutes) => ctx.db.setSetting(MINUTES_KEY, String(Math.max(0, Math.round(minutes))));
/**
 * How long this Discord member has played, or null when nobody knows.
 *
 * Null and zero are different answers: an unlinked member has no Steam account
 * to look up, which is not the same as one who has linked and played nothing.
 */
export function minutesPlayed(ctx, discordId) {
    const link = ctx.db.linkFor(discordId);
    if (!link)
        return null;
    return ctx.db.pointsFor(link.steamId).minutes;
}
/** Whether they have put in the time. Pure enough to test without Discord. */
export const hasPlayedEnough = (minutes, required) => minutes !== null && minutes >= required;
export function earlyRole(ctx) {
    return ctx.db.getSetting(ROLE_KEY) || null;
}
export function setEarlyRole(ctx, roleId) {
    ctx.db.setSetting(ROLE_KEY, roleId ?? '');
}
export const holders = (guild, roleId) => guild.roles.cache.get(roleId)?.members.size ?? 0;
export const hasEarlyRole = (member, roleId) => member.roles.cache.has(roleId);
/**
 * Gives the role if there is room.
 *
 * The cap is checked against Discord's own membership immediately before the
 * add. Two people joining at the same instant can still both pass it — Discord
 * offers no atomic way to do this — so the cap is a limit rather than a
 * guarantee, and being one over is a far smaller problem than refusing somebody
 * who was inside it.
 *
 * Playtime is checked **before** the cap, so somebody who has not earned it yet
 * is never the reason a seat is reported as gone.
 */
export async function grantEarlyRole(ctx, member, limit, log) {
    const roleId = earlyRole(ctx);
    if (!roleId)
        return 'no-role';
    if (member.user.bot)
        return 'no-role';
    // Ahead of every other check: somebody who already has it keeps it, whatever
    // the rules have become since.
    if (hasEarlyRole(member, roleId))
        return 'already';
    if (!hasPlayedEnough(minutesPlayed(ctx, member.id), earlyMinutes(ctx))) {
        return 'unqualified';
    }
    if (holders(member.guild, roleId) >= limit)
        return 'full';
    try {
        await member.roles.add(roleId, 'Early member');
        return 'given';
    }
    catch (err) {
        // The same two causes as every other role here, and Discord reports both
        // as one generic error: no Manage Roles, or the bot's own role sits below.
        log(`earlymember: could not give ${roleId} to ${member.id}: ${err instanceof Error ? err.message : String(err)}`);
        return 'failed';
    }
}
/**
 * Hands the role to everyone who has already earned it, most played first.
 *
 * Ordering changed with the rule. Discord join date was right when the role was
 * given at the door; now that it is earned in game, the person who has played
 * most is the one who reached the hour first, and the bot does not record the
 * moment anybody crossed it. Going forward the online poll grants in real time,
 * which is genuinely first-come-first-served — this ordering only decides who
 * gets the seats among people who already qualified before the rule existed.
 */
export async function backfillEarlyRole(ctx, guild, limit, log) {
    const roleId = earlyRole(ctx);
    if (!roleId)
        return { given: 0, already: 0, skipped: 0, full: false, unqualified: 0 };
    // Fetched rather than read from cache: the cache holds whoever the bot has
    // happened to see, which is not the same as the membership.
    const required = earlyMinutes(ctx);
    const members = await guild.members.fetch();
    const ordered = [...members.values()]
        .filter((m) => !m.user.bot)
        .map((m) => ({ member: m, minutes: minutesPlayed(ctx, m.id) }))
        // Anybody already holding it stays in the list: they are counted as
        // `already` below, and dropping them here would hide them from the report.
        .filter((e) => hasPlayedEnough(e.minutes, required) || hasEarlyRole(e.member, roleId))
        .sort((a, b) => (b.minutes ?? 0) - (a.minutes ?? 0))
        .map((e) => e.member);
    const out = { given: 0, already: 0, skipped: 0, full: false, unqualified: 0 };
    for (const member of ordered) {
        if (hasEarlyRole(member, roleId)) {
            out.already += 1;
            continue;
        }
        if (holders(guild, roleId) + out.given >= limit) {
            out.full = true;
            break;
        }
        const result = await grantEarlyRole(ctx, member, limit, log);
        if (result === 'given')
            out.given += 1;
        else if (result === 'already')
            out.already += 1;
        else if (result === 'full') {
            out.full = true;
            break;
        }
        else if (result === 'unqualified')
            out.unqualified += 1;
        else
            out.skipped += 1;
    }
    log(`earlymember: backfill gave ${out.given}, ${out.already} already had it`);
    return out;
}
//# sourceMappingURL=earlymember.js.map