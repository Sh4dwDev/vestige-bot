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
