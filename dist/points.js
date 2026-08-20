import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { rankIcon } from './ranks.js';
import { playMultiplier } from './events.js';
import { multiplierFor, tierOf } from './tiers.js';
/**
 * Points, earned by playing.
 *
 * Awarded per minute against the poll that already runs, and keyed by Steam ID
 * so someone who has never touched Discord still builds a balance and finds it
 * waiting when they link.
 *
 * Nothing spends them yet. That is deliberate — the earning side wants to run
 * for a while and be seen to be fair before anything depends on the numbers.
 */
const RATE_KEY = 'points_per_hour';
export const DEFAULT_RATE_PER_HOUR = 60;
/**
 * The most one poll may pay for, however long it actually was.
 *
 * Without it, a bot that was down for six hours would, on its first tick, pay
 * everyone online for all six — including people who joined a minute ago.
 */
const MAX_MINUTES_PER_AWARD = 5;
export function ratePerHour(ctx) {
    const raw = Number.parseFloat(ctx.db.getSetting(RATE_KEY) ?? '');
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RATE_PER_HOUR;
}
export function setRatePerHour(ctx, rate) {
    ctx.db.setSetting(RATE_KEY, String(rate));
}
/**
 * How much to pay for a gap of `elapsedMs`, and how many minutes that counts
 * as. Pure, because the capping rule is the part worth testing.
 */
export function awardFor(elapsedMs, rate) {
    const minutes = Math.min(MAX_MINUTES_PER_AWARD, Math.max(0, elapsedMs / 60_000));
    return { points: (minutes / 60) * rate, minutes: Math.round(minutes) };
}
/**
 * Pays everyone currently playing, scaled by the tier of what they are on.
 *
 * Takes the mod's player rows rather than a list of Steam IDs, because the tier
 * depends on the species — which means someone sitting on the spawn screen
 * earns nothing. That is the intended reading of "earned by playing".
 */
export function awardOnline(ctx, players, elapsedMs) {
    const { points, minutes } = awardFor(elapsedMs, ratePerHour(ctx));
    if (points <= 0 || players.length === 0)
        return 0;
    let paid = 0;
    for (const player of players) {
        if (!player.steam)
            continue;
        // Tier sets the base rate; an endangered event multiplies on top, so
        // taking the unpopular species and surviving on it actually pays.
        const scaled = points
            * multiplierFor(ctx, tierOf(ctx, player.species))
            * playMultiplier(ctx, player.species);
        ctx.db.addPoints(player.steam, scaled, minutes);
        paid += scaled;
    }
    return paid;
}
// ------------------------------------------------------------------ embeds --
const hours = (minutes) => minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
/** Floored: showing 41.7 points invites arguments about rounding. */
export const display = (balance) => Math.floor(balance);
export function buildBalanceEmbed(balance, minutes, rate) {
    return new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('🪙  Your points')
        .setDescription(`## ${display(balance).toLocaleString()}\n` +
        `Earned over **${hours(minutes)}** on ${SERVER}.\n\n` +
        `You earn **${rate}** points an hour just by playing, more on higher tiers ` +
        'and for kills.\n\nSpend them with `/shop` on a **fully grown** dinosaur, ' +
        'delivered into your archive.')
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
}
export function buildLeaderboardEmbed(rows, nameFor) {
    const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle('🏆  Most points on ' + SERVER)
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
    if (rows.length === 0) {
        return embed.setDescription('Nobody has earned anything yet.');
    }
    embed.setDescription(rows
        .map((row, n) => `${rankIcon(n)}  **${display(row.balance).toLocaleString()}** ` +
        `· ${nameFor(row.steamId)} · ${hours(row.minutes)} played`)
        .join('\n'));
    return embed;
}
//# sourceMappingURL=points.js.map