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
/**
 * How long a look survives without being worn.
 *
 * The engine drops colours on relog, respawn and restart, so they have to be
 * stored and reapplied — but stored forever means a skin set once follows
 * somebody onto the next animal of that species days later. Expiry is the line
 * between "keep my dinosaur looking right" and "haunt me".
 *
 * Counted from the last time it was actually painted onto a live pawn, so a
 * dinosaur being played never expires under its owner. Six hours: long enough
 * to survive a restart, a crash, or a night's sleep in the middle of a session;
 * short enough that next week is a different animal.
 */
const EXPIRY_KEY = 'skin_expiry_hours';
export const DEFAULT_EXPIRY_HOURS = 6;
export function skinExpiryHours(ctx) {
    const raw = Number.parseFloat(ctx.db.getSetting(EXPIRY_KEY) ?? '');
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXPIRY_HOURS;
}
export function setSkinExpiryHours(ctx, hours) {
    ctx.db.setSetting(EXPIRY_KEY, String(hours));
}
/** Called from the poll. Returns how many were forgotten. */
export function expireOldSkins(ctx, log) {
    const gone = ctx.db.expireSkins(skinExpiryHours(ctx) * 3_600_000);
    if (gone > 0)
        log(`skins: forgot ${gone} look(s) nobody has worn recently`);
    return gone;
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
        if (painted.has(entry)) {
            // Still on it: keep the look alive so expiry only ever catches dinosaurs
            // nobody is playing any more.
            ctx.db.touchSkin(player.steam, player.species);
            continue;
        }
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
                ctx.db.touchSkin(player.steam, player.species);
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