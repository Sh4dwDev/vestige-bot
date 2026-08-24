import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
/**
 * Staff duty sessions: a visible state, and a record of it.
 *
 * **This does not change anybody's permissions, and says so.** In-game admin on
 * Evrima is the `AdminsSteamIDs` list in `Game.ini`, which the server reads
 * only at startup and rewrites on shutdown — see `admins.ts`. There is no way
 * to grant or revoke it while the server is running, so Duty Mode cannot gate
 * the game's own admin panel and does not pretend to. Vesta's own commands are
 * likewise left alone by request.
 *
 * What it does provide is the thing that was actually wanted: a clear on/off
 * state everybody can see, and an automatic record of who was on duty, when,
 * and for how long — with the times taken from the clock rather than from
 * whatever a staff member remembers to type.
 *
 * **The database is the authority, not the role.** A Discord role can be
 * removed by hand, lost to an outage, or survive a crash; a session row cannot
 * drift the same way. The role follows the session, never the reverse.
 */
const KEYS = {
    staffRole: 'duty_staff_role',
    onDutyRole: 'duty_onduty_role',
    seniorRole: 'duty_senior_role',
    logChannel: 'duty_log_channel',
    panelChannel: 'duty_panel_channel',
    panelMessage: 'duty_panel_message',
    maxHours: 'duty_max_hours',
};
const COLORS = { on: 0x57f287, off: 0x5865f2, warn: 0xfee75c, bad: 0xed4245 };
/** Long enough for a real session, short enough that a forgotten one closes. */
export const DEFAULT_MAX_HOURS = 4;
// ----------------------------------------------------------------- settings --
const get = (ctx, key) => ctx.db.getSetting(key) || null;
export const staffRole = (ctx) => get(ctx, KEYS.staffRole);
export const onDutyRole = (ctx) => get(ctx, KEYS.onDutyRole);
export const seniorRole = (ctx) => get(ctx, KEYS.seniorRole);
export const dutyLogChannel = (ctx) => get(ctx, KEYS.logChannel);
export const dutyPanelChannel = (ctx) => get(ctx, KEYS.panelChannel);
export const DUTY_PANEL_MESSAGE_KEY = KEYS.panelMessage;
export function maxHours(ctx) {
    const raw = Number.parseFloat(ctx.db.getSetting(KEYS.maxHours) ?? '');
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_HOURS;
}
export const setDutySetting = (ctx, key, value) => ctx.db.setSetting(KEYS[key], value ?? '');
// -------------------------------------------------------------- session ids --
/**
 * `DUTY-20260824-0042`, sequential within the day.
 *
 * Readable in a log and sortable, which a random id is not — somebody reading
 * the channel should be able to tell two sessions apart at a glance and know
 * roughly when each happened.
 */
export function nextSessionId(ctx, now) {
    const day = now.toISOString().slice(0, 10).replace(/-/g, '');
    const used = ctx.db.dutySessionsOnDay(day).length;
    return `DUTY-${day}-${String(used + 1).padStart(4, '0')}`;
}
// ------------------------------------------------------------------- timing --
/**
 * `HH:MM:SS` from the stored UTC instants.
 *
 * Deliberately not from message timestamps: an edited log, a retried post or a
 * clock-change would each produce a different answer, and the one that matters
 * is how long they were actually on duty.
 */
