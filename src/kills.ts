import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import { rankIcon } from './ranks.js';

/**
 * The kill feed and leaderboard.
 *
 * Attribution is partial and always will be in Lua: `ApplyDamage` only fires on
 * a direct player attack, so bleed, starvation, drowning, falls and AI produce
 * a real death with no killer. Rather than hide those, the feed shows them as
 * deaths and the leaderboard footer says how many are unattributed — otherwise
 * the numbers look broken to anyone who counts.
 */

const CHANNEL_KEY = 'killfeed_channel';

export function setKillfeedChannel(ctx: Ctx, channelId: string | null): void {
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
}

export function killfeedChannel(ctx: Ctx): string | null {
  return ctx.db.getSetting(CHANNEL_KEY) || null;
}

export interface KillEvent {
  killer: string;
  /** What the killer was playing when they landed the hit. */
  killerSpecies: string;
  victim: string;
  species: string;
  /** The creature that did it, when the attacker was AI rather than a player. */
  killerAI?: string;
  cause: string;
}

/** How a death with no attacker is described, by what the mod could tell. */
const CAUSE_TEXT: Record<string, string> = {
  health: 'died',
  killed: 'was killed',
};

export function buildKillEmbed(
  event: KillEvent,
  nameFor: (steamId: string) => string,
): EmbedBuilder {
  // Species in brackets, omitted entirely when unknown — empty brackets look
  // like a bug.
  const withSpecies = (steamId: string, species: string): string =>
    `${nameFor(steamId)}${species ? ` *(${species})*` : ''}`;

  const victim = withSpecies(event.victim, event.species);

  if (event.killer) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setDescription(
        `⚔️  ${withSpecies(event.killer, event.killerSpecies)}  **killed**  ${victim}`,
      )
      .setTimestamp();
  }

  // Killed by wildlife. Grey rather than red: it is not a player kill, and the
  // colour is what tells the channel apart at a glance. Naming the animal is
  // the whole point — "died" told somebody nothing about what ate them.
  if (event.killerAI) {
    return new EmbedBuilder()
      .setColor(0x4f545c)
      .setDescription(`💀  ${victim}  was killed by a  **${event.killerAI}**`)
      .setTimestamp();
  }

  return new EmbedBuilder()
    .setColor(0x4f545c)
    .setDescription(`💀  ${victim} ${CAUSE_TEXT[event.cause] ?? 'died'}`)
    .setTimestamp();
}

export function buildKillsEmbed(
  rows: Array<{ steamId: string; kills: number }>,
  totals: { total: number; attributed: number },
  nameFor: (steamId: string) => string,
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`⚔️  Deadliest on ${SERVER}`)
    .setTimestamp();

  if (rows.length === 0) {
    return embed
      .setDescription('No kills recorded yet.')
      .setFooter({ text: SIGNATURE });
  }

  embed.setDescription(
    rows
      .map((row, n) => `${rankIcon(n)}  **${row.kills}** · ${nameFor(row.steamId)}`)
      .join('\n'),
  );

  // Stated plainly, because someone will add the columns up and find a gap.
  const unattributed = totals.total - totals.attributed;
  embed.setFooter({
    text:
      `${totals.attributed} of ${totals.total} deaths had an attacker · ` +
      `${unattributed} were bleed, starvation, AI or falls\n${SIGNATURE}`,
  });

  return embed;
}
