import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';

/**
 * Server population, broken down by species.
 *
 * "Adult" is species-dependent — the big-bodied species mature at 50% growth
 * and the rest at 75% — so a single global threshold would misreport most of
 * the roster, and it would do it invisibly: the numbers would just be quietly
 * wrong. Prime is expressed against adults, because only adults can be prime.
 */

export interface PlayerRow {
  species: string;
  growth: number;
  female: boolean;
  prime: boolean;
}

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

export function adultThreshold(species: string): number {
  return ADULT_AT_HALF.has(species) ? 0.5 : 0.75;
}

export function isAdult(species: string, growth: number): boolean {
  return growth >= adultThreshold(species);
}

export interface SpeciesRow {
  species: string;
  online: number;
  adults: number;
  prime: number;
  males: number;
  females: number;
}

export function tally(players: PlayerRow[]): SpeciesRow[] {
  const rows = new Map<string, SpeciesRow>();

  for (const player of players) {
    let row = rows.get(player.species);
    if (!row) {
      row = { species: player.species, online: 0, adults: 0, prime: 0, males: 0, females: 0 };
      rows.set(player.species, row);
    }

    row.online += 1;
    if (player.female) row.females += 1;
    else row.males += 1;

    if (isAdult(player.species, player.growth)) {
      row.adults += 1;
      // A prime flag on a juvenile is contradictory data; ignoring it stops
      // prime ever exceeding the adult count.
      if (player.prime) row.prime += 1;
    }
  }

  return [...rows.values()].sort((a, b) => b.online - a.online || a.species.localeCompare(b.species));
}

/**
 * Only used to pick an icon. Getting one wrong is cosmetic, and an unknown
 * species falls back to the herbivore marker rather than breaking the row.
 */
const CARNIVORES = new Set([
  'Tyrannosaurus', 'Allosaurus', 'Ceratosaurus', 'Carnotaurus', 'Deinosuchus',
  'Dilophosaurus', 'Herrerasaurus', 'Omniraptor', 'Troodon', 'Baryonyx',
  'Austroraptor', 'Pteranodon', 'Beipiaosaurus',
]);

const icon = (species: string): string => (CARNIVORES.has(species) ? '🦖' : '🦕');

/** Above this, one field per species stops fitting and the table wins. */
const FIELD_LIMIT = 9;

const NAME_WIDTH = 15;
const BAR_WIDTH = 8;

const pad = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width);

/** Share of the population, as a bar. Anyone present gets at least one cell. */
function bar(part: number, whole: number): string {
  const filled = whole === 0 ? 0 : Math.max(1, Math.round((part / whole) * BAR_WIDTH));
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
}

/**
 * One aligned line per species, in a code block. Discord's inline fields reflow
 * unpredictably across window widths and phones; a fixed-width table does not,
 * and it stays readable when twenty species are on at once.
 */
function table(rows: SpeciesRow[], total: number): string {
  const lines = rows.map(
    (row) =>
      `${pad(row.species, NAME_WIDTH)} ${bar(row.online, total)} ` +
      `${String(row.online).padStart(2)}  ` +
      `${String(row.adults).padStart(2)}a ${String(row.prime).padStart(2)}p  ` +
      `${String(row.males).padStart(2)}M ${String(row.females).padStart(2)}F`,
  );
  return ['```', `${pad('SPECIES', NAME_WIDTH)} ${pad('SHARE', BAR_WIDTH)} ON  AD  PR   M   F`,
    ...lines, '```'].join('\n');
}

export interface PopulationOptions {
  /** Adds the auto-update line used by the pinned channel panel. */
  live?: boolean;
  /** Shown instead of the table when the server could not be read. */
  unreachable?: boolean;
}

export function buildPopulationEmbed(
  players: PlayerRow[],
  options: PopulationOptions = {},
): EmbedBuilder {
  const rows = tally(players);
  const totals = rows.reduce(
    (acc, row) => ({
      online: acc.online + row.online,
      adults: acc.adults + row.adults,
      prime: acc.prime + row.prime,
    }),
    { online: 0, adults: 0, prime: 0 },
  );

  // The embed's own timestamp shows freshness under the footer, so there is no
  // need for an "updated N seconds ago" line repeating it.
  const embed = new EmbedBuilder()
    .setTitle(`🦕  ${SERVER} right now`)
    .setTimestamp();

  const signature = options.live ? `Refreshes every minute · ${SIGNATURE}` : SIGNATURE;

  if (options.unreachable) {
    return embed
      .setColor(0xed4245)
      .setDescription(
        '## 🔴  Unreachable\n' +
        `${SERVER} is not responding. It is most likely restarting.`,
      )
      .setFooter({ text: signature });
  }

  if (totals.online === 0) {
    return embed
      .setColor(0x4f545c)
      .setDescription(
        '## 🌙  All quiet\n' +
        'Nobody is out there right now. The island is yours if you want it.',
      )
      .setFooter({ text: signature });
  }

  const headline =
    `**${totals.online}** playing · **${totals.adults}** adult · ` +
    `**${totals.prime}** prime · **${rows.length}** ` +
    (rows.length === 1 ? 'species' : 'species');

  embed.setColor(0x5865f2);

  // A handful of species reads far better as cards than as a one-row table,
  // which is what it looked like: mostly empty column headers. Past a certain
  // count the cards wrap badly and the dense table earns its place again.
  if (rows.length <= FIELD_LIMIT) {
    embed
      .setDescription(headline)
      .addFields(
        rows.map((row) => ({
          name: `${icon(row.species)}  ${row.species}`,
          value:
            `**${row.online}** online\n` +
            `${row.adults} adult · ${row.prime} prime\n` +
            `♂ ${row.males} · ♀ ${row.females}`,
          inline: true,
        })),
      )
      .setFooter({
        text: `Adults are 50% growth for large species, 75% for the rest\n${signature}`,
      });

    return embed;
  }

  // A very long table would blow the 4096-character description limit, so the
  // tail is trimmed rather than rejected outright by the API.
  const shown = rows.slice(0, 20);
  const hidden = rows.length - shown.length;

  embed
    .setDescription(
      headline + '\n' +
      table(shown, totals.online) +
      (hidden > 0 ? `\n…and ${hidden} more species` : ''),
    )
    .setFooter({
      text: `ON online · AD adults · PR prime · M/F male and female\n${signature}`,
    });

  return embed;
}
