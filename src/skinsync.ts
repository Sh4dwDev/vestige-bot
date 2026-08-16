import type { Ctx } from './commands.js';
import type { PlayerRow } from './bridge.js';
import { encodeColours } from './skins.js';

/**
 * Makes skins stick.
 *
 * The engine genuinely does not persist them — upstream is explicit that
 * direct-write colours are runtime state and revert on relog. What it also says
 * is that a mod is expected to store them and reapply, which is what this does.
 * The colours are the record; the pawn is just where they get painted.
 *
 * Reapplied on three events, which is every way a pawn can be replaced:
 *
 *   * they appear online having not been there last poll (relog, or a restart)
 *   * they die, since respawning builds a fresh pawn
 *   * the bot starts up, because it cannot know what happened while it was down
 *
 * Deliberately not reapplied every poll: that would be a write per player per
 * minute forever, to fix something that only breaks on those three events.
 */

/**
 * Which pawn we have already painted, as `steam|species`.
 *
 * The species is part of the key because switching species is exactly the case
 * that must trigger a repaint — otherwise a Rex's colours would be considered
 * "already applied" while the player is on a Dryosaurus.
 */
const painted = new Set<string>();

const key = (steamId: string, species: string): string => `${steamId}|${species}`;

/** Called when a pawn is replaced, so the next poll repaints it. */
export function skinNeedsReapply(steamId: string): void {
  for (const entry of painted) {
    if (entry.startsWith(`${steamId}|`)) painted.delete(entry);
  }
}

export function forgetPainted(steamId: string): void {
  skinNeedsReapply(steamId);
}

export async function reapplySkins(
  ctx: Ctx,
  players: PlayerRow[],
  log: (m: string) => void,
): Promise<void> {
  const live = new Set(
    players
      .filter((p) => p.steam)
      .map((p) => key(p.steam as string, p.species)),
  );

  // Anyone no longer on that pawn needs repainting if they return to it.
  for (const entry of painted) {
    if (!live.has(entry)) painted.delete(entry);
  }

  for (const player of players) {
    if (!player.steam) continue;

    const entry = key(player.steam, player.species);
    if (painted.has(entry)) continue;

    const colours = ctx.db.skinFor(player.steam, player.species);
    if (!colours || Object.keys(colours).length === 0) {
      // Nothing owed for this species. Mark it so it is not re-checked every
      // minute — and note this is per species, so their Rex colours are not
      // considered "applied" while they are on something else.
      painted.add(entry);
      continue;
    }

    try {
      const result = await ctx.mod.run(
        'skinmany',
        player.steam,
        { colors: encodeColours(colours) },
        { quiet: true },
      );
      if (result.ok) {
        painted.add(entry);
        log(`skin: reapplied ${Object.keys(colours).length} colour(s) ` +
          `to ${player.steam} (${player.species})`);
      }
      // On failure, leave it unpainted so the next poll tries again.
    } catch {
      // Server unreachable; try again next poll.
    }
  }
}
