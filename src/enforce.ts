import { parsePlayables } from './catalog.js';
import type { Ctx } from './commands.js';
import { TIERED_SPECIES } from './tiers.js';

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

export function enforcementEnabled(ctx: Ctx): boolean {
  return ctx.db.getSetting(ENABLED) === '1';
}

export function setEnforcement(ctx: Ctx, enabled: boolean): void {
  ctx.db.setSetting(ENABLED, enabled ? '1' : '0');
  if (enabled) ctx.db.setSetting(BROKEN, '');
}

/** Set when a verified write failed to take, so the reason survives a restart. */
export function enforcementFault(ctx: Ctx): string | null {
  return ctx.db.getSetting(BROKEN) || null;
}

export interface PlayableSync {
  /** Species that should not be spawnable right now. */
  remove: string[];
  /** Species wrongly missing from the menu. */
  add: string[];
}

/**
 * Pure: what has to change to make `live` match the caps.
 *
 * `known` is every species this build has, so a species removed earlier can be
 * added back even though it is currently absent from `live`.
 */
export function diffPlayables(
  caps: Array<{ species: string; cap: number; locked: boolean }>,
  live: string[],
  known: string[],
): PlayableSync {
  const present = new Set(live);
  const shouldBeGone = new Set(
    caps.filter((c) => c.locked).map((c) => c.species),
  );

  const remove = [...shouldBeGone].filter((s) => present.has(s)).sort();

  // Only ever re-add something the server is known to have. Inventing a name
  // here would ask the game for a species it cannot spawn — so this list has to
  // be the remembered roster, never the live menu, which a cap has already
  // edited.
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
export async function syncPlayables(
  ctx: Ctx,
  known: string[],
  log: (m: string) => void,
): Promise<PlayableSync & { verified: boolean }> {
  const caps = ctx.db.speciesCaps();
  const live = parsePlayables(await ctx.rcon.playables());

  // The roster is the authority on what exists, not the live menu. A capped
  // species is absent from the menu by design, and taking "what exists" from
  // the menu meant a locked species could never be unlocked.
  ctx.db.rememberSpecies([...live, ...known, ...caps.map((c) => c.species)]);
  ctx.db.rememberSpecies(TIERED_SPECIES, 'named');
  const roster = ctx.db.offeredSpecies();

  const plan = diffPlayables(caps, live, roster.length > 0 ? roster : live);

  if (plan.remove.length === 0 && plan.add.length === 0) {
    return { ...plan, verified: true };
  }

  for (const species of plan.remove) await ctx.rcon.removePlayable(species);
  for (const species of plan.add) await ctx.rcon.addPlayable(species);

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
export async function restoreAllPlayables(
  ctx: Ctx,
  known: string[],
  log: (m: string) => void,
): Promise<string[]> {
  const live = new Set(parsePlayables(await ctx.rcon.playables()));

  // Same trap as the diff: what is missing cannot be worked out from the list
  // it is missing from. The roster remembers, so a species locked before the
  // bot last stopped is still restorable.
  ctx.db.rememberSpecies([...live, ...known]);
  const roster = ctx.db.offeredSpecies();

  const missing = (roster.length > 0 ? roster : known).filter((s) => !live.has(s));
  if (missing.length === 0) return [];

  for (const species of missing) await ctx.rcon.addPlayable(species);
  log(`enforce: restored ${missing.join(', ')}`);
  return missing;
}
