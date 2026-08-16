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
/** Steam IDs whose current pawn we have already painted. */
const painted = new Set();
/** Called when a pawn is replaced, so the next poll repaints it. */
export function skinNeedsReapply(steamId) {
    painted.delete(steamId);
}
export function forgetPainted(steamId) {
    painted.delete(steamId);
}
export async function reapplySkins(ctx, players, log) {
    const online = new Set(players.map((p) => p.steam).filter((s) => Boolean(s)));
    // Anyone who left needs repainting when they come back.
    for (const steamId of painted) {
        if (!online.has(steamId))
            painted.delete(steamId);
    }
    for (const steamId of online) {
        if (painted.has(steamId))
            continue;
        const colours = ctx.db.skinFor(steamId);
        if (!colours || Object.keys(colours).length === 0) {
            // Nothing owed. Mark them so this is not re-checked every minute.
            painted.add(steamId);
            continue;
        }
        try {
            const result = await ctx.mod.run('skinmany', steamId, { colors: encodeColours(colours) }, { quiet: true });
            if (result.ok) {
                painted.add(steamId);
                log(`skin: reapplied ${Object.keys(colours).length} colour(s) to ${steamId}`);
            }
            // On failure, leave them unpainted so the next poll tries again — they
            // may simply not be spawned yet.
        }
        catch {
            // Server unreachable; try again next poll.
        }
    }
}
//# sourceMappingURL=skinsync.js.map