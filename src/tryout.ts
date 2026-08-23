import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';

/**
 * Letting one admin spawn a species without offering it to everybody.
 *
 * A live dinosaur's species **cannot be changed**. `RequestRespawn` crashes
 * from Lua, so the mod can never create or replace a pawn — the only way a new
 * dinosaur exists is the player respawning through the game's own menu, and the
 * mod then mutates whatever the game made. That is why storing kills you and
 * why restore is same-species only (docs/NOTES.md).
 *
 * So the species has to be in the menu at the moment of spawning. The trick is
 * making that moment as short as possible: it is added, and taken away again
 * the instant the admin is seen playing it. A window measured in seconds is not
 * secrecy, but it is the difference between "briefly available while somebody
 * tested it" and "on the menu until someone notices".
 *
 * **Deliberately never added to the species roster.** The roster is what
 * enforcement re-adds from, so recording it here would have the cap system
 * helpfully putting it back a minute later and undoing the whole thing.
 */

const KEY = 'tryout_state';

/** Long enough to pick from the menu and load in, short enough to be a window. */
const DEFAULT_TIMEOUT_MS = 3 * 60_000;

export interface Tryout {
  species: string;
  steamId: string;
  until: number;
}

export function activeTryout(ctx: Ctx): Tryout | null {
  const raw = ctx.db.getSetting(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Tryout>;
    return typeof parsed.species === 'string' && typeof parsed.until === 'number'
      ? (parsed as Tryout)
      : null;
  } catch {
    return null;
  }
}

export const saveTryout = (ctx: Ctx, tryout: Tryout | null): void =>
  ctx.db.setSetting(KEY, tryout ? JSON.stringify(tryout) : '');

export const startTryout = (ctx: Ctx, species: string, steamId: string): Tryout => {
  const tryout: Tryout = { species, steamId, until: Date.now() + DEFAULT_TIMEOUT_MS };
  saveTryout(ctx, tryout);
  return tryout;
};

export type TryoutEnd = 'spawned' | 'timeout' | null;

/**
 * Whether the window should close, and why.
 *
 * Pure, so both endings can be tested without a server: the admin got what they
 * came for, or they did not and it must close anyway. Leaving it open because
 * somebody wandered off is how a hidden species quietly becomes a public one.
 */
export function tryoutEnded(
  tryout: Tryout,
  players: PlayerRow[],
  now: number,
): TryoutEnd {
  const spawned = players.some((p) =>
    p.steam === tryout.steamId
    && p.species.toLowerCase() === tryout.species.toLowerCase());

  if (spawned) return 'spawned';
  return now >= tryout.until ? 'timeout' : null;
}

/**
 * Closes the window when it is due, taking the species back off the menu.
 *
 * Returns what happened, or null while it is still open.
 */
export async function advanceTryout(
  ctx: Ctx,
  players: PlayerRow[],
  log: (m: string) => void,
): Promise<TryoutEnd> {
  const tryout = activeTryout(ctx);
  if (!tryout) return null;

  const ended = tryoutEnded(tryout, players, Date.now());
  if (!ended) return null;

  // Cleared first. If the removal fails, retrying it every few seconds forever
  // is worse than leaving it and saying so once.
  saveTryout(ctx, null);

  try {
    await ctx.rcon.removePlayable(tryout.species);
    log(`tryout: ${tryout.species} taken back off the menu (${ended})`);
  } catch (err) {
    log(`tryout: COULD NOT REMOVE ${tryout.species} — ${
      err instanceof Error ? err.message : String(err)}. `
      + 'It is still in the spawn menu; use /admin species unlock to manage it.');
  }

  return ended;
}
