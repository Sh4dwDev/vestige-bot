import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
/** How many are paid when a week ends. */
export declare const PODIUM = 3;
export declare const weeklyEnabled: (ctx: Ctx) => boolean;
export declare const setWeeklyEnabled: (ctx: Ctx, on: boolean) => void;
export declare const weeklyChannel: (ctx: Ctx) => string | null;
export declare const setWeeklyChannel: (ctx: Ctx, channelId: string | null) => void;
export declare const weeklySkin: (ctx: Ctx) => string | null;
export declare const setWeeklySkin: (ctx: Ctx, preset: string | null) => void;
export interface WeeklyRow {
    steamId: string;
    points: number;
}
export declare function buildWeeklyEmbed(week: string, rows: WeeklyRow[], nameFor: (steamId: string) => string, options?: {
    final?: boolean;
    skin?: string | null;
}): EmbedBuilder;
export interface WeekClosed {
    week: string;
    winners: WeeklyRow[];
    skin: string | null;
}
/**
 * Ends a week: pays the podium, announces, and remembers it is done.
 *
 * Recording the week as closed **before** granting anything is deliberate. If
 * the grant half fails the worst case is somebody missing a skin, which is a
 * message away from fixed; the other order risks a restart mid-close paying the
 * same podium twice, and taking a prize back is far worse than handing one out.
 */
export declare function closeWeek(ctx: Ctx, client: Client, week: string, log: (m: string) => void): Promise<WeekClosed | null>;
/**
 * Called from the minute tick. Closes the previous week the first time the
 * clock says a new one has started.
 *
 * The week that just ended is derived by looking back a few days rather than
 * from anything stored, so a bot that was switched off over the weekend still
 * closes the right week when it comes back.
 */
export declare function runWeekly(ctx: Ctx, client: Client, log: (m: string) => void, at?: Date): Promise<void>;
