import type { Ctx } from './commands.js';
export type NoticeStyle = 'banner' | 'persistent';
export declare function noticeStyle(ctx: Ctx): NoticeStyle;
export declare const setNoticeStyle: (ctx: Ctx, style: NoticeStyle) => void;
/**
 * Puts a line on one player's screen.
 *
 * Never throws: a notice is always a nicety on top of something that has
 * already happened, and failing to show one must not fail the action.
 */
export declare function tell(ctx: Ctx, steamId: string, message: string, { persist }?: {
    persist?: boolean;
}): Promise<boolean>;
/**
 * The same line, on everybody's screen.
 *
 * There is no broadcast form of the persistent notice — it is a client RPC on
 * one controller — so a server-wide one means looping the online list. That is
 * one round trip per player, which is why it is reserved for the few things
 * worth it rather than offered as a general broadcast.
 *
 * Returns how many were told. Failures are counted out rather than thrown: half
 * the server seeing a cleanup warning is better than none of it.
 */
export declare function tellEveryone(ctx: Ctx, message: string, { persist }?: {
    persist?: boolean;
}): Promise<number>;
