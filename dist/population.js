import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
/** Species that count as adult at 50% rather than 75%. */
const ADULT_AT_HALF = new Set([
    'Tyrannosaurus',
    'Allosaurus',
    'Deinosuchus',
    'Stegosaurus',
    'Diabloceratops',
    'Triceratops',
    'Kentrosaurus',
    'Baryonyx',
]);
export function adultThreshold(species) {
    return ADULT_AT_HALF.has(species) ? 0.5 : 0.75;
}
export function isAdult(species, growth) {
    return growth >= adultThreshold(species);
}
export function tally(players) {
    const rows = new Map();
    for (const player of players) {
        let row = rows.get(player.species);
        if (!row) {
            row = { species: player.species, online: 0, adults: 0, prime: 0, males: 0, females: 0 };
            rows.set(player.species, row);
        }
        row.online += 1;
        if (player.female)
            row.females += 1;
        else
            row.males += 1;
        if (isAdult(player.species, player.growth)) {
            row.adults += 1;
            // A prime flag on a juvenile is contradictory data; ignoring it stops
            // prime ever exceeding the adult count.
            if (player.prime)
                row.prime += 1;
        }
    }
    return [...rows.values()].sort((a, b) => b.online - a.online || a.species.localeCompare(b.species));
}
const percent = (part, whole) => whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`;
const NAME_WIDTH = 15;
const BAR_WIDTH = 8;
const pad = (text, width) => text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);
/** Share of the population, as a bar. Anyone present gets at least one cell. */
function bar(part, whole) {
    const filled = whole === 0 ? 0 : Math.max(1, Math.round((part / whole) * BAR_WIDTH));
    return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}
/**
 * One aligned line per species, in a code block. Discord's inline fields reflow
 * unpredictably across window widths and phones; a fixed-width table does not,
 * and it stays readable when twenty species are on at once.
 */
function table(rows, total) {
    const lines = rows.map((row) => `${pad(row.species, NAME_WIDTH)} ${bar(row.online, total)} ` +
        `${String(row.online).padStart(2)}  ` +
        `${String(row.adults).padStart(2)}a ${String(row.prime).padStart(2)}p  ` +
        `${String(row.males).padStart(2)}M ${String(row.females).padStart(2)}F`);
    return ['```', `${pad('SPECIES', NAME_WIDTH)} ${pad('SHARE', BAR_WIDTH)} ON  AD  PR   M   F`,
        ...lines, '```'].join('\n');
}
export function buildPopulationEmbed(players, options = {}) {
    const rows = tally(players);
    const totals = rows.reduce((acc, row) => ({
        online: acc.online + row.online,
        adults: acc.adults + row.adults,
        prime: acc.prime + row.prime,
    }), { online: 0, adults: 0, prime: 0 });
    const embed = new EmbedBuilder().setTitle(`🦕  ${SERVER} right now`);
    // Timestamps only render in a description, never in a footer, so the
    // "as of" line has to live in the body.
    const stamp = `<t:${Math.floor(Date.now() / 1000)}:R>`;
    const updated = options.live
        ? `\n\nUpdated ${stamp} · refreshes every minute`
        : `\n\nAs of ${stamp}`;
    if (options.unreachable) {
        return embed
            .setColor(0xed4245)
            .setDescription(`${SERVER} is not responding — it may be restarting.${updated}`)
            .setFooter({ text: SIGNATURE });
    }
    if (totals.online === 0) {
        return embed
            .setColor(0x4f545c)
            .setDescription(`The island is quiet. Nobody is playing a dinosaur right now.${updated}`)
            .setFooter({ text: SIGNATURE });
    }
    // A very long table would blow the 4096-character description limit, so the
    // tail is trimmed rather than rejected outright by the API.
    const shown = rows.slice(0, 20);
    const hidden = rows.length - shown.length;
    embed
        .setColor(0x5865f2)
        .setDescription(`**${totals.online}** playing · **${totals.adults}** adult · ` +
        `**${totals.prime}** prime (${percent(totals.prime, totals.adults)} of adults) · ` +
        `**${rows.length}** species\n` +
        table(shown, totals.online) +
        (hidden > 0 ? `\n…and ${hidden} more species` : '') +
        updated)
        .setFooter({
        text: `AD = adults · PR = prime · large species mature at 50% growth, the rest at 75%\n${SIGNATURE}`,
    });
    return embed;
}
//# sourceMappingURL=population.js.map