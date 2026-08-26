import { EmbedBuilder } from 'discord.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './population.js';
export declare const DEFAULT_RATE_PER_HOUR = 60;
export declare function linkBonus(ctx: Ctx): number;
export declare function setLinkBonus(ctx: Ctx, amount: number): void;
/** Pays it if this account has never been paid. Returns what was paid. */
export declare function payLinkBonus(ctx: Ctx, steamId: string): number;
export declare function ratePerHour(ctx: Ctx): number;
export declare function setRatePerHour(ctx: Ctx, rate: number): void;
/**
 * How much to pay for a gap of `elapsedMs`, and how many minutes that counts
 * as. Pure, because the capping rule is the part worth testing.
 */
export declare function awardFor(elapsedMs: number, rate: number): {
    points: number;
    minutes: number;
};
/**
 * Pays everyone currently playing, scaled by the tier of what they are on.
 *
 * Takes the mod's player rows rather than a list of Steam IDs, because the tier
 * depends on the species — which means someone sitting on the spawn screen
 * earns nothing. That is the intended reading of "earned by playing".
 *
 * `at` is a parameter rather than a `new Date()` inside, because the weekend
 * bonus makes this depend on the clock — and a payout that behaves differently
 * on a Saturday is untestable when the time is hidden. The tier tests failed on
 * a Saturday for exactly that reason.
 */
export declare function awardOnline(ctx: Ctx, players: PlayerRow[], elapsedMs: number, at?: Date): number;
/** Floored: showing 41.7 points invites arguments about rounding. */
export declare const display: (balance: number) => number;
export declare function buildBalanceEmbed(balance: number, minutes: number, rate: number, 
/** Told to the player: a bonus nobody knows about changes nobody's behaviour. */
weekend?: {
    bonus: number;
    active: boolean;
    window: WeekendWindow;
}): EmbedBuilder;
export declare function buildLeaderboardEmbed(rows: Array<{
    steamId: string;
    balance: number;
    minutes: number;
}>, nameFor: (steamId: string) => string): EmbedBuilder;
export interface WeekendWindow {
    startDay: number;
    startHour: number;
    endDay: number;
    endHour: number;
}
export declare function weekendBonus(ctx: Ctx): number;
export declare function setWeekendBonus(ctx: Ctx, perHour: number): void;
export declare function weekendWindow(ctx: Ctx): WeekendWindow;
export declare function setWeekendWindow(ctx: Ctx, window: WeekendWindow): void;
/** Day and hour in Oslo, whatever the host's clock is set to. */
export declare function osloTime(at: Date): {
    day: number;
    hour: number;
    minute: number;
};
/**
 * Whether a moment falls in the weekend window.
 *
 * Compared as minutes-into-the-week so a window that runs past Sunday midnight
 * is one comparison rather than a special case. Friday evening to Monday
 * morning wraps the end of the week, which is the normal shape here, not the
 * exception.
 */
export declare function isWeekend(at: Date, window: WeekendWindow): boolean;
export declare const weekendActive: (ctx: Ctx, at?: Date) => boolean;
/**
 * The window as real instants: the one running now, or the next one.
 *
 * Both ends are resolved independently rather than by adding a duration,
 * because a window that spans a daylight saving change is not the number of
 * hours it looks like.
 */
export declare function windowInstance(window: WeekendWindow, at?: Date): {
    start: number;
    end: number;
};
/**
 * The window, written in the reader's own timezone.
 *
 * Discord renders `<t:seconds:F>` in whatever timezone the person reading it is
 * in, which is the only way this is right for everybody. Naming a zone meant
 * every player outside Norway doing the arithmetic themselves, and getting it
 * wrong twice a year when the hour moved.
 */
export declare const describeWindow: (window: WeekendWindow, at?: Date) => string;
