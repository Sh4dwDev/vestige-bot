import { MessageFlags } from 'discord.js';
import { SERVER } from './brand.js';
/**
 * The opt-in role for restart warnings.
 *
 * Restarts are announced to everybody in game, but the Discord ping is the part
 * people want to choose: pinging a whole server on a schedule is how a channel
 * gets muted, and a muted channel is worse than no ping at all. So it is a role
 * players give themselves from a button, and take back the same way.
 *
 * The same two things break this as break the join role, and Discord reports
 * both as a generic "Missing Permissions": the bot needs **Manage Roles**, and
 * its own highest role must sit **above** the one being handed out. Said in
 * plain words here rather than left as a shrug.
 */
const KEY = 'restart_alert_role';
export const RESTART_ROLE_BUTTON = 'hub:restartrole';
export function restartAlertRole(ctx) {
    return ctx.db.getSetting(KEY) || null;
}
export function setRestartAlertRole(ctx, roleId) {
    ctx.db.setSetting(KEY, roleId ?? '');
}
const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
/**
 * Toggles the role on the person who pressed.
 *
 * One button rather than two, because "get notified" and "stop being notified"
 * as separate buttons means a panel that always shows one that does nothing.
 * Returns true when the interaction was ours.
 */
export async function handleRestartRoleButton(ctx, interaction, log) {
    if (interaction.customId !== RESTART_ROLE_BUTTON)
        return false;
    const roleId = restartAlertRole(ctx);
    if (!roleId) {
        await reply(interaction, 'Restart alerts are not set up yet — an admin needs to choose the role '
            + 'with `/setup restartrole`.');
        return true;
    }
    const member = interaction.member;
    if (!member || typeof member.roles === 'undefined') {
        await reply(interaction, 'That only works inside the server.');
        return true;
    }
    const had = member.roles.cache.has(roleId);
    try {
        if (had) {
            await member.roles.remove(roleId, 'Opted out of restart alerts');
        }
        else {
            await member.roles.add(roleId, 'Opted in to restart alerts');
        }
    }
    catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log(`restartrole: could not ${had ? 'remove' : 'add'} ${roleId} for ${interaction.user.id}: ${reason}`);
        await reply(interaction, 'Discord would not let me change your roles. The bot needs **Manage '
            + 'Roles**, and its own role has to sit **above** the alert role in the '
            + 'server settings.');
        return true;
    }
    await reply(interaction, had
        ? '🔕 Restart alerts **off**. Press it again to turn them back on.'
        : `🔔 Restart alerts **on**. You will be pinged before ${SERVER} restarts.`);
    return true;
}
//# sourceMappingURL=alertrole.js.map