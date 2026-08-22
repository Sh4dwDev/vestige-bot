import { EmbedBuilder } from 'discord.js';
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
export declare const CONDITION_LABELS: Record<number, string>;
export declare const CONDITION_COUNT = 10;
export interface Condition {
    index: number;
    met: boolean;
    label: string | null;
}
export declare function conditionsOf(state: PrimeState): Condition[];
export declare function buildPrimeEmbed(state: PrimeState, ctx: Ctx): EmbedBuilder;
/** The raw flags, for working out what they mean. */
export declare function buildPrimeDebugEmbed(state: PrimeState, who: string): EmbedBuilder;
