import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
/**
 * A place worth fighting over.
 *
 * A location is announced. Stand there long enough and it is yours. Stand there
 * with somebody else and **nobody's timer moves** until one of you is gone.
 *
 * **Deliberately built on watching, not spawning.** Putting a real nest or egg
 * in the world means spawning a pawn and its controller from Lua, which this
 * project has already tried: four commits of AI wildlife, then "Remove the AI
 * wildlife feature". Positions are read every few seconds anyway for the
 * heatmap, so a contested point needs no new engine capability at all — which
 * is why it can be trusted to work.
 *
 * Progress is **cumulative rather than continuous**. "Stay with it" suggests an
 * unbroken hold, but positions arrive every few seconds and a player who dies
 * or lags briefly would lose everything to a gap in the data rather than to
 * another player. Freezing on contest is what makes it a fight; resetting on a
 * dropped packet would only make it a lottery.
 */
const KEY = 'contest_state';
export function activeContest(ctx) {
    const raw = ctx.db.getSetting(KEY);
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw);
        return typeof parsed.x === 'number' && typeof parsed.y === 'number'
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export const saveContest = (ctx, contest) => ctx.db.setSetting(KEY, contest ? JSON.stringify(contest) : '');
/** Straight-line distance, which is what "near it" means on a flat map. */
export const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
export const inside = (contest, player) => typeof player.x === 'number' && typeof player.y === 'number'
    && distance(player.x, player.y, contest.x, contest.y) <= contest.radius;
/**
 * Advances the hold clock.
 *
 * Pure on purpose: this is the part with the rules in it, and rules are worth
 * testing without a server attached.
 */
export function tickContest(contest, players, elapsedMs) {
    const holders = players
        .filter((p) => p.steam && inside(contest, p))
        .map((p) => p.steam);
    const contested = !contest.shared && holders.length > 1;
    const wasPresent = new Set(contest.present ?? []);
    const next = {
        ...contest,
        progress: { ...contest.progress },
        // Recorded every tick, contested or not: leaving somebody out here would
        // make them start again from zero the moment a rival turned up.
        present: holders,
    };
    // Time is only credited between two sightings. The first one establishes that
    // somebody is there; the second is the first that can prove they stayed. So a
    // hold rounds up to the next whole tick rather than being handed out for
    // arriving, which is the honest direction to be wrong in.
    //
    // Nobody gains while it is contested. That is the whole mechanic: the way to
    // stop somebody taking it is to be standing there too.
    if (!contested && elapsedMs > 0) {
        for (const holder of holders) {
            if (wasPresent.has(holder)) {
                next.progress[holder] = (next.progress[holder] ?? 0) + elapsedMs;
            }
        }
    }
    // Everybody who is still standing there and has done the time. On a solo
    // point that can only ever be one person, because a second freezes the clock.
    const winners = contested
        ? []
        : holders.filter((h) => (next.progress[h] ?? 0) >= contest.holdMs);
    return { contest: next, holders, contested, winner: winners[0] ?? null, winners };
}
/** Best progress so far, for the panel and the announcement. */
export function leader(contest) {
    const entries = Object.entries(contest.progress);
    if (entries.length === 0)
        return null;
    const best = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
    return { steam: best[0], heldMs: best[1] };
}
const minutes = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};
/** The HUD scale, so a player can navigate to it. */
export const hud = (value) => Math.round(value / 1000);
export function buildContestEmbed(contest, nameFor, state = { holders: [], contested: false }) {
    const best = leader(contest);
    return new EmbedBuilder()
        .setColor(state.contested ? 0xed4245 : 0xfee75c)
        .setTitle(`🚩  ${contest.name}`)
        .setDescription(`Hold this spot for **${minutes(contest.holdMs)}** to claim it.\n\n` +
        `📍 Lat **${hud(contest.y)}**, Long **${hud(contest.x)}** — anywhere within ` +
        `**${hud(contest.radius)}** counts.\n` +
        `🏆 **${contest.reward}** points` +
        (contest.skin ? ` and the **${contest.skin}** skin` : '') + '.\n\n' +
        (contest.shared
            ? state.holders.length > 0
                ? `🤝 **${state.holders.length}** on it, all gaining together. ` +
                    'Everybody who lasts gets paid in full.'
                : '🤝 Bring friends — everybody who holds it wins.'
            : state.contested
                ? `⚔️ **Contested.** ${state.holders.length} of you are on it, so nobody ` +
                    'is gaining. Somebody has to leave.'
                : state.holders.length === 1
                    ? '⏳ Someone is holding it right now.'
                    : '🕳️ Nobody is on it.'))
        .addFields(best
        ? [{
                name: 'Closest so far',
                value: `${nameFor(best.steam)} — **${minutes(best.heldMs)}** of ` +
                    `${minutes(contest.holdMs)}`,
            }]
        : [])
        .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
        .setTimestamp();
}
/** ASCII only: this goes out over RCON, which silently drops anything else. */
export const contestAnnounce = (contest) => `${contest.name}: hold Lat ${hud(contest.y)}, Long ${hud(contest.x)} for `
    + `${Math.round(contest.holdMs / 60000)} minutes to win ${contest.reward} points. `
    + (contest.shared
        ? 'Everybody standing there wins it, so bring your group.'
        : 'Two or more players on it and nobody gains.');
