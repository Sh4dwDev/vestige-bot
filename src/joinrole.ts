import type { GuildMember } from 'discord.js';

import type { Ctx } from './commands.js';

/**
 * The role every new member gets.
 *
 * Two things reliably stop this working, and neither is obvious from Discord's
 * side: the bot needs **Manage Roles**, and its own highest role must sit
 * **above** the one being handed out. Discord reports both as the same generic
 * "Missing Permissions", so the failure is logged in plain words instead.
 */

const KEY = 'join_role';

export function joinRole(ctx: Ctx): string | null {
  return ctx.db.getSetting(KEY) || null;
}

export function setJoinRole(ctx: Ctx, roleId: string | null): void {
  ctx.db.setSetting(KEY, roleId ?? '');
}

export async function giveJoinRole(
  ctx: Ctx,
  member: GuildMember,
  log: (m: string) => void,
): Promise<void> {
  const roleId = joinRole(ctx);
  if (!roleId) return;

  // Bots get roles from their own integrations; handing them a member role is
  // rarely wanted and occasionally breaks things.
  if (member.user.bot) return;

  try {
    await member.roles.add(roleId, 'Join role');
    log(`joinrole: gave ${roleId} to ${member.id}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log(`joinrole: FAILED for ${member.id}: ${reason} — check the bot has Manage ` +
      'Roles and that its role is above the one being given');
  }
}
