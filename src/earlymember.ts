import type { Guild, GuildMember } from 'discord.js';

import type { Ctx } from './commands.js';

/**
 * The Early Member role: the first N people, and nobody after.
 *
 * Held as a **Discord role** rather than a list in the database, because the
 * role is the thing people can see and the thing a channel is gated on. Two
 * records of the same fact drift apart, and the one an admin can edit by hand
 * is the one that wins — so Discord is the record and this only ever adds to it.
 *
 * That also makes the count self-correcting: remove somebody from the role and
 * a slot genuinely frees up, with nothing left holding a stale claim.
 */

const ROLE_KEY = 'early_member_role';

export function earlyRole(ctx: Ctx): string | null {
  return ctx.db.getSetting(ROLE_KEY) || null;
}

export function setEarlyRole(ctx: Ctx, roleId: string | null): void {
  ctx.db.setSetting(ROLE_KEY, roleId ?? '');
}

export const holders = (guild: Guild, roleId: string): number =>
  guild.roles.cache.get(roleId)?.members.size ?? 0;

export const hasEarlyRole = (member: GuildMember, roleId: string): boolean =>
  member.roles.cache.has(roleId);

export type GrantResult = 'given' | 'already' | 'full' | 'no-role' | 'failed';

/**
 * Gives the role if there is room.
 *
 * The cap is checked against Discord's own membership immediately before the
 * add. Two people joining at the same instant can still both pass it — Discord
 * offers no atomic way to do this — so the cap is a limit rather than a
 * guarantee, and being one over is a far smaller problem than refusing somebody
 * who was inside it.
 */
export async function grantEarlyRole(
  ctx: Ctx,
  member: GuildMember,
  limit: number,
  log: (m: string) => void,
): Promise<GrantResult> {
  const roleId = earlyRole(ctx);
  if (!roleId) return 'no-role';
  if (member.user.bot) return 'no-role';
  if (hasEarlyRole(member, roleId)) return 'already';
  if (holders(member.guild, roleId) >= limit) return 'full';

  try {
    await member.roles.add(roleId, 'Early member');
    return 'given';
  } catch (err) {
    // The same two causes as every other role here, and Discord reports both
    // as one generic error: no Manage Roles, or the bot's own role sits below.
    log(`earlymember: could not give ${roleId} to ${member.id}: ${
      err instanceof Error ? err.message : String(err)}`);
    return 'failed';
  }
}

export interface Backfill {
  given: number;
  already: number;
  skipped: number;
  full: boolean;
}

/**
 * Hands the role to people who were already here, oldest first.
 *
 * Oldest first is the only ordering that matches what the role claims to mean.
 * Doing it by whoever happens to be cached, or alphabetically, would hand
 * "early member" to whoever joined last week.
 */
export async function backfillEarlyRole(
  ctx: Ctx,
  guild: Guild,
  limit: number,
  log: (m: string) => void,
): Promise<Backfill> {
  const roleId = earlyRole(ctx);
  if (!roleId) return { given: 0, already: 0, skipped: 0, full: false };

  // Fetched rather than read from cache: the cache holds whoever the bot has
  // happened to see, which is not the same as the membership.
  const members = await guild.members.fetch();
  const ordered = [...members.values()]
    .filter((m) => !m.user.bot)
    .sort((a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0));

  const out: Backfill = { given: 0, already: 0, skipped: 0, full: false };

  for (const member of ordered) {
    if (hasEarlyRole(member, roleId)) { out.already += 1; continue; }
    if (holders(guild, roleId) + out.given >= limit) { out.full = true; break; }

    const result = await grantEarlyRole(ctx, member, limit, log);
    if (result === 'given') out.given += 1;
    else if (result === 'already') out.already += 1;
    else if (result === 'full') { out.full = true; break; }
    else out.skipped += 1;
  }

  log(`earlymember: backfill gave ${out.given}, ${out.already} already had it`);
  return out;
}
