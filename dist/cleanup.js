import { nextRestart } from './restarts.js';
/**
 * Periodic corpse clearing, between restarts.
 *
 * RCON opcode `0x13` removes dead bodies, and the **server** does the removing
 * — which is why this is safe where sweeping actors from Lua is not. It is the
 * only tidying available short of a restart.
 *
 * Warned first, because a corpse someone is currently eating is about to
 * vanish, and having that happen unannounced feels like a bug.
 */
const ENABLED = 'cleanup_enabled';
const HOURS = 'cleanup_hours';
export const DEFAULT_HOURS = 3;
export function cleanupSettings(ctx) {
    const hours = Number.parseInt(ctx.db.getSetting(HOURS) ?? '', 10);
    return {
        enabled: ctx.db.getSetting(ENABLED) === '1',
        hours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_HOURS,
    };
}
export function setCleanupEnabled(ctx, enabled) {
    ctx.db.setSetting(ENABLED, enabled ? '1' : '0');
}
export function setCleanupHours(ctx, hours) {
    ctx.db.setSetting(HOURS, String(hours));
}
/** Shares the restart scheduler's clock alignment, so times are predictable. */
export function nextCleanup(now, hours) {
    return nextRestart(now, hours);
}
export async function wipeNow(ctx, log) {
    try {
        await ctx.rcon.wipeCorpses();
        log('cleanup: corpses wiped');
        return true;
    }
    catch (err) {
        log(`cleanup: wipe failed: ${err instanceof Error ? err.message : String(err)}`);
        return false;
    }
}
/**
 * Ticks every 20 seconds. The warning and the wipe each fire once per cycle,
 * tracked against the slot's own timestamp so a bot restart mid-cycle cannot
 * replay either.
 */
export function startCleanupScheduler(ctx, log) {
    let cycle = 0;
    let warned = false;
    let wiped = false;
    const tick = async () => {
        const settings = cleanupSettings(ctx);
        if (!settings.enabled)
            return;
        const now = new Date();
        const due = nextCleanup(now, settings.hours);
        if (due.getTime() !== cycle) {
            cycle = due.getTime();
            warned = false;
            wiped = false;
        }
        const minutes = Math.ceil((due.getTime() - now.getTime()) / 60_000);
        if (!warned && minutes <= 1) {
            warned = true;
            // Short: this draws over the game's own ANNOUNCEMENT label.
            await ctx.rcon.announce('Corpse cleanup in 1 min').catch(() => undefined);
        }
        if (!wiped && minutes <= 0) {
            wiped = true;
            await wipeNow(ctx, log);
        }
    };
    setInterval(() => void tick(), 20_000).unref();
    void tick();
}
//# sourceMappingURL=cleanup.js.map