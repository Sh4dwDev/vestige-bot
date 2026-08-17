import { parsePlayables } from './catalog.js';
/**
 * Turning a species cap into an actual wall.
 *
 * A locked species is removed from the spawn menu with RCON `RemovePlayable`,
 * and put back with `AddPlayable`. The server owns the list, so this is a real
 * block rather than a request players can ignore.
 *
 * Two things shape the design:
 *
 * **It reconciles, it does not command.** Desired state is computed from the
 * caps, compared against what the server actually reports, and only the
 * differences are sent. That way a bot restart, a game restart, or an admin
 * editing the list by hand all converge on their own — no memory of what was
 * sent last time is needed, and a crash mid-lock cannot leave a species banned
 * forever.
 *
 * **It verifies.** `RemovePlayable` accepts a name it does not recognise
 * without complaint, so every pass reads the list back. If the write did not
 * take, enforcement disables itself and says so, rather than quietly leaving
 * caps that look enforced and are not.
 */
const ENABLED = 'enforce_caps';
const BROKEN = 'enforce_broken';
export function enforcementEnabled(ctx) {
    return ctx.db.getSetting(ENABLED) === '1';
}
export function setEnforcement(ctx, enabled) {
    ctx.db.setSetting(ENABLED, enabled ? '1' : '0');
    if (enabled)
        ctx.db.setSetting(BROKEN, '');
}
/** Set when a verified write failed to take, so the reason survives a restart. */
export function enforcementFault(ctx) {
    return ctx.db.getSetting(BROKEN) || null;
}
/**
 * Pure: what has to change to make `live` match the caps.
 *
 * `known` is every species this build has, so a species removed earlier can be
 * added back even though it is currently absent from `live`.
 */
export function diffPlayables(caps, live, known) {
    const present = new Set(live);
    const shouldBeGone = new Set(caps.filter((c) => c.locked).map((c) => c.species));
    const remove = [...shouldBeGone].filter((s) => present.has(s)).sort();
    // Only ever re-add something the server is known to have. Inventing a name
    // here would ask the game for a species it cannot spawn.
    const add = known
        .filter((s) => !shouldBeGone.has(s) && !present.has(s))
        .sort();
    return { remove, add };
}
/**
 * Brings the spawn menu in line with the caps.
 *
 * Returns what it changed. A thrown RCON error is left to the caller — the
 * population poll swallows those, and a server that is down has no menu to fix.
 */
export async function syncPlayables(ctx, known, log) {
    const caps = ctx.db.speciesCaps();
    const live = parsePlayables(await ctx.rcon.playables());
    const plan = diffPlayables(caps, live, known.length > 0 ? known : live);
    if (plan.remove.length === 0 && plan.add.length === 0) {
        return { ...plan, verified: true };
    }
    for (const species of plan.remove)
        await ctx.rcon.removePlayable(species);
    for (const species of plan.add)
        await ctx.rcon.addPlayable(species);
    // Never call UpdatePlayables here. It sounds like "push to clients" and is
    // in fact "rebuild from the base catalogue", which empties the list.
    // See the note in rcon.ts.
    // Read back. This is the whole reason enforcement can be trusted: the server
    // does not report a name it did not understand.
    const after = new Set(parsePlayables(await ctx.rcon.playables()));
    const stuck = [
        ...plan.remove.filter((s) => after.has(s)),
        ...plan.add.filter((s) => !after.has(s)),
    ];
    if (stuck.length > 0) {
        const why = `the server ignored add/remove for: ${stuck.join(', ')}`;
        setEnforcement(ctx, false);
        ctx.db.setSetting(BROKEN, why);
        log(`enforce: DISABLED — ${why}`);
        return { ...plan, verified: false };
    }
    log(`enforce: removed [${plan.remove.join(', ') || '-'}] ` +
        `restored [${plan.add.join(', ') || '-'}]`);
    return { ...plan, verified: true };
}
/**
 * Puts every species back, used when enforcement is switched off and on
 * startup if it is off — otherwise a species locked when the bot died stays
 * unspawnable with nothing left to unlock it.
 */
export async function restoreAllPlayables(ctx, known, log) {
    const live = new Set(parsePlayables(await ctx.rcon.playables()));
    const missing = known.filter((s) => !live.has(s));
    if (missing.length === 0)
        return [];
    for (const species of missing)
        await ctx.rcon.addPlayable(species);
    log(`enforce: restored ${missing.join(', ')}`);
    return missing;
}
//# sourceMappingURL=enforce.js.map