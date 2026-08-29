import type { Ctx } from './commands.js';
/** Per day of streak. Day three pays three times this, up to the cap. */
export declare const DEFAULT_STEP = 40;
/**
 * The most a day can pay, however long the streak.
 *
 * Without it a streak of ninety pays more for logging in than a full evening of
 * playing, and the reward stops being a nudge and becomes the whole game.
 */
export declare const DEFAULT_CAP = 400;
export declare const streaksEnabled: (ctx: Ctx) => boolean;
export declare const setStreaksEnabled: (ctx: Ctx, on: boolean) => void;
export declare const streakStep: (ctx: Ctx) => number;
export declare const streakCap: (ctx: Ctx) => number;
export declare const setStreakRewards: (ctx: Ctx, step: number, cap: number) => void;
/**
 * Today's date in Oslo, as `YYYY-MM-DD`.
 *
 * Oslo rather than UTC because the day has to end when people stop playing. On
 * UTC the boundary lands at one or two in the morning local time, which is
 * exactly when somebody is still on, and they would lose a streak they were in
 * the middle of extending.
 */
export declare function osloDay(at?: Date): string;
/** The day before a given `YYYY-MM-DD`, in the same calendar. */
export declare function dayBefore(day: string): string;
export interface StreakState {
    lastDay: string;
    streak: number;
    best: number;
}
export type StreakStep = 
/** Already counted today; nothing owed. */
{
    kind: 'counted';
}
/** A day was added, or the streak started again. */
 | {
    kind: 'extended';
    state: StreakState;
    broken: boolean;
};
/**
 * What today does to a streak. Pure, so the calendar cases are testable.
 *
 * Missing a day resets to one rather than to zero: somebody who comes back
 * after a week is on day one of a new streak, not on nothing, and telling them
 * they have nothing is how you lose them a second time.
 */
export declare function nextStreak(previous: StreakState | null, today: string): StreakStep;
export declare const streakBonus: (streak: number, step: number, cap: number) => number;
/**
 * The days worth interrupting somebody for.
 *
 * Not every day. The reward arrives whatever happens, but a full-width banner
 * every single evening becomes wallpaper by the third one, and day one is the
 * least interesting of the lot. These are spaced so that seeing one means you
 * have got somewhere, and the gaps between them grow as the run does.
 */
export declare const MILESTONES: readonly [3, 7, 14, 30, 60, 100];
export declare const isMilestone: (streak: number) => boolean;
/**
 * What the player is told, on the days they are told anything.
 *
 * Short, because it renders in the game's announcement banner, which is one
 * line of a fixed width and appends its own punctuation.
 */
export declare function streakNotice(streak: number, bonus: number): string;
export interface StreakAward {
    steamId: string;
    streak: number;
    bonus: number;
    broken: boolean;
    /** Whether this is one of the days worth telling them about in game. */
    milestone: boolean;
}
/**
 * Counts today for everybody online, and pays whoever had not been counted yet.
 *
 * Called from the minute tick, so being on at all is what counts. Requiring a
 * length of time would mean the reward for coming back arrives late enough that
 * somebody checking in for five minutes never sees it, and those are exactly
 * the people this is for.
 *
 * Never throws: this sits on top of the ordinary payout and must not be able to
 * stop it.
 */
export declare function recordPlay(ctx: Ctx, steamIds: string[], at?: Date): StreakAward[];
