import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type ButtonInteraction, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
import type { DutyRow } from './db.js';
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
declare const KEYS: {
    readonly staffRole: "duty_staff_role";
    readonly onDutyRole: "duty_onduty_role";
    readonly seniorRole: "duty_senior_role";
    readonly logChannel: "duty_log_channel";
    readonly panelChannel: "duty_panel_channel";
    readonly panelMessage: "duty_panel_message";
    readonly maxHours: "duty_max_hours";
};
/** Long enough for a real session, short enough that a forgotten one closes. */
export declare const DEFAULT_MAX_HOURS = 4;
export type StartMethod = 'panel' | 'command' | 'override';
export type EndReason = 'Staff went off duty' | 'Forced off duty by senior staff' | 'Maximum session duration reached' | 'Bot restarted';
/** The stored shape, re-exported so callers need one import rather than two. */
export type DutySession = DutyRow;
export declare const staffRole: (ctx: Ctx) => string | null;
export declare const onDutyRole: (ctx: Ctx) => string | null;
export declare const seniorRole: (ctx: Ctx) => string | null;
export declare const dutyLogChannel: (ctx: Ctx) => string | null;
export declare const dutyPanelChannel: (ctx: Ctx) => string | null;
export declare const DUTY_PANEL_MESSAGE_KEY: "duty_panel_message";
export declare function maxHours(ctx: Ctx): number;
export declare const setDutySetting: (ctx: Ctx, key: keyof typeof KEYS, value: string | null) => void;
/**
 * `DUTY-20260824-0042`, sequential within the day.
 *
 * Readable in a log and sortable, which a random id is not — somebody reading
 * the channel should be able to tell two sessions apart at a glance and know
 * roughly when each happened.
 */
export declare function nextSessionId(ctx: Ctx, now: Date): string;
/**
 * `HH:MM:SS` from the stored UTC instants.
 *
 * Deliberately not from message timestamps: an edited log, a retried post or a
 * clock-change would each produce a different answer, and the one that matters
 * is how long they were actually on duty.
 */
export declare function formatDuration(seconds: number): string;
export declare const durationBetween: (startUtc: string, endUtc: string) => number;
/** Discord renders this in each viewer's own timezone, which beats picking one. */
export declare const stamp: (iso: string) => string;
/**
 * The rank shown in the log.
 *
 * Display only — nothing is gated on it, because nothing is being gated. It
 * exists so a session log says "Moderator" rather than leaving whoever reads it
 * to work out who that was.
 */
export declare function rankOf(roleIds: readonly string[], ranks: ReadonlyArray<{
    roleId: string;
    label: string;
}>): string;
export declare function buildDutyPanel(): EmbedBuilder;
export declare const dutyPanelRows: () => ActionRowBuilder<ButtonBuilder>[];
export declare function buildStartLog(session: DutySession, username: string): EmbedBuilder;
export declare function buildEndLog(session: DutySession, username: string): EmbedBuilder;
export declare function buildActiveEmbed(sessions: DutySession[], now?: Date): EmbedBuilder;
export declare function buildHistoryEmbed(sessions: DutySession[], userId: string): EmbedBuilder;
export type StartOutcome = {
    ok: true;
    session: DutySession;
} | {
    ok: false;
    reason: string;
};
/**
 * Opens a session and puts the role on.
 *
 * Order matters. The row goes in first, because it is the record and the role
 * is only a picture of it — and if the role cannot be granted the session still
 * stands, with the failure reported rather than swallowed. The reverse order
 * would leave somebody wearing a badge for a session that does not exist.
 */
export declare function goOnDuty(ctx: Ctx, member: {
    id: string;
    roles: {
        cache: {
            has: (id: string) => boolean;
        };
        add: (id: string) => Promise<unknown>;
    };
}, rank: string, method: StartMethod, log: (m: string) => void): Promise<StartOutcome>;
export type EndOutcome = {
    ok: true;
    session: DutySession;
} | {
    ok: false;
    reason: string;
};
/**
 * Closes a session and takes the role off.
 *
 * The close is a conditional update, so a second press, a timeout firing at the
 * same moment, and a forced end all race safely — exactly one wins and the
 * duration is written once.
 */
export declare function goOffDuty(ctx: Ctx, member: {
    id: string;
    roles: {
        remove: (id: string) => Promise<unknown>;
    };
} | null, discordUserId: string, reason: EndReason | string, log: (m: string) => void): Promise<EndOutcome>;
/** The ranks shown in a log, seniors first so the higher one wins. */
export declare function ranksFor(ctx: Ctx): Array<{
    roleId: string;
    label: string;
}>;
export declare const isStaff: (ctx: Ctx, roleIds: readonly string[]) => boolean;
export declare const isSenior: (ctx: Ctx, roleIds: readonly string[]) => boolean;
/**
 * Posts the start log and remembers where, so the completion can edit it.
 *
 * Never throws. A session that happened is worth more than a message about it,
 * so a missing or forbidden channel is logged and the session stands.
 */
export declare function postStartLog(ctx: Ctx, client: Client, session: DutySession, username: string, log: (m: string) => void): Promise<void>;
/**
 * Turns the start log into the completed one, or posts a fresh message.
 *
 * Editing keeps a session to one entry, which is what makes the channel
 * readable. When the original is gone — deleted, or the channel changed since —
 * a new message carrying the same session id is posted instead, so the record
 * is never simply absent.
 */
export declare function postEndLog(ctx: Ctx, client: Client, session: DutySession, username: string, log: (m: string) => void): Promise<void>;
/** Returns true when the interaction was ours. */
export declare function handleDuty(ctx: Ctx, interaction: ButtonInteraction, log: (m: string) => void): Promise<boolean>;
/**
 * Closes sessions that outlived their limit, and everything left open by a
 * restart.
 *
 * Run on startup and on a timer. Closing on startup is the safe default: a row
 * saying "active" after the bot has been down says only that nobody pressed the
 * button, not that somebody is still working.
 */
export declare function reconcileDuty(ctx: Ctx, client: Client, log: (m: string) => void, { onStartup }?: {
    onStartup?: boolean;
}): Promise<number>;
export {};
