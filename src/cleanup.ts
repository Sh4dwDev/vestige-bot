import type { Ctx } from './commands.js';
import { isDue, nextRestart, restartSettings, TICK_MS } from './restarts.js';

/**
 * Periodic tidying, between restarts.
 *
 * Two things the server can do for itself:
 *
 * - **Corpses** — RCON `WipeCorpses`. The server does the removing, which is
 *   why this is safe where sweeping actors from Lua is not.
 * - **AI** — RCON `ToggleAI`, off then on. Also server-side. Note this is a
 *   *toggle*, so it is flipped twice and lands back where it started.
 *
 * Warned first, because a corpse someone is eating is about to vanish and
 * having that happen unannounced reads as a bug.
 *
 * A cycle that lands on a restart is skipped — wiping twenty seconds before the
 * world goes down achieves nothing, and the two warnings would stack on top of
 * each other in the same announcement line.
 */

const ENABLED = 'cleanup_enabled';
const HOURS = 'cleanup_hours';
const AI = 'cleanup_ai';

export const DEFAULT_HOURS = 3;

/** A cycle this close to a restart is left to the restart. */
const RESTART_GUARD_MS = 5 * 60_000;

/** How long AI stays off before it is switched back on. */
const AI_OFF_MS = 5_000;

export interface CleanupSettings {
  enabled: boolean;
  hours: number;
  clearAI: boolean;
}

export function cleanupSettings(ctx: Ctx): CleanupSettings {
  const hours = Number.parseInt(ctx.db.getSetting(HOURS) ?? '', 10);
  return {
    enabled: ctx.db.getSetting(ENABLED) === '1',
    hours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_HOURS,
    // On by default: it is the half of cleanup that previously needed a full
    // restart, and it is what was asked for.
    clearAI: (ctx.db.getSetting(AI) || '1') !== '0',
  };
}

export function setCleanupEnabled(ctx: Ctx, enabled: boolean): void {
  ctx.db.setSetting(ENABLED, enabled ? '1' : '0');
}

export function setCleanupHours(ctx: Ctx, hours: number): void {
  ctx.db.setSetting(HOURS, String(hours));
}

export function setCleanupAI(ctx: Ctx, clear: boolean): void {
  ctx.db.setSetting(AI, clear ? '1' : '0');
}

/** Shares the restart scheduler's clock alignment, so times are predictable. */
export function nextCleanup(now: Date, hours: number): Date {
  return nextRestart(now, hours);
}

/**
 * True when this cleanup slot is close enough to a restart that the restart
 * should have it instead.
 */
export function collidesWithRestart(
  cleanupAt: Date,
  restartAt: Date,
  restartsOn: boolean,
): boolean {
  if (!restartsOn) return false;
  return Math.abs(restartAt.getTime() - cleanupAt.getTime()) <= RESTART_GUARD_MS;
}

export async function wipeNow(ctx: Ctx, log: (m: string) => void): Promise<boolean> {
  try {
    await ctx.rcon.wipeCorpses();
    log('cleanup: corpses wiped');
    return true;
  } catch (err) {
    log(`cleanup: wipe failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/** `AI spawns are now On` / `... now Off` — the reply is the only state readout. */
export function aiStateFromReply(reply: string): boolean | null {
  const match = /AI spawns are now (On|Off)/i.exec(reply);
  if (!match?.[1]) return null;
  return match[1].toLowerCase() === 'on';
}

export type AIResult = 'cleared' | 'disabled' | 'failed' | 'inverted';

/**
 * Clears AI by cycling it off and back on.
 *
 * `ToggleAI` is a toggle, not a setter, and there is no separate way to read
 * the current state — but the reply names the state it landed in, so one flip
 * doubles as the readout.
 *
 * That matters more than it looks. A blind "flip twice" is only safe if AI was
 * running to begin with; if it was not, the first flip switches wildlife *on*
 * for the duration. So: flip once, read where it landed, and only complete the
 * cycle when there was something to clear.
 *
 * Whether the reply names the state it *entered* or the one it *left* is not
 * settled — it cannot be told apart over RCON alone. The design is deliberately
 * safe either way: the flips always balance, so the server ends in the state it
 * started in, and the worst case is one brief cycle rather than a lasting
 * change.
 */
export async function clearAI(ctx: Ctx, log: (m: string) => void): Promise<AIResult> {
  let nowOn: boolean | null;
  try {
    nowOn = aiStateFromReply(await ctx.rcon.toggleAI());
  } catch (err) {
    log(`cleanup: AI toggle failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }

  // Landed on "On" means it was off to begin with: there is no AI to clear, and
  // leaving it on would be a change nobody asked for. Put it straight back.
  if (nowOn === true) {
    try {
      await ctx.rcon.toggleAI();
      log('cleanup: AI spawns are disabled on this server — nothing to clear');
      return 'disabled';
    } catch (err) {
      log('cleanup: AI WAS SWITCHED ON AND COULD NOT BE SWITCHED BACK — ' +
        `${err instanceof Error ? err.message : String(err)}`);
      return 'inverted';
    }
  }

  // Either it landed on "Off" (AI was running, this is the clear), or the reply
  // was not recognised. In both cases the safe move is to flip back.
  await new Promise((resolve) => setTimeout(resolve, AI_OFF_MS));

  try {
    await ctx.rcon.toggleAI();
    log(nowOn === false ? 'cleanup: AI cleared' : 'cleanup: AI cycled (reply not recognised)');
    return 'cleared';
  } catch (err) {
    log('cleanup: AI TOGGLED OFF BUT NOT BACK ON — ' +
      `${err instanceof Error ? err.message : String(err)}. Run /admin cleanup now to retry.`);
    return 'inverted';
  }
}

/**
 * Ticks every 20 seconds. The warning and the sweep each fire once per cycle,
 * tracked against the slot's own timestamp so a bot restart mid-cycle cannot
 * replay either.
 */
export function startCleanupScheduler(ctx: Ctx, log: (m: string) => void): void {
  let cycle = 0;
  let warned = false;
  let swept = false;

  const tick = async (): Promise<void> => {
    const settings = cleanupSettings(ctx);
    if (!settings.enabled) return;

    const now = new Date();
    const due = nextCleanup(now, settings.hours);

    if (due.getTime() !== cycle) {
      cycle = due.getTime();
      warned = false;
      swept = false;
    }

    const restarts = restartSettings(ctx);
    if (collidesWithRestart(due, nextRestart(now, restarts.intervalHours), restarts.enabled)) {
      // Claim the cycle so it is not reconsidered on every tick.
      warned = true;
      swept = true;
      return;
    }

    const minutes = Math.ceil((due.getTime() - now.getTime()) / 60_000);

    if (!warned && minutes <= 1) {
      warned = true;
      // Short: this draws over the game's own ANNOUNCEMENT label.
      await ctx.rcon.announce('Cleanup in 1 min').catch(() => undefined);
    }

    if (!swept && isDue(now, due)) {
      swept = true;
      await wipeNow(ctx, log);
      if (settings.clearAI) await clearAI(ctx, log);
    }
  };

  setInterval(() => void tick(), TICK_MS).unref();
  void tick();
}
