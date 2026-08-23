import type { Ctx } from './commands.js';
export declare function parsePlayables(raw: string): string[];
export declare function speciesList(ctx: Ctx): Promise<string[]>;
/** Cached by AdminStore, which re-reads Game.ini every minute anyway. */
export declare function mutationList(ctx: Ctx): string[];
/**
 * Discord allows 25 autocomplete choices. Matches anywhere in the name, not
 * just the start — people search for "digestion", not "efficient".
 */
export declare function suggest(options: string[], typed: string): string[];
/**
 * Every species the server has ever offered, not just the ones it offers now.
 *
 * `speciesList` reads the live spawn menu, and a capped species is missing from
 * it **by design** — so asking the menu "does this species exist" answers no
 * for exactly the species somebody is trying to manage. That made a Rex cap
 * impossible to raise once it had taken effect, and made the cap list report
 * the Rex row as a typo.
 *
 * The roster only grows, so it keeps answering yes.
 */
export declare function knownSpecies(ctx: Ctx): Promise<string[]>;
