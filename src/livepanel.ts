import type { Client } from 'discord.js';

import type { Ctx } from './commands.js';
import { postOrEdit } from './pinned.js';
import { buildPopulationEmbed } from './population.js';
import { expireOldSkins, forgetAllPainted, reapplySkins } from './skinsync.js';
import { checkEvents, tellPlayersInEvents } from './events.js';
import { checkSpeciesLocks } from './species.js';
import { tierOf } from './tiers.js';

/**
 * The population embed that lives in a channel and edits itself.
 *
 * It is one message, updated in place — posting a new one each minute would
 * bury the channel. The message id is kept in the database so a bot restart
 * keeps editing the same message rather than leaving a graveyard behind.
 *
 * It always renders. An empty server and an unreachable server both get an
 * embed, because a panel that disappears looks broken.
 */

const CHANNEL_KEY = 'population_channel';
const MESSAGE_KEY = 'population_message';
const INTERVAL_MS = 60_000;

export function setPopulationChannel(ctx: Ctx, channelId: string | null): void {
  if (channelId === null) {
    ctx.db.setSetting(CHANNEL_KEY, '');
  } else {
    ctx.db.setSetting(CHANNEL_KEY, channelId);
  }
  // The old message belongs to the old channel; forget it so the next update
  // posts fresh rather than trying to edit something out of reach.
  ctx.db.setSetting(MESSAGE_KEY, '');
}

export function populationChannel(ctx: Ctx): string | null {
  return ctx.db.getSetting(CHANNEL_KEY) || null;
}

/** Renders once, immediately. Used when an admin sets the channel. */
export async function refreshPopulationPanel(ctx: Ctx, client: Client): Promise<void> {
  const channelId = populationChannel(ctx);
  if (!channelId) return;

  let embed;
  try {
    embed = buildPopulationEmbed(await ctx.mod.players(), {
      live: true,
      caps: ctx.db.speciesCaps(),
      tierOf: (species) => tierOf(ctx, species),
    });
  } catch {
    // An unreachable server still gets an embed; a panel that vanishes when the
    // server hiccups looks broken.
    embed = buildPopulationEmbed([], { live: true, unreachable: true });
  }

  await postOrEdit(ctx.db, client, channelId, MESSAGE_KEY, [embed]);
}

export function startPopulationPanel(ctx: Ctx, client: Client, log: (m: string) => void): void {
  let lastFailure = '';
  let serverWasDown = false;

  // Five minutes. Cheap insurance against any case where a pawn was replaced
  // without the bot observing it.
  const SWEEP_EVERY = 5;
  let sinceSweep = 0;

  const tick = async (): Promise<void> => {
    // Lock checking is independent of the panel: caps still matter when nobody
    // has set a population channel.
    await ctx.mod
      .players()
      .then(async (players) => {
        // Coming back from an unreachable server means everyone has a new
        // pawn, but the bot never saw them leave — so forget what was painted
        // rather than assuming it survived.
        if (serverWasDown) {
          serverWasDown = false;
          forgetAllPainted();
          log('skins: server was unreachable, repainting everyone');
        }

        // A periodic sweep catches the rest: a player who relogs entirely
        // between two polls is never observed absent either.
        sinceSweep += 1;
        if (sinceSweep >= SWEEP_EVERY) {
          sinceSweep = 0;
          forgetAllPainted();
        }

        await checkSpeciesLocks(ctx, client, players, log);

        // Shares the same counts: a species over its cap is both a lock and a
        // cull event, and neither costs an extra round trip.
        await checkEvents(ctx, client, players, log);

        // And tell the people actually playing an endangered species, which a
        // server-wide announcement does not do.
        await tellPlayersInEvents(ctx, players, log);
        // Forget looks nobody has worn for hours, before repainting: otherwise
        // a colour set once is reapplied to the next animal of that species
        // days later.
        expireOldSkins(ctx, log);

        // Colours do not survive a relog, respawn or restart, so they are
        // reapplied from the record rather than expected to stick.
        await reapplySkins(ctx, players, log);
      })
      .catch(() => {
        serverWasDown = true;
      });

    if (!populationChannel(ctx)) return;
    try {
      await refreshPopulationPanel(ctx, client);
      lastFailure = '';
    } catch (err) {
      // Log a repeating failure once, not sixty times an hour.
      const message = err instanceof Error ? err.message : String(err);
      if (message !== lastFailure) {
        lastFailure = message;
        log(`population panel: ${message}`);
      }
    }
  };

  setInterval(() => void tick(), INTERVAL_MS).unref();
  void tick();
}
