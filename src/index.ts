import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type Interaction,
} from 'discord.js';

import { AdminStore } from './admins.js';
import { SERVER } from './brand.js';
import { ModBridge } from './bridge.js';
import {
  announceLinked,
  describeError,
  handleAutocomplete,
  handleCommand,
  type Ctx,
} from './commands.js';
import { loadConfig } from './config.js';
import { Database } from './db.js';
import { startPopulationPanel } from './livepanel.js';
import { handleHubInteraction } from './hub.js';
import { buildKillEmbed, killfeedChannel, type KillEvent } from './kills.js';
import { awardOnline } from './points.js';
import { Panel } from './pterodactyl.js';
import { startRestartScheduler } from './restarts.js';
import { refreshStatusPanel } from './status.js';
import { handlePanelInteraction } from './panel.js';
import { EvrimaRcon } from './rcon.js';

const log = (message: string): void => {
  console.log(`${new Date().toISOString()} ${message}`);
};

async function main(): Promise<void> {
  const config = loadConfig();
  const db = new Database(config.databaseFile);

  // If this says "new file" on every boot, the host is wiping the data
  // directory — which looks identical, from Discord, to the bot forgetting
  // everyone. Worth one line to tell those apart.
  const stats = db.stats();
  log(`database ${db.existed ? 'opened' : 'CREATED NEW'}: ${db.file}`);
  log(`  ${stats.links} link(s), ${stats.pending} pending`);

  const rcon = new EvrimaRcon({ ...config.rcon, onLog: log });
  const mod = new ModBridge(config.sftp, log);
  const admins = new AdminStore(config.sftp, config.gameIniPath, db, log);
  const panel = config.panel ? new Panel(config.panel) : null;
  const ctx: Ctx = { config, db, rcon, mod, admins, panel };

  // Fail at boot rather than on someone's first command.
  await mod.check();
  log(`mod directory OK: ${mod.modDir}`);

  try {
    const adopted = await admins.adoptExisting();
    if (adopted > 0) log(`adopted ${adopted} existing admin(s) from ${config.gameIniPath}`);
  } catch (err) {
    log(`WARNING: could not read Game.ini, /admin game will not work: ${describeError(err)}`);
  }

  if (!config.discordInvite) log('note: DISCORD_INVITE is unset, so !discord is disabled');

  // Prove the panel credentials now rather than at 3am when a restart is due.
  if (panel) {
    try {
      log(`control panel OK, server is ${await panel.check()}`);
    } catch (err) {
      log(`WARNING: control panel unusable, restarts will not fire: ${describeError(err)}`);
    }
  } else {
    log('note: no control panel configured, so restarts warn and save but cannot restart');
  }

  try {
    log(`${(await rcon.players()).length} player(s) online`);
  } catch (err) {
    log(`WARNING: RCON unavailable, linking will not work: ${describeError(err)}`);
  }

  // Slash commands only, so no privileged intents are needed.
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (ready) => {
    log(`logged in as ${ready.user.tag}`);
    startChatWatcher(ctx, ready);
    startServerPoll(ctx, ready);
    startPopulationPanel(ctx, ready, log);
    startRestartScheduler(ctx, ready, log);
  });

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    void dispatch(ctx, interaction);
  });

  await client.login(config.discord.token);

  const shutdown = (): void => {
    log('shutting down');
    void client.destroy().finally(() => {
      rcon.close();
      void Promise.all([mod.close(), admins.close()]).finally(() => {
        db.close();
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // A stray rejection anywhere else must not take the bot down silently; the
  // host would restart it and the only trace would be a gap in the log.
  process.on('unhandledRejection', (reason) => {
    log(`UNHANDLED REJECTION: ${describeError(reason)}`);
  });
}

async function dispatch(ctx: Ctx, interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) {
      await handleAutocomplete(ctx, interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      await handleCommand(ctx, interaction);
      return;
    }
    // Everything else is a button, select or modal, on either the hub panel or
    // the storage panel. The hub gets first refusal; it answers only its own.
    if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
      if (await handleHubInteraction(ctx, interaction)) return;
      await handlePanelInteraction(ctx, interaction);
    }
  } catch (err) {
    const message = describeError(err);
    console.error('interaction failed:', message);

    if (!interaction.isRepliable()) return;
    try {
      const payload = { content: `Something went wrong: ${message}` };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch {
      // The interaction token expired; nothing to do but keep running.
    }
  }
}

/**
 * Reacts to what players type in game chat: `!link CODE` and `!discord`.
 *
 * The mod appends those to its results file as they happen, so this polls
 * rather than being pushed to. Events already handled are remembered, because
 * the file keeps them until it rotates.
 */
function startChatWatcher(ctx: Ctx, client: Client): void {
  const handled = new Set<string>();
  const lastReply = new Map<string, number>();
  let primed = false;

  /**
   * The mod names events `chat-<steam>-<unix seconds>`, so their age is
   * recoverable. Zero when it cannot be parsed, which reads as "ancient" and is
   * the safe direction: ignored rather than replayed.
   */
  const secondsOld = (id: string): number => {
    const stamp = /-(\d+)$/.exec(id)?.[1];
    return stamp ? Date.now() / 1000 - Number(stamp) : Number.POSITIVE_INFINITY;
  };

  const tick = async (): Promise<void> => {
    let events;
    try {
      events = await ctx.mod.chatEvents();
    } catch {
      return; // the server is unreachable; try again next time
    }

    // On the first pass, skip what is already old — the results file keeps
    // everything, and replaying it would message people about things they typed
    // hours ago. Anything recent is still acted on, because a player who typed
    // their code seconds before the bot restarted should not have to do it
    // again. Marking the whole file handled was doing exactly that.
    if (!primed) {
      primed = true;
      for (const event of events) {
        if (secondsOld(event.id) > 120) handled.add(event.id);
      }
      const pending = events.filter((e) => !handled.has(e.id)).length;
      if (pending > 0) log(`chat: ${pending} recent event(s) carried over a restart`);
    }

    for (const event of events) {
      if (handled.has(event.id)) continue;

      // One bad event must not take down the loop. Before, an exception here
      // escaped as an unhandled rejection — which by default kills the process
      // — and the event had already been marked handled, so the link was lost
      // for good.
      try {
        await handleChatEvent(ctx, event, lastReply, client);
        handled.add(event.id);
      } catch (err) {
        log(`chat: failed to handle ${event.verb} from ${event.steam}: ${describeError(err)}`);
        // Deliberately left unhandled so the next pass retries it.
      }
    }

    // Keep the seen-set from growing without bound on a long-running bot.
    // Re-prime rather than simply clearing, so the next pass does not treat
    // every event still in the file as new.
    if (handled.size > 500) {
      handled.clear();
      primed = false;
    }
  };

  setInterval(() => void tick(), 3000).unref();
  void tick();
}

/** One chat event. Throwing here means "retry next pass". */
async function handleChatEvent(
  ctx: Ctx,
  event: { id: string; verb: string; steam: string; text: string; data?: unknown },
  lastReply: Map<string, number>,
  client?: Client,
): Promise<void> {
  if (event.verb === 'kill') {
    const raw = (event.data ?? {}) as Partial<KillEvent>;
    const kill: KillEvent = {
      killer: String(raw.killer ?? ''),
      killerSpecies: String(raw.killerSpecies ?? ''),
      victim: String(raw.victim ?? event.steam),
      species: String(raw.species ?? event.text),
      cause: String(raw.cause ?? 'health'),
    };

    ctx.db.recordKill(kill.killer, kill.victim, kill.species, kill.cause);

    const channelId = killfeedChannel(ctx);
    if (channelId && client) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased() && 'send' in channel) {
        const nameFor = (steamId: string): string => {
          const link = ctx.db.linkBySteam(steamId);
          return link ? `<@${link.discordId}>` : `\`${steamId.slice(-6)}\``;
        };
        await channel.send({ embeds: [buildKillEmbed(kill, nameFor)] });
      }
    }
    return;
  }

  if (event.verb === 'discordreq') {
    // The chat hook has been seen firing twice for one message, 9 seconds
    // apart — well outside the mod's own dedupe window — so the reply is
    // rate limited per player as well.
    const key = `${event.steam}|discord`;
    if (Date.now() - (lastReply.get(key) ?? 0) < 30_000) return;
    lastReply.set(key, Date.now());

    await sendInvite(ctx, event.steam);
    return;
  }

  // Find whoever asked for this code, and check it was them who typed it.
  const pending = ctx.db.pendingByCode(event.text.toUpperCase());
  if (!pending) return;

  if (pending.steamId !== event.steam) {
    log(`link: ${event.steam} used a code issued for ${pending.steamId} — ignored`);
    return;
  }
  if (Date.now() > pending.expiresAt) {
    ctx.db.clearPending(pending.discordId);
    log(`link: code for ${pending.discordId} had expired`);
    return;
  }

  // steam_id is UNIQUE, so saving over someone else's link would throw. Say
  // which accounts collided instead of failing with a constraint error.
  const owner = ctx.db.linkBySteam(pending.steamId);
  if (owner && owner.discordId !== pending.discordId) {
    ctx.db.clearPending(pending.discordId);
    log(`link: ${pending.steamId} already belongs to ${owner.discordId} — refused`);
    return;
  }

  ctx.db.saveLink(pending.discordId, pending.steamId);
  ctx.db.clearPending(pending.discordId);
  log(`link: ${pending.discordId} <- ${pending.steamId}`);

  // Turns their own "/link" reply into a confirmation, in the channel they are
  // already looking at and visible only to them.
  await announceLinked(pending.discordId);
}

/**
 * Answers `!discord`. The mod cannot write to game chat, so the reply goes out
 * over RCON as a direct message to that player.
 */
async function sendInvite(ctx: Ctx, steamId: string): Promise<void> {
  if (!ctx.config.discordInvite) return;
  try {
    // Short on purpose: this renders as a notification that vanishes in about
    // a second, so it has to be readable at a glance.
    await ctx.rcon.directMessage(steamId, `${SERVER} Discord: ${ctx.config.discordInvite}`);
    log(`discord: sent invite to ${steamId}`);
  } catch (err) {
    log(`discord: could not message ${steamId}: ${describeError(err)}`);
  }
}

/**
 * One poll a minute drives everything that needs to know whether the server is
 * up: the bot's status, and the Game.ini reconciler. They share a single RCON
 * call rather than each asking separately.
 *
 * The reconciler matters because the server rewrites its own config when it
 * stops, so an edit made while it runs is thrown away. Being down is the only
 * durable moment, which is why this watches for it — and why a restart is all
 * an operator ever has to do.
 */
function startServerPoll(ctx: Ctx, client: Client<true>): void {
  let previous: number | null | undefined;
  let lastAward = Date.now();

  const tick = async (): Promise<void> => {
    const players = await ctx.rcon.players().catch(() => null);
    const online = players?.length ?? null;

    // Points accrue against this poll rather than a timer of their own, so a
    // player is only ever paid for time they were actually seen online.
    if (players !== null) {
      const elapsed = Date.now() - lastAward;
      lastAward = Date.now();
      try {
        awardOnline(ctx, players.map((p) => p.steamId), elapsed);
      } catch (err) {
        log(`points: award failed: ${describeError(err)}`);
      }
    } else {
      // Do not bank time while the server is unreachable — nobody is playing.
      lastAward = Date.now();
    }

    // Before the status, because reading Game.ini is also what refreshes the
    // slot count the status wants to show.
    try {
      const outcome = await ctx.admins.reconcile(online !== null);
      if (outcome === 'applied') log('admins: Game.ini written while the server was down');
    } catch {
      // SFTP hiccup, or a config being rewritten right now; next pass retries.
    }

    setStatus(client, online, ctx.admins.maxPlayers);

    // Shares this poll rather than running its own, so the panel and the bot's
    // own status can never disagree.
    await refreshStatusPanel(ctx, client, online).catch(() => undefined);

    // Only on a change, so an idle server does not fill the log — and so a
    // drop-out is obvious when reading it back.
    if (online !== previous) {
      previous = online;
      log(online === null ? 'status: server not responding' : `status: ${online} online`);
    }
  };

  // A minute is also comfortably inside Discord's presence rate limit.
  setInterval(() => void tick(), 60_000).unref();
  void tick();
}

/** `online: null` means the server did not answer; `max: null` means Game.ini has not been read. */
function setStatus(client: Client<true>, online: number | null, max: number | null): void {
  if (online === null) {
    client.user.setPresence({
      status: 'idle',
      activities: [{ name: `${SERVER} restart`, type: ActivityType.Watching }],
    });
    return;
  }

  client.user.setPresence({
    status: 'online',
    activities: [{
      name: max === null ? `${online} player${online === 1 ? '' : 's'}` : `${online}/${max} players`,
      type: ActivityType.Watching,
    }],
  });
}

main().catch((err: unknown) => {
  console.error(describeError(err));
  process.exit(1);
});
