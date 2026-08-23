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
    const contested = holders.length > 1;
    const next = { ...contest, progress: { ...contest.progress } };
    // Nobody gains while it is contested. That is the whole mechanic: the way to
    // stop somebody taking it is to be standing there too.
    if (holders.length === 1 && elapsedMs > 0) {
        const holder = holders[0];
        next.progress[holder] = (next.progress[holder] ?? 0) + elapsedMs;
    }
    const winner = holders.length === 1
        && (next.progress[holders[0]] ?? 0) >= contest.holdMs
        ? holders[0]
        : null;
    return { contest: next, holders, contested, winner };
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
        (state.contested
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
    + 'Two or more players on it and nobody gains.';
export const winnerAnnounce = (contest, who) => `${who} held ${contest.name} and takes ${contest.reward} points.`;
//# sourceMappingURL=contest.js.map