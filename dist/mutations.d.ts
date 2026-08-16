/**
 * What each mutation actually does, so the picker reads like the in-game list
 * rather than forty bits of Latin.
 *
 * Sourced from the Evrima Quick Guide rather than invented. Keyed loosely
 * because the stock Game.ini spells them inconsistently — "Enlarged meniscus"
 * with a small m, "Hydroregenerative" without the hyphen — so lookup strips
 * everything that is not a letter.
 */
export declare function describeMutation(name: string): string | null;
export declare function isRemoved(name: string): boolean;
/**
 * Choices for the picker, searching the description as well as the name —
 * people look for "heal", not "cellular".
 */
export declare function mutationChoices(all: string[], typed: string): Array<{
    name: string;
    value: string;
}>;