export function formatDuration(seconds) {
    const whole = Math.max(0, Math.floor(seconds));
    const h = Math.floor(whole / 3600);
    const m = Math.floor((whole % 3600) / 60);
    const s = whole % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
export const durationBetween = (startUtc, endUtc) => Math.max(0, Math.round((Date.parse(endUtc) - Date.parse(startUtc)) / 1000));
/** Discord renders this in each viewer's own timezone, which beats picking one. */
export const stamp = (iso) => `<t:${Math.floor(Date.parse(iso) / 1000)}:F>`;
// ------------------------------------------------------------------- ranking --
/**
 * The rank shown in the log.
 *
 * Display only — nothing is gated on it, because nothing is being gated. It
 * exists so a session log says "Moderator" rather than leaving whoever reads it
 * to work out who that was.
 */
export function rankOf(roleIds, ranks) {
    // First match wins, so callers list seniors first and somebody holding two
    // roles is described by the higher one.
    for (const rank of ranks) {
        if (rank.roleId && roleIds.includes(rank.roleId))
            return rank.label;
    }
    return 'Staff';
}
// ------------------------------------------------------------------- embeds --
export function buildDutyPanel() {
    return new EmbedBuilder()
        .setColor(COLORS.off)
        .setTitle('🛡️  Vestige Staff Duty')
        .setDescription('Use this panel whenever you begin or finish an in-game moderation '
        + 'session.\n\nDuty Mode separates staff work from normal play. Your '
        + 'session and its exact length are recorded automatically, so nobody has '
        + 'to write their own hours down.')
        .addFields({
        name: '🟢  Going on duty',
        value: 'Leave any fight, safe-log or store what you are playing, then '
            + 'press **Go On Duty**. Your session starts the moment you press it.',
    }, {
        name: '⚪  Going off duty',
        value: 'Press **Go Off Duty** before returning to normal play. Your '
            + 'exact duration is worked out and logged for you.',
    }, {
        name: '🤝  While on duty',
        value: 'Do not hunt, fight, join a normal group, or handle a case you '
            + 'are personally involved in. If it involves you, your friends or '
            + 'your group, hand it to somebody uninvolved.',
    }, {
        name: '⚠️  What this panel does and does not do',
        value: 'It records your session and shows everybody that you are on '
            + 'duty. It **does not change your in-game powers** — The Isle keeps '
            + 'admin access in a file it reads only at startup, so it cannot be '
            + 'switched on and off while the server runs. Duty Mode is a '
            + 'statement of intent and a record of it, not a lock.',
    })
        .setFooter({ text: `Staff powers are a responsibility · ${SIGNATURE}` });
}
export const dutyPanelRows = () => [
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('duty:on').setLabel('Go On Duty')
        .setEmoji('🟢').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('duty:off').setLabel('Go Off Duty')
        .setEmoji('⚪').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('duty:active').setLabel('Active Staff')
        .setEmoji('📋').setStyle(ButtonStyle.Primary)),
];
export function buildStartLog(session, username) {
    return new EmbedBuilder()
        .setColor(COLORS.on)
        .setTitle('🟢  Staff on duty')
        .setDescription(`<@${session.discordUserId}> · **${username}**`)
        .addFields({ name: 'Discord ID', value: session.discordUserId, inline: true }, { name: 'Steam ID', value: session.steamId || 'not linked', inline: true }, { name: 'Rank', value: session.staffRank, inline: true }, { name: 'Session', value: session.sessionId, inline: true }, { name: 'Started', value: stamp(session.startedAtUtc), inline: true }, { name: 'Started by', value: startedByLabel(session.startMethod), inline: true })
        .setFooter({ text: `${SERVER} · Active` })
        .setTimestamp(new Date(session.startedAtUtc));
}
const startedByLabel = (method) => method === 'panel' ? 'Duty panel' : method === 'command' ? 'Slash command' : 'Override';
export function buildEndLog(session, username) {
    const seconds = session.durationSeconds ?? 0;
    return new EmbedBuilder()
        .setColor(COLORS.off)
        .setTitle('🛡️  Duty session completed')
        .setDescription(`<@${session.discordUserId}> · **${username}**`)
        .addFields({ name: 'Discord ID', value: session.discordUserId, inline: true }, { name: 'Steam ID', value: session.steamId || 'not linked', inline: true }, { name: 'Rank', value: session.staffRank, inline: true }, { name: 'Session', value: session.sessionId, inline: true }, { name: 'Started', value: stamp(session.startedAtUtc), inline: true }, {
        name: 'Ended',
        value: session.endedAtUtc ? stamp(session.endedAtUtc) : 'unknown',
        inline: true,
    }, { name: 'Duration', value: formatDuration(seconds), inline: true }, { name: 'Ended by', value: session.endReason ?? 'unknown', inline: true })
        .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
        .setTimestamp(session.endedAtUtc ? new Date(session.endedAtUtc) : new Date());
}
export function buildActiveEmbed(sessions, now = new Date()) {
    if (sessions.length === 0) {
        return new EmbedBuilder()
            .setColor(COLORS.warn)
            .setTitle('📋  Nobody on duty')
            .setDescription('No staff are on duty right now.')
            .setFooter({ text: SIGNATURE });
    }
    return new EmbedBuilder()
        .setColor(COLORS.on)
        .setTitle(`📋  ${sessions.length} on duty`)
        .setDescription(sessions
        .map((s) => `<@${s.discordUserId}> · **${s.staffRank}** · `
        + `${formatDuration(durationBetween(s.startedAtUtc, now.toISOString()))} `
        + `· since ${stamp(s.startedAtUtc)}`)
        .join('\n'))
        // Steam IDs are deliberately absent: this is readable by every staff
        // member, and who is on duty does not require handing out their account.
        .setFooter({ text: SIGNATURE });
}
export function buildHistoryEmbed(sessions, userId) {
    if (sessions.length === 0) {
        return new EmbedBuilder()
            .setColor(COLORS.warn)
            .setTitle('No duty sessions')
            .setDescription(`<@${userId}> has never been on duty.`)
            .setFooter({ text: SIGNATURE });
    }
    return new EmbedBuilder()
        .setColor(COLORS.off)
        .setTitle('🛡️  Duty history')
        .setDescription(`<@${userId}> — most recent first.`)
        .addFields(sessions.slice(0, 10).map((s) => ({
        name: `${s.sessionId} · ${s.staffRank}`,
        value: `${stamp(s.startedAtUtc)}\n`
            + (s.endedAtUtc
                ? `to ${stamp(s.endedAtUtc)}\n**${formatDuration(s.durationSeconds ?? 0)}**`
                    + ` · ${s.endReason ?? 'ended'}`
                : '**still on duty**'),
    })))
        .setFooter({ text: SIGNATURE });
}
/**
 * Opens a session and puts the role on.
 *
 * Order matters. The row goes in first, because it is the record and the role
 * is only a picture of it — and if the role cannot be granted the session still
 * stands, with the failure reported rather than swallowed. The reverse order
 * would leave somebody wearing a badge for a session that does not exist.
 */