export const winnerAnnounce = (contest, who) => `${who} held ${contest.name} and takes ${contest.reward} points.`;
/** The shared version, where the whole group is named and each is paid in full. */
export const winnersAnnounce = (contest, who) => who.length <= 1
    ? winnerAnnounce(contest, who[0] ?? 'Nobody')
    : `${who.slice(0, -1).join(', ')} and ${who[who.length - 1]} held ${contest.name} `
        + `and take ${contest.reward} points each.`;
// ------------------------------------------------------------------ running --
const CHANNEL_KEY = 'contest_channel';
export const contestChannel = (ctx) => ctx.db.getSetting(CHANNEL_KEY) || null;
export const setContestChannel = (ctx, channelId) => ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
/**
 * One turn of the clock, and the payout if it ends.
 *
 * Called from the poll that already reads positions, so this costs nothing
 * extra. Everything that decides an outcome lives in `tickContest`, which is
 * pure; this only writes the results down and hands out the prize.
 */
export function advanceContest(ctx, players, elapsedMs) {
    const contest = activeContest(ctx);
    if (!contest)
        return null;
    const result = tickContest(contest, players, elapsedMs);
    if (result.winners.length === 0) {
        saveContest(ctx, result.contest);
        return {
            winner: null, winners: [], contested: result.contested, holders: result.holders,
        };
    }
    // Paid and cleared in one go: leaving it active would keep paying the same
    // people every few seconds for standing still. On a shared point everybody
    // who did the time is paid in full rather than splitting it — a group event
    // that pays a fraction each is a worse deal for turning up with friends.
    for (const winner of result.winners) {
        ctx.db.addPoints(winner, contest.reward, 0);
        if (contest.skin)
            ctx.db.grantSkin(winner, contest.skin, `Won ${contest.name}`);
    }
    saveContest(ctx, null);
    return {
        winner: result.winners[0] ?? null,
        winners: result.winners,
        contested: false,
        holders: result.holders,
    };
}
export function buildContestWonEmbed(contest, winner) {
    const held = leader(contest);
    const who = Array.isArray(winner) ? winner : [winner];
    const many = who.length > 1;
    return new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`🏆  ${contest.name} claimed`)
        .setDescription(`${who.join(', ')} held it and take${many ? '' : 's'} ` +
        `**${contest.reward}** points${many ? ' each' : ''}` +
        (contest.skin ? ` and the **${contest.skin}** skin` : '') + '.\n\n' +
        (held ? `Held for **${minutes(held.heldMs)}**.` : ''))
        .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
        .setTimestamp();
}
//# sourceMappingURL=contest.js.map