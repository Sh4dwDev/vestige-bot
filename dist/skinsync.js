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
 * A look belongs to a **dinosaur**, not to the player. Dying clears the stored
 * colours (see the kill handler in index.ts), so the next one spawns in the
 * game's own colours rather than inheriting a skin set weeks ago. Storing does
 * not count as dying, so a stored dinosaur keeps what it was painted.
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
const painted = new Set();
const key = (steamId, species) => `${steamId}|${species}`;
/** Called when a pawn is replaced, so the next poll repaints it. */
export function skinNeedsReapply(steamId) {
    for (const entry of painted) {
        if (entry.startsWith(`${steamId}|`))
            painted.delete(entry);
    }
}
export function forgetPainted(steamId) {
    skinNeedsReapply(steamId);
}
/**
 * Forget everything, so the next pass repaints regardless.
 *
 * Called when the server has been unreachable: a restart gives everyone a new
 * pawn, but the bot never sees them leave — the poll simply fails — so without
 * this it concludes they are still painted and leaves them plain. That is
 * exactly the "skins do not survive a restart" case.
 */
export function forgetAllPainted() {
    painted.clear();
}
export async function reapplySkins(ctx, players, log) {
    const live = new Set(players
        .filter((p) => p.steam)
        .map((p) => key(p.steam, p.species)));
    // Anyone no longer on that pawn needs repainting if they return to it.
    for (const entry of painted) {
        if (!live.has(entry))
            painted.delete(entry);
    }
    for (const player of players) {
        if (!player.steam)
            continue;
        const entry = key(player.steam, player.species);
        if (painted.has(entry))
            continue;
        // Sent first and on its own: an out-of-range pattern makes the client drop
        // the whole rebuild, so it must never share a write with the colours.
        const pattern = ctx.db.patternFor(player.steam, player.species);
        if (pattern !== null) {
            await ctx.mod
                .run('pattern', player.steam, { index: pattern }, { quiet: true })
                .catch(() => undefined);
        }
        const colours = ctx.db.skinFor(player.steam, player.species);
        if (!colours || Object.keys(colours).length === 0) {
            // Nothing owed for this species. Mark it so it is not re-checked every
            // minute — and note this is per species, so their Rex colours are not
            // considered "applied" while they are on something else.
            painted.add(entry);
            continue;
        }
        try {
            const result = await ctx.mod.run('skinmany', player.steam, { colors: encodeColours(colours) }, { quiet: true });
            if (result.ok) {
                painted.add(entry);
                log(`skin: reapplied ${Object.keys(colours).length} colour(s) ` +
                    `to ${player.steam} (${player.species})`);
            }
            // On failure, leave it unpainted so the next poll tries again.
        }
        catch {
            // Server unreachable; try again next poll.
        }
    }
}
//# sourceMappingURL=skinsync.js.map