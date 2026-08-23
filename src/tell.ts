import type { Ctx } from './commands.js';

/**
 * Telling one player something, without stealing their prime checklist.
 *
 * There are two ways to put text on somebody's screen, and they are not
 * interchangeable:
 *
 * - `ClientShowNotification` is **persistent** — it stays until something
 *   replaces it. It is also literally the widget the game uses for the prime
 *   conditions list. One slot, last writer wins.
 * - RCON `directmessage` is the ANNOUNCEMENT banner: about a second, then gone,
 *   and it leaves the prime list alone.
 *
 * The persistent one was the obvious choice and it was wrong. Reported live:
 * prime conditions stopped updating in game while `/prime` in Discord showed
 * them changing correctly — because the flags were fine and the widget had been
 * evicted by a bot notice. The game only redraws that list when a condition
 * next changes, so a single notice hides it for as long as nothing moves.
 *
 * So the banner is the default. It is easier to miss, which is a real cost, but
 * a notice nobody reads is a smaller problem than permanently hiding the
 * checklist the game spent the feature on.
 *
 * `persist: true` is available for the rare thing worth taking the slot for,
 * and the whole default is a setting for a server that would rather have it the
 * other way.
 */

const STYLE_KEY = 'notice_style';

export type NoticeStyle = 'banner' | 'persistent';

export function noticeStyle(ctx: Ctx): NoticeStyle {
  return ctx.db.getSetting(STYLE_KEY) === 'persistent' ? 'persistent' : 'banner';
}

export const setNoticeStyle = (ctx: Ctx, style: NoticeStyle): void =>
  ctx.db.setSetting(STYLE_KEY, style);

/**
 * Puts a line on one player's screen.
 *
 * Never throws: a notice is always a nicety on top of something that has
 * already happened, and failing to show one must not fail the action.
 */
export async function tell(
  ctx: Ctx,
  steamId: string,
  message: string,
  { persist = false }: { persist?: boolean } = {},
): Promise<boolean> {
  const style = persist ? 'persistent' : noticeStyle(ctx);

  try {
    if (style === 'persistent') return await ctx.mod.notify(steamId, message);

    await ctx.rcon.directMessage(steamId, message);
    return true;
  } catch {
    return false;
  }
}

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
export async function tellEveryone(
  ctx: Ctx,
  message: string,
  { persist = false }: { persist?: boolean } = {},
): Promise<number> {
  let players: Array<{ steamId: string }> = [];
  try {
    players = await ctx.rcon.players();
  } catch {
    return 0;
  }

  let told = 0;
  for (const player of players) {
    if (await tell(ctx, player.steamId, message, { persist })) told += 1;
  }
  return told;
}