export async function goOnDuty(ctx, member, rank, method, log) {
    const link = ctx.db.linkFor(member.id);
    if (!link) {
        return {
            ok: false,
            reason: 'Link your Steam account first — a duty record with no account '
                + 'attached cannot be tied to anything that happened in game.',
        };
    }
    const now = new Date();
    const session = ctx.db.startDuty({
        sessionId: nextSessionId(ctx, now),
        discordUserId: member.id,
        steamId: link.steamId,
        staffRank: rank,
        startedAtUtc: now.toISOString(),
        startMethod: method,
    });
    // Null means the unique index refused it: they already have one open.
    if (!session)
        return { ok: false, reason: 'You are already on duty.' };
    const roleId = onDutyRole(ctx);
    if (roleId) {
        try {
            await member.roles.add(roleId);
        }
        catch (err) {
            // Deliberately not a rollback. The session is the real thing; a missing
            // role is cosmetic, and throwing the record away to keep Discord tidy
            // would lose the only durable evidence of the session.
            log(`duty: could not add the on-duty role for ${member.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    return { ok: true, session };
}
/**
 * Closes a session and takes the role off.
 *
 * The close is a conditional update, so a second press, a timeout firing at the
 * same moment, and a forced end all race safely — exactly one wins and the
 * duration is written once.
 */
export async function goOffDuty(ctx, member, discordUserId, reason, log) {
    const open = ctx.db.activeDuty(discordUserId);
    if (!open)
        return { ok: false, reason: 'You are not on duty.' };
    const endedAt = new Date().toISOString();
    const seconds = durationBetween(open.startedAtUtc, endedAt);
    if (!ctx.db.endDuty(open.sessionId, endedAt, seconds, reason)) {
        // Somebody else closed it between the read and the write.
        return { ok: false, reason: 'That session was already closed.' };
    }
    const roleId = onDutyRole(ctx);
    if (roleId && member) {
        try {
            await member.roles.remove(roleId);
        }
        catch (err) {
            log(`duty: could not remove the on-duty role for ${discordUserId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const session = ctx.db.dutySession(open.sessionId);
    return session ? { ok: true, session } : { ok: false, reason: 'The session vanished.' };
}
// ------------------------------------------------------------ interactions --
/** The ranks shown in a log, seniors first so the higher one wins. */
export function ranksFor(ctx) {
    return [
        { roleId: seniorRole(ctx) ?? '', label: 'Head Admin' },
        { roleId: staffRole(ctx) ?? '', label: 'Staff' },
    ];
}
export const isStaff = (ctx, roleIds) => {
    const staff = staffRole(ctx);
    const senior = seniorRole(ctx);
    // A senior role alone is enough: forgetting to also give somebody the base
    // staff role should not quietly lock them out of their own duty panel.
    return (staff !== null && roleIds.includes(staff))
        || (senior !== null && roleIds.includes(senior));
};
export const isSenior = (ctx, roleIds) => {
    const senior = seniorRole(ctx);
    return senior !== null && roleIds.includes(senior);
};
/**
 * Posts the start log and remembers where, so the completion can edit it.
 *
 * Never throws. A session that happened is worth more than a message about it,
 * so a missing or forbidden channel is logged and the session stands.
 */
export async function postStartLog(ctx, client, session, username, log) {
    const channelId = dutyLogChannel(ctx);
    if (!channelId)
        return;
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || !('send' in channel)) {
            log(`duty: log channel ${channelId} is unreachable`);
            return;
        }
        const sent = await channel.send({
            embeds: [buildStartLog(session, username)],
            allowedMentions: { parse: [] },
        });
        ctx.db.setDutyLogMessage(session.sessionId, channelId, sent.id);
    }
    catch (err) {
        log(`duty: start log failed for ${session.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * Turns the start log into the completed one, or posts a fresh message.
 *
 * Editing keeps a session to one entry, which is what makes the channel
 * readable. When the original is gone — deleted, or the channel changed since —
 * a new message carrying the same session id is posted instead, so the record
 * is never simply absent.
 */
export async function postEndLog(ctx, client, session, username, log) {
    const channelId = session.logChannelId ?? dutyLogChannel(ctx);
    if (!channelId)
        return;
    const embed = buildEndLog(session, username);
    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased() || !('send' in channel)) {
            log(`duty: log channel ${channelId} is unreachable`);
            return;
        }
        if (session.logMessageId) {
            const original = await channel.messages.fetch(session.logMessageId).catch(() => null);
            if (original) {
                await original.edit({ embeds: [embed], allowedMentions: { parse: [] } });
                return;
            }
        }
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }
    catch (err) {
        log(`duty: end log failed for ${session.sessionId}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
const ephemeral = { flags: MessageFlags.Ephemeral };
const deny = (title, body) => new EmbedBuilder().setColor(COLORS.bad).setTitle(title).setDescription(body)
    .setFooter({ text: SIGNATURE });
/** Returns true when the interaction was ours. */
export async function handleDuty(ctx, interaction, log) {
    const id = interaction.customId;
    if (!id.startsWith('duty:'))
        return false;
    const member = interaction.member;
    const roleIds = member?.roles?.cache?.map((r) => r.id) ?? [];
    if (!member || !isStaff(ctx, roleIds)) {
        await interaction.reply({
            embeds: [deny('Staff only', 'This panel is for staff. If you think that is '
                    + 'wrong, ask an admin to check your roles.')],
            ...ephemeral,
        });
        return true;
    }
    if (id === 'duty:active') {
        await interaction.reply({
            embeds: [buildActiveEmbed(ctx.db.allActiveDuty())],
            ...ephemeral,
        });
        return true;
    }
    await interaction.deferReply(ephemeral);
    if (id === 'duty:on') {
        const result = await goOnDuty(ctx, member, rankOf(roleIds, ranksFor(ctx)), 'panel', log);
        if (!result.ok) {
            await interaction.editReply({ embeds: [deny('Not started', result.reason)] });
            return true;
        }
        await postStartLog(ctx, interaction.client, result.session, interaction.user.username, log);
        log(`duty: ${interaction.user.id} on duty as ${result.session.sessionId}`);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(COLORS.on).setTitle('🟢  On duty')
                    .setDescription(`Session **${result.session.sessionId}** started ${stamp(result.session.startedAtUtc)}.`
                    + '\n\nWhile you are on duty: no hunting, fighting or normal groups, '
                    + 'and hand over any case you are involved in.'
                    + `\n\nIt closes automatically after **${maxHours(ctx)} hours** if you forget.`)
                    .setFooter({ text: SIGNATURE })],
        });
        return true;
    }
    if (id === 'duty:off') {
        const result = await goOffDuty(ctx, member, interaction.user.id, 'Staff went off duty', log);
        if (!result.ok) {
            await interaction.editReply({ embeds: [deny('Not ended', result.reason)] });
            return true;
        }
        await postEndLog(ctx, interaction.client, result.session, interaction.user.username, log);
        log(`duty: ${interaction.user.id} off duty after `
            + `${result.session.durationSeconds ?? 0}s`);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(COLORS.off).setTitle('⚪  Off duty')
                    .setDescription(`**${formatDuration(result.session.durationSeconds ?? 0)}** on duty, `
                    + `recorded as **${result.session.sessionId}**.\n\nBack to normal play.`)
                    .setFooter({ text: SIGNATURE })],
        });
        return true;
    }
    return true;
}
// --------------------------------------------------------------- housekeeping --
/**
 * Closes sessions that outlived their limit, and everything left open by a
 * restart.
 *
 * Run on startup and on a timer. Closing on startup is the safe default: a row
 * saying "active" after the bot has been down says only that nobody pressed the
 * button, not that somebody is still working.
 */
