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
 * ## Why these names can be trusted
 *
 * The flags are unlabelled, so the names below come from a published guide —
 * and were then **checked against three live animals** before being written
 * here, because a guide's list order need not match the engine's index:
 *
 * | seen                     | flags true | agrees with |
 * |--------------------------|------------|-------------|
 * | Beipiaosaurus            | 8, 10      | 10 is the small-species passive, and a Beipi is one |
 * | Allosaurus, grown wild   | 7, 8       | not a small species, so 10 is false |
 * | Carnotaurus, bought      | 7, 8       | same again |
 *
 * The three passives — 7, 8 and 10 — are the only ones true by default, and
 * that is exactly the pattern observed. 7 and 8 were true on every animal;
 * 10 only on the Beipi.
 *
 * **Condition 1 was then confirmed directly**: a player walked into a Sanctuary
 * as a juvenile and flag 1 flipped false to true while nothing else moved. That
 * is the strongest kind of evidence here — a deliberate change to one input
 * producing one change in the output.
 *
 * The remaining six active conditions follow from the same list and the same
 * ordering, but have not been individually watched, because confirming one
 * means raising a nest or crossing four Patrol zones. If a player reports one
 * of those reading wrongly, believe them over this table.
 */
export interface Condition {
    index: number;
    met: boolean;
    label: string;
    /** Passive conditions are held by default and lost, rather than earned. */
    passive: boolean;
    /** What to do about it, for the ones somebody can still act on. */
    hint?: string;
}
/**
 * Prime is **5 of 10**, not all ten — and 4 for the small species.
 *
 * The panel used to say "8 still to go", which was wrong in the way that
 * matters: it told people the thing was hopeless when they were two conditions
 * from having it.
 *
 * Which species count as small is not hardcoded. Condition 10 *is* that
 * question, already answered by the game, so it is read rather than guessed.
 */
export declare const conditionsNeeded: (state: PrimeState) => number;
/** Everything has to be met before this, after which the window has closed. */
export declare const PRIME_DEADLINE_GROWTH = 0.75;
export declare function conditionsOf(state: PrimeState): Condition[];
export declare function buildPrimeEmbed(state: PrimeState, ctx: Ctx): EmbedBuilder;
/** The raw flags, for checking the table above against a live animal. */
export declare function buildPrimeDebugEmbed(state: PrimeState, who: string): EmbedBuilder;
