import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import { MAX_SLOTS } from './bridge.js';
import type { Ctx } from './commands.js';
import { display } from './points.js';

/**
 * One player's own record: everything the bot knows about them in one place.
 *
 * It exists because the answer to "how am I doing" was four separate buttons
 * and a slash command, and none of them showed storage or how long somebody had
 * been here.
 *
 * **Only ever your own.** Points balances are private, and a profile command
 * that took a user option would quietly make every balance on the server
 * readable by anybody who asked.
 *
 * The first version was a correct and completely flat table of numbers. What
 * makes a record worth opening twice is standing and contents: where you are
 * against everybody else, how far the next place is, and *what* is in your
 * vault rather than how many things are. All of that was already being fetched
 * and thrown away.
 */

export interface StoredAnimal {
  slot: string;
  species: string;
}

export interface ProfileData {
  /** Their name in game, when the bot has seen one. */
  name: string | null;
  steamId: string;
  /** Their Discord avatar, used as the embed thumbnail. */
  avatarUrl?: string;
  points: number;
  rank: number;
  players: number;
  /** Points held by the player one place above, or null at the top. */
  above: number | null;
  /** Points held by the player one place below, or null at the bottom. */
  below: number | null;
  minutes: number;
  kills: number;
  deaths: number;
  skins: string[];
  /** Null when the game server would not answer, which is not the same as none. */
  stored: StoredAnimal[] | null;
  maxSlots: number;
  /** ISO 8601, or null if the bot never caught them arriving. */
  firstSeen: string | null;
  referrals: number;
}

/** 5312 becomes "88h". Under an hour stays in minutes, so a new player sees movement. */
export function playtime(minutes: number): string {
  const whole = Math.floor(minutes);
  if (whole < 60) return `${whole}m`;
  return `${Math.floor(whole / 60)}h`;
}

/**
 * Kills per death, to one decimal.
 *
 * Deaths of zero is not an error and not infinity: somebody who has killed
 * three things and died to none has a ratio of 3, which is what they would say
 * themselves.
 */
export function ratio(kills: number, deaths: number): string {
  if (deaths === 0) return kills === 0 ? '0.0' : kills.toFixed(1);
  return (kills / deaths).toFixed(1);
}

const money = (n: number): string => Math.floor(n).toLocaleString('en-GB');

/** 1st, 2nd, 3rd, 4th. Ranks are read aloud, and "1 of 30" is not how anybody says it. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  return `${n}${ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th'}`;
}

/** Top three get a medal; everybody else gets the plain badge. */
const MEDALS: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
export const medalFor = (rank: number): string => MEDALS[rank] ?? '📇';

/**
 * Gold, silver and bronze for the top three, the house colour otherwise.
 *
 * The colour is the first thing read, before any number, so it should say the
 * one thing that matters most about the card.
 */
export function colourFor(rank: number): number {
  if (rank === 1) return 0xd6a03a;
  if (rank === 2) return 0xb9c0c8;
  if (rank === 3) return 0xa9713f;
  return 0x6f6857;
}

/**
 * The line under the rank.
 *
 * A rank on its own is a fact; a gap is a reason to play. Leaders are told what
 * they are defending, everybody else what they are chasing.
 */
export function standing(data: ProfileData): string {
  if (data.players <= 1) return 'The only one on the board so far';

  if (data.rank === 1) {
    return data.below === null
      ? `Top of ${data.players}`
      : `Top of ${data.players}, leading by ${money(data.points - data.below)}`;
  }

  const gap = data.above === null ? 0 : Math.ceil(data.above - data.points) + 1;
  return `${ordinal(data.rank)} of ${data.players} · ${money(gap)} behind ${ordinal(data.rank - 1)}`;
}

/**
 * Reads everything for one player.
 *
 * The database parts are immediate. The stored animals are the only thing that
 * needs the game server, and that call is allowed to fail: a profile that
 * refuses to load because the server is restarting is worse than one that
 * admits it does not know what is in the vault.
 */