export async function reconcileDuty(ctx, client, log, { onStartup = false } = {}) {
    const limitMs = maxHours(ctx) * 3600_000;
    const now = Date.now();
    let closed = 0;
    for (const open of ctx.db.allActiveDuty()) {
        const age = now - Date.parse(open.startedAtUtc);
        const reason = onStartup
            ? 'Bot restarted'
            : age >= limitMs
                ? 'Maximum session duration reached'
                : null;
        if (!reason)
            continue;
        // Fetching the member is best effort: they may have left, and a session
        // still has to close and be logged when they have.
        let member = null;
        for (const guild of client.guilds.cache.values()) {
            member = await guild.members.fetch(open.discordUserId).catch(() => null);
            if (member)
                break;
        }
        const result = await goOffDuty(ctx, member, open.discordUserId, reason, log);
        if (!result.ok)
            continue;
        await postEndLog(ctx, client, result.session, member?.user?.username ?? open.discordUserId, log);
        log(`duty: closed ${open.sessionId} — ${reason}`);
        closed += 1;
    }
    // An on-duty role with no session behind it is somebody who looks on duty and
    // is not. The record decides, so the role is taken off.
    if (onStartup)
        await stripOrphanRoles(ctx, client, log);
    return closed;
}
async function stripOrphanRoles(ctx, client, log) {
    const roleId = onDutyRole(ctx);
    if (!roleId)
        return;
    for (const guild of client.guilds.cache.values()) {
        const role = guild.roles.cache.get(roleId);
        if (!role)
            continue;
        for (const member of role.members.values()) {
            if (ctx.db.activeDuty(member.id))
                continue;
            await member.roles.remove(roleId).catch(() => undefined);
            log(`duty: removed a stale on-duty role from ${member.id}`);
        }
    }
}
//# sourceMappingURL=duty.js.map