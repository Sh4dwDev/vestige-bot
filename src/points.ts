import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';

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

export function ratePerHour(ctx: Ctx): number {
  const raw = Number.parseFloat(ctx.db.getSetting(RATE_KEY) ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RATE_PER_HOUR;
}

export function setRatePerHour(ctx: Ctx, rate: number): void {
  ctx.db.setSetting(RATE_KEY, String(rate));
}

/**
 * How much to pay for a gap of `elapsedMs`, and how many minutes that counts
 * as. Pure, because the capping rule is the part worth testing.
 */
export function awardFor(
  elapsedMs: number,
  rate: number,
): { points: number; minutes: number } {
  const minutes = Math.min(MAX_MINUTES_PER_AWARD, Math.max(0, elapsedMs / 60_000));
  return { points: (minutes / 60) * rate, minutes: Math.round(minutes) };
}

/** Called from the minute poll, which already knows who is online. */
export function awardOnline(ctx: Ctx, steamIds: string[], elapsedMs: number): number {
  const { points, minutes } = awardFor(elapsedMs, ratePerHour(ctx));
  if (points <= 0 || steamIds.length === 0) return 0;

  ctx.db.awardOnline(steamIds, points, minutes);
  return points;
}

// ------------------------------------------------------------------ embeds --

const hours = (minutes: number): string =>
  minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

/** Floored: showing 41.7 points invites arguments about rounding. */
export const display = (balance: number): number => Math.floor(balance);

export function buildBalanceEmbed(
  balance: number,
  minutes: number,
  rate: number,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🪙  Your points')
    .setDescription(
      `## ${display(balance).toLocaleString()}\n` +
      `Earned over **${hours(minutes)}** on ${SERVER}.\n\n` +
      `You earn **${rate}** points an hour just by playing. ` +
      'There is nothing to spend them on yet — that comes later.',
    )
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

export function buildLeaderboardEmbed(
  rows: Array<{ steamId: string; balance: number; minutes: number }>,
  nameFor: (steamId: string) => string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('🏆  Most points on ' + SERVER)
    .setFooter({ text: SIGNATURE })
    .setTimestamp();

  if (rows.length === 0) {
    return embed.setDescription('Nobody has earned anything yet.');
  }

  const medal = ['🥇', '🥈', '🥉'];
  embed.setDescription(
    rows
      .map((row, n) =>
        `${medal[n] ?? `\`${String(n + 1).padStart(2)}\``} **${display(row.balance).toLocaleString()}** ` +
        `· ${nameFor(row.steamId)} · ${hours(row.minutes)} played`)
      .join('\n'),
  );

  return embed;
}
