import { EmbedBuilder, type Client } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import { weekKey } from './db.js';
import { medalFor, ordinal } from './profile.js';

/**
 * A leaderboard that starts again every week.
 *
 * The lifetime board is settled. Somebody thirty thousand points ahead will
 * still be ahead next month, so for everybody below the top it is a scoreboard
 * they cannot affect, which is the same as no scoreboard at all. A week is
 * short enough that a good few evenings wins it.
 *
 * **It counts what you earned, not what you hold.** Resetting balances would
 * wipe everybody's savings every Monday, and the balance is the currency the
 * shop and the market run on. Earnings are counted separately, in
 * `weekly_points`, and spending never reduces them.
 */

const ENABLED_KEY = 'weekly_enabled';
const CHANNEL_KEY = 'weekly_channel';
const SKIN_KEY = 'weekly_skin';
/** The week the bot last closed out, so a restart cannot pay twice. */
const CLOSED_KEY = 'weekly_closed';

/** How many are paid when a week ends. */
export const PODIUM = 3;

export const weeklyEnabled = (ctx: Ctx): boolean => ctx.db.getSetting(ENABLED_KEY) === '1';

export const setWeeklyEnabled = (ctx: Ctx, on: boolean): void =>
  ctx.db.setSetting(ENABLED_KEY, on ? '1' : '0');

export const weeklyChannel = (ctx: Ctx): string | null => ctx.db.getSetting(CHANNEL_KEY) || null;

export const setWeeklyChannel = (ctx: Ctx, channelId: string | null): void =>
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');

export const weeklySkin = (ctx: Ctx): string | null => ctx.db.getSetting(SKIN_KEY) || null;

export const setWeeklySkin = (ctx: Ctx, preset: string | null): void =>
  ctx.db.setSetting(SKIN_KEY, preset ?? '');

export interface WeeklyRow {
  steamId: string;
  points: number;
}

export function buildWeeklyEmbed(
  week: string,
  rows: WeeklyRow[],
  nameFor: (steamId: string) => string,
  options: { final?: boolean; skin?: string | null } = {},
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(options.final ? 0xd6a03a : 0x6f6857)
    .setTitle(options.final ? `🏆  ${week} is over` : `🏆  This week on ${SERVER}`)
    .setFooter({ text: SIGNATURE })
    .setTimestamp();

  if (rows.length === 0) {
    embed.setDescription('Nobody has earned anything yet this week. It is wide open.');
    return embed;
  }

  embed.setDescription(rows
    .map((row, index) => {
      const place = index + 1;
      const badge = place <= PODIUM ? medalFor(place) : `-# ${ordinal(place)}`;
      return `${badge} **${nameFor(row.steamId)}** · ${Math.floor(row.points).toLocaleString('en-GB')}`;
    })
    .join('\n'));

  if (options.final && options.skin) {
    embed.addFields({
      name: 'Prize',
      value: `The top ${PODIUM} keep the **${options.skin}** skin.`,
    });
  }

  if (!options.final) {
    embed.addFields({
      name: 'How it works',
      value: 'Only points **earned this week** count, so spending does not push you '
        + 'down. It starts again on Monday.',
    });
  }

  return embed;
}

export interface WeekClosed {
  week: string;
  winners: WeeklyRow[];
  skin: string | null;
}

/**
 * Ends a week: pays the podium, announces, and remembers it is done.
 *
 * Recording the week as closed **before** granting anything is deliberate. If
 * the grant half fails the worst case is somebody missing a skin, which is a
 * message away from fixed; the other order risks a restart mid-close paying the
 * same podium twice, and taking a prize back is far worse than handing one out.
 */
export async function closeWeek(
  ctx: Ctx,
  client: Client,
  week: string,
  log: (m: string) => void,
): Promise<WeekClosed | null> {
  if (ctx.db.getSetting(CLOSED_KEY) === week) return null;
  ctx.db.setSetting(CLOSED_KEY, week);

  const winners = ctx.db.weeklyTop(week, PODIUM);
  if (winners.length === 0) {
    log(`weekly: ${week} ended with nobody on the board`);
    return { week, winners, skin: null };
  }

  const skin = weeklySkin(ctx);
  if (skin) {
    for (const row of winners) {
      ctx.db.grantSkin(row.steamId, skin, `Top ${PODIUM} in ${week}`);
    }
  }

  log(`weekly: ${week} ended, ${winners.length} paid`);

  const channelId = weeklyChannel(ctx);
  if (channelId) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && 'send' in channel) {
      const board = ctx.db.weeklyTop(week, 10);
      await channel
        .send({
          embeds: [buildWeeklyEmbed(week, board, nameFor(ctx), { final: true, skin })],
        })
        .catch(() => undefined);
    }
  }

  return { week, winners, skin };
}

/** Falls back to the Steam ID, which is at least unambiguous. */
const nameFor = (ctx: Ctx) => (steamId: string): string =>
  ctx.db.gameName(steamId) ?? steamId;

/**
 * Called from the minute tick. Closes the previous week the first time the
 * clock says a new one has started.
 *
 * The week that just ended is derived by looking back a few days rather than
 * from anything stored, so a bot that was switched off over the weekend still
 * closes the right week when it comes back.
 */
export async function runWeekly(
  ctx: Ctx,
  client: Client,
  log: (m: string) => void,
  at = new Date(),
): Promise<void> {
  if (!weeklyEnabled(ctx)) return;

  const current = weekKey(at);
  const previous = weekKey(new Date(at.getTime() - (3 * 86_400_000)));
  if (previous === current) return;

  await closeWeek(ctx, client, previous, log);
}
