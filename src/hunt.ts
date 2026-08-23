import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
import { hud } from './contest.js';

/**
 * One player is the quarry. Kill them and the prize is yours; keep them alive
 * to the end and nobody gets anything.
 *
 * The whole event rests on the killfeed knowing **who** killed whom, which is
 * exactly what the damage hook records. A quarry who breaks off wounded and
 * bleeds out still pays whoever last hit them — that is how most fights here
 * actually end, and calling it a survival made the fight look like it never
 * happened. Drowning, starving and wildlife still leave nobody to pay, and
 * those are treated as the quarry surviving rather than quietly awarding it to
 * whoever was nearest: guessing a winner is worse than having none.
 *
 * Position is announced on a timer rather than continuously. A quarry whose
 * exact spot is always known cannot play, and one who is never located cannot
 * be found — a stale fix every few minutes is what makes it a hunt.
 */

const KEY = 'hunt_state';

export interface Hunt {
  /** Steam ID of the quarry. */
  targetSteam: string;
  /** For announcements, since Steam IDs mean nothing to players. */
  targetName: string;
  /**
   * What they were last seen playing.
   *
   * Kept on the hunt rather than looked up when needed, because it has to
   * survive them being offline or unlocatable — and it is refreshed on every
   * position call, so a target who dies and comes back on something else is
   * described correctly from the next call onwards.
   */
  targetSpecies?: string;
  reward: number;
  skin?: string;
  /** When it ends, whatever has happened. */
  endsAt: number;
  /** How often the quarry's position goes out. */
  revealEveryMs: number;
  /** Last time it did, so the timer survives a restart. */
  lastRevealAt: number;
  startedAt: number;
}

export function activeHunt(ctx: Ctx): Hunt | null {
  const raw = ctx.db.getSetting(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Hunt>;
    return typeof parsed.targetSteam === 'string' && typeof parsed.endsAt === 'number'
      ? (parsed as Hunt)
      : null;
  } catch {
    return null;
  }
}

export const saveHunt = (ctx: Ctx, hunt: Hunt | null): void =>
  ctx.db.setSetting(KEY, hunt ? JSON.stringify(hunt) : '');

export type HuntStep =
  | { kind: 'reveal'; x: number; y: number; species: string }
  | { kind: 'survived' }
  | { kind: 'waiting' };

/**
 * What the hunt should do next, given the clock and where everyone is.
 *
 * Pure. A kill is handled separately because it arrives as an event rather than
 * being visible in a snapshot of positions.
 */
export function huntStep(hunt: Hunt, players: PlayerRow[], now: number): HuntStep {
  if (now >= hunt.endsAt) return { kind: 'survived' };

  if (now - hunt.lastRevealAt < hunt.revealEveryMs) return { kind: 'waiting' };

  const target = players.find((p) => p.steam === hunt.targetSteam);
  // Offline or unlocatable: nothing to say, and saying nothing is better than
  // announcing a position from ten minutes ago as though it were current.
  if (!target || target.x === undefined || target.y === undefined) {
    return { kind: 'waiting' };
  }

  return { kind: 'reveal', x: target.x, y: target.y, species: target.species };
}

/** ASCII only: these go out over RCON, which drops anything else silently. */
export const huntAnnounce = (hunt: Hunt): string =>
  `HUNT: ${hunt.targetName} is the target`
  + (hunt.targetSpecies ? ` (${hunt.targetSpecies})` : '')
  + `. Kill them for ${hunt.reward} points. `
  + `Their position is called out every ${Math.round(hunt.revealEveryMs / 60000)} minutes.`;

export const revealAnnounce = (
  hunt: Hunt,
  x: number,
  y: number,
  species: string,
): string =>
  `HUNT: ${hunt.targetName} was last seen at Lat ${hud(y)}, Long ${hud(x)}`
  + (species ? ` playing ${species}.` : '.');

export const caughtAnnounce = (hunt: Hunt, killer: string): string =>
  `HUNT: ${killer} killed ${hunt.targetName} and takes ${hunt.reward} points.`;

export const survivedAnnounce = (hunt: Hunt): string =>
  `HUNT: ${hunt.targetName} survived. Nobody wins.`;

export function buildHuntEmbed(hunt: Hunt, state: 'running' | 'caught' | 'survived',
  killer?: string): EmbedBuilder {
  const colour = state === 'caught' ? 0x57f287 : state === 'survived' ? 0xed4245 : 0xfee75c;

  return new EmbedBuilder()
    .setColor(colour)
    .setTitle(state === 'running' ? `🎯  Hunt: ${hunt.targetName}` : `🎯  Hunt over`)
    .setDescription(
      state === 'caught'
        ? `**${killer}** killed **${hunt.targetName}**` +
          (hunt.targetSpecies ? ` *(${hunt.targetSpecies})*` : '') + ' and takes ' +
          `**${hunt.reward}** points` +
          (hunt.skin ? ` and the **${hunt.skin}** skin` : '') + '.'
        : state === 'survived'
          ? `**${hunt.targetName}** survived. Nobody wins.\n\n` +
            'It has to be a player kill — drowning, starving or wildlife ' +
            'leaves nobody to pay.'
          : `**${hunt.targetName}** is the target` +
            (hunt.targetSpecies ? `, playing **${hunt.targetSpecies}**` : '') +
            '.\n\n' +
            `🏆 **${hunt.reward}** points` +
            (hunt.skin ? ` and the **${hunt.skin}** skin` : '') +
            ' to whoever kills them.\n' +
            `📢 Their position is called out every ` +
            `**${Math.round(hunt.revealEveryMs / 60000)} minutes**.\n` +
            `⏳ Ends <t:${Math.floor(hunt.endsAt / 1000)}:R>.`,
    )
    .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
    .setTimestamp();
}

const CHANNEL_KEY = 'hunt_channel';

export const huntChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(CHANNEL_KEY) || null;

export const setHuntChannel = (ctx: Ctx, channelId: string | null): void =>
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');

/**
 * Pays the killer and ends it.
 *
 * Called from the kill handler rather than the poll: a death is an event, and
 * looking for it in a snapshot of who is alive would miss anybody who died and
 * respawned between two readings.
 *
 * Returns the hunt that was ended, or null when this kill had nothing to do
 * with one.
 */
export function claimHunt(ctx: Ctx, killerSteam: string, victimSteam: string): Hunt | null {
  const hunt = activeHunt(ctx);
  if (!hunt || victimSteam !== hunt.targetSteam) return null;

  // The quarry killing themselves, by slay or otherwise, is not a win for
  // anybody. Nor is it a survival — it just ends.
  if (!killerSteam || killerSteam === hunt.targetSteam) {
    saveHunt(ctx, null);
    return null;
  }

  ctx.db.addPoints(killerSteam, hunt.reward, 0);
  if (hunt.skin) ctx.db.grantSkin(killerSteam, hunt.skin, `Won the hunt for ${hunt.targetName}`);
  saveHunt(ctx, null);

  return hunt;
}

/**
 * Marks a reveal as done, so the timer advances even if announcing fails.
 *
 * The species is refreshed at the same time: it is only knowable while they are
 * locatable, and this is the one moment we know they were.
 */
export const markRevealed = (
  ctx: Ctx,
  hunt: Hunt,
  now: number,
  species?: string,
): void =>
  saveHunt(ctx, {
    ...hunt,
    lastRevealAt: now,
    ...(species ? { targetSpecies: species } : {}),
  });