export async function gatherProfile(
  ctx: Ctx,
  discordId: string,
  steamId: string,
  avatarUrl?: string,
): Promise<ProfileData> {
  const { balance, minutes } = ctx.db.pointsFor(steamId);
  const { rank, of, above, below } = ctx.db.pointsRank(steamId);
  const { kills, deaths } = ctx.db.killStats(steamId);

  // The same call that used to be counted and discarded. It already carries the
  // species, which is the interesting half.
  const stored = await ctx.mod
    .run('list', steamId, {}, { quiet: true })
    .then((r) => (r.ok && Array.isArray(r.data)
      ? r.data
        .map((row) => ({
          slot: String((row as { slot?: unknown }).slot ?? ''),
          species: String((row as { species?: unknown }).species ?? 'Unknown'),
        }))
        .filter((row) => row.slot !== '')
      : null))
    .catch(() => null);

  return {
    name: ctx.db.gameName(steamId),
    steamId,
    ...(avatarUrl ? { avatarUrl } : {}),
    points: display(balance),
    rank,
    players: of,
    above,
    below,
    minutes,
    kills,
    deaths,
    skins: ctx.db.ownedSkins(steamId).map((s) => s.preset),
    stored,
    maxSlots: MAX_SLOTS,
    firstSeen: ctx.db.firstSeen(steamId),
    // Since the beginning: a profile is a lifetime record, not a season one.
    referrals: ctx.db.paidReferralsSince(discordId, new Date(0)),
  };
}

/** Pure, so the wording and the awkward cases can be tested without a server. */
export function buildProfileEmbed(data: ProfileData): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(colourFor(data.rank))
    .setTitle(`${medalFor(data.rank)}  ${data.name ?? 'Your profile'}`)
    .setFooter({ text: SIGNATURE })
    .setTimestamp();

  if (data.avatarUrl) embed.setThumbnail(data.avatarUrl);

  const since: string[] = [];
  if (data.firstSeen) {
    const seen = Date.parse(data.firstSeen);
    if (Number.isFinite(seen)) since.push(`Here since <t:${Math.floor(seen / 1000)}:D>`);
  }
  if (data.referrals > 0) {
    since.push(`brought **${data.referrals}** player${data.referrals === 1 ? '' : 's'}`);
  }

  embed.setDescription(since.length > 0
    ? since.join(' · ')
    : `Your record on ${SERVER}. Only you can see this.`);

  embed.addFields(
    {
      name: '🪙  Points',
      value: `**${money(data.points)}**\n-# ${standing(data)}`,
      inline: true,
    },
    {
      name: '⏱️  Played',
      value: `**${playtime(data.minutes)}**`,
      inline: true,
    },
    {
      name: '⚔️  Kills',
      value: `**${money(data.kills)}**\n-# ${money(data.deaths)} death`
        + `${data.deaths === 1 ? '' : 's'} · ${ratio(data.kills, data.deaths)} each`,
      inline: true,
    },
  );

  embed.addFields({ name: '📦  Storage', value: storageLine(data), inline: false });

  if (data.skins.length > 0) {
    // Capped: somebody with thirty skins would push everything else off screen.
    const shown = data.skins.slice(0, 8);
    embed.addFields({
      name: `🎨  Skins owned (${data.skins.length})`,
      value: shown.map((s) => `\`${s}\``).join(' ')
        + (data.skins.length > shown.length ? ` and ${data.skins.length - shown.length} more` : ''),
      inline: false,
    });
  }

  return embed;
}

/**
 * What is actually in the vault, not how much of it there is.
 *
 * "3 of 3 slots used" tells somebody something they already knew. The species
 * are what they opened the card to see, and they cost nothing extra to show.
 */
function storageLine(data: ProfileData): string {
  if (data.stored === null) {
    // Said plainly. An empty vault and an unreachable server look identical
    // otherwise, and one of those reads as "my dinosaurs are gone".
    return 'The game server did not answer, so this could not be read. Nothing is lost.';
  }

  const used = data.stored.length;
  const bar = '▰'.repeat(used) + '▱'.repeat(Math.max(0, data.maxSlots - used));

  if (used === 0) return `${bar}  empty\n-# Store a fully grown animal in game and it shows up here.`;

  return `${bar}  **${used}** of ${data.maxSlots}\n`
    + data.stored.map((a) => `-# \`${a.slot}\`  ${a.species}`).join('\n');
}
