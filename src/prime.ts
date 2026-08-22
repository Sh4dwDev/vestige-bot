import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { PrimeState } from './bridge.js';
import type { Ctx } from './commands.js';

/**
 * What a player still needs for Prime.
 *
 * The engine keeps ten booleans, `bPrimeCondition1` to `bPrimeCondition10`, and
 * recomputes eligibility from them. The mod already carries all ten through
 * store and restore, so reading them costs nothing new.
 *
 * **What each one means is not documented anywhere**, and this deliberately
 * does not guess. An unmapped condition is shown by number and said to be
 * unknown, because a panel that confidently tells somebody to drink when the
 * flag actually meant "stay alive longer" is worse than one that admits it does
 * not know — they will act on it, fail, and stop trusting the whole thing.
 *
 * Labels are filled in as they are **verified**: change one thing in game, read
 * the flags, see which moved. `/admin prime` prints the raw flags alongside the
 * vitals for exactly that.
 */

/**
 * Confirmed meanings, by condition number.
 *
 * Empty on purpose. Nothing goes in here that has not been watched changing in
 * game, and each entry should say how it was confirmed when it is added.
 */
export const CONDITION_LABELS: Record<number, string> = {};

export const CONDITION_COUNT = 10;

export interface Condition {
  index: number;
  met: boolean;
  label: string | null;
}

export function conditionsOf(state: PrimeState): Condition[] {
  return Object.entries(state.conditions)
    .map(([key, met]) => ({
      index: Number.parseInt(key, 10),
      met,
      label: CONDITION_LABELS[Number.parseInt(key, 10)] ?? null,
    }))
    .filter((c) => Number.isFinite(c.index))
    .sort((a, b) => a.index - b.index);
}

const describe = (c: Condition): string =>
  (c.label ?? `Condition ${c.index} _(not yet identified)_`);

/** Percentages read better than the raw floats the engine keeps. */
const pct = (value: number, of = 1): string => `${Math.round((value / of) * 100)}%`;

export function buildPrimeEmbed(state: PrimeState, ctx: Ctx): EmbedBuilder {
  const conditions = conditionsOf(state);
  const met = conditions.filter((c) => c.met);
  const missing = conditions.filter((c) => !c.met);
  const named = missing.filter((c) => c.label !== null);
  const unnamed = missing.length - named.length;

  const embed = new EmbedBuilder()
    .setColor(state.eligible ? 0xfee75c : 0x5865f2)
    .setTitle(state.eligible ? '👑  You are Prime' : '👑  Prime progress')
    .setFooter({ text: SIGNATURE });

  if (state.eligible) {
    return embed.setDescription(
      `Every condition is met — you are eligible for Prime on ${SERVER}.\n\n` +
      `**${met.length} of ${conditions.length}** conditions met.`,
    );
  }

  embed.setDescription(
    `**${met.length} of ${conditions.length}** conditions met. ` +
    `**${missing.length}** still to go.`,
  );

  embed.addFields({
    name: `❌  Still missing (${missing.length})`,
    value: missing.length === 0
      ? '_Nothing — the game should tip you over shortly._'
      : missing.map((c) => `• ${describe(c)}`).join('\n'),
  });

  // The vitals are what most of the conditions will turn out to depend on, and
  // they are useful on their own while the mapping is incomplete.
  embed.addFields({
    name: '📊  Where you are now',
    value:
      `• Growth **${pct(state.growth)}**\n` +
      `• Health **${state.maxHealth > 0 ? pct(state.health, state.maxHealth) : '?'}**\n` +
      `• Hunger **${Math.round(state.hunger)}**  ·  Thirst **${Math.round(state.thirst)}**  ` +
      `·  Stamina **${Math.round(state.stamina)}**`,
  });

  if (unnamed > 0) {
    embed.addFields({
      name: 'Why some are unnamed',
      value:
        `The game exposes these as ten unlabelled flags, and **${unnamed}** of ` +
        'the ones you are missing have not been identified yet. They are being ' +
        'worked out by testing rather than guessed, so the names here are ones ' +
        'that have actually been confirmed.',
    });
  }

  void ctx;
  return embed;
}

/** The raw flags, for working out what they mean. */
export function buildPrimeDebugEmbed(state: PrimeState, who: string): EmbedBuilder {
  const conditions = conditionsOf(state);

  return new EmbedBuilder()
    .setColor(0x4f545c)
    .setTitle('🔬  Raw prime flags')
    .setDescription(
      `For ${who}. Change one thing in game, run this again, and see which ` +
      'flag moved — that is how a condition gets a name it deserves.',
    )
    .addFields(
      {
        name: 'Conditions',
        value: conditions.length === 0
          ? '_The pawn exposed none._'
          : conditions.map((c) =>
            `\`${String(c.index).padStart(2)}\` ${c.met ? '✅' : '❌'}` +
            `${c.label ? `  ${c.label}` : ''}`).join('\n'),
      },
      {
        name: 'Vitals',
        value:
          `\`growth   \` ${state.growth.toFixed(4)}\n` +
          `\`health   \` ${state.health.toFixed(1)} / ${state.maxHealth.toFixed(1)}\n` +
          `\`stamina  \` ${state.stamina.toFixed(1)}\n` +
          `\`hunger   \` ${state.hunger.toFixed(1)}\n` +
          `\`thirst   \` ${state.thirst.toFixed(1)}\n` +
          `\`eligible \` ${state.eligible}`,
      },
    )
    .setFooter({ text: SIGNATURE });
}
