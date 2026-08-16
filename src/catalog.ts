import type { Ctx } from './commands.js';

/**
 * What this server can actually spawn.
 *
 * Both lists come from the server itself rather than being typed out here:
 * species from RCON `getplayables`, mutations from Game.ini. A hardcoded list
 * goes stale on the next patch and then silently writes gifts nobody can
 * collect — a species string that does not match is only discovered when the
 * player tries to release it.
 */

/** Playables change only on a game update, so this is cached for a while. */
const PLAYABLES_TTL_MS = 30 * 60_000;

let playables: string[] = [];
let fetchedAt = 0;

export function parsePlayables(raw: string): string[] {
  // The reply is a log line, then one comma-separated row with a trailing comma.
  const line = raw.split('\n').find((l) => l.includes(',')) ?? '';
  return [...new Set(
    line
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z]{3,}$/.test(s)),
  )].sort((a, b) => a.localeCompare(b));
}

export async function speciesList(ctx: Ctx): Promise<string[]> {
  if (playables.length > 0 && Date.now() - fetchedAt < PLAYABLES_TTL_MS) return playables;

  try {
    const parsed = parsePlayables(await ctx.rcon.playables());
    if (parsed.length > 0) {
      playables = parsed;
      fetchedAt = Date.now();
    }
  } catch {
    // Keep whatever was cached; an empty list just means no suggestions.
  }

  return playables;
}

/** Cached by AdminStore, which re-reads Game.ini every minute anyway. */
export function mutationList(ctx: Ctx): string[] {
  return ctx.admins.mutations;
}

/**
 * Discord allows 25 autocomplete choices. Matches anywhere in the name, not
 * just the start — people search for "digestion", not "efficient".
 */
export function suggest(options: string[], typed: string): string[] {
  const needle = typed.trim().toLowerCase();
  const matches = needle
    ? options.filter((o) => o.toLowerCase().includes(needle))
    : options;
  return matches.slice(0, 25);
}
