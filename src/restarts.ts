import { EmbedBuilder, type Client } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';

/**
 * Scheduled restarts, with warnings.
 *
 * Restarts land on fixed clock times rather than "six hours after the bot last
 * started", so players can learn them and the schedule survives a bot restart.
 * With a six hour interval that is 00:00, 06:00, 12:00 and 18:00 UTC.
 *
 * The bot cannot restart the server itself — Evrima's RCON has no such command
 * — so the panel does it. What the bot owns is the countdown, the warnings, and
 * saving the world first.
 */

const CHANNEL_KEY = 'restart_channel';
const ROLE_KEY = 'restart_role';
const HOURS_KEY = 'restart_hours';
const ENABLED_KEY = 'restart_enabled';

export const DEFAULT_INTERVAL_HOURS = 6;

/** Minutes before a restart at which players are told, in game. */
export const WARNINGS = [60, 30, 15, 5, 1] as const;

/** Also posted to Discord; the rest are in game only. */
const DISCORD_WARNINGS = new Set([60, 15, 5]);

/**
 * The next restart at or after `now`, aligned to midnight UTC.
 *
 * Exported and pure because every subtle bug in a scheduler is an off-by-one at
 * a boundary — exactly on the hour, or across midnight.
 */
export function nextRestart(now: Date, intervalHours: number): Date {
  const interval = Math.max(1, Math.floor(intervalHours));
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const msPerSlot = interval * 3_600_000;

  const elapsed = now.getTime() - dayStart;
  const slotsDone = Math.floor(elapsed / msPerSlot);
  const candidate = dayStart + (slotsDone + 1) * msPerSlot;

  return new Date(candidate);
}

/** Whole minutes until the restart, rounded up so "1 minute" never reads as 0. */
export function minutesUntil(now: Date, restart: Date): number {
  return Math.ceil((restart.getTime() - now.getTime()) / 60_000);
}

// ---------------------------------------------------------------- settings --

export interface RestartSettings {
  enabled: boolean;
  intervalHours: number;
  channelId: string | null;
  roleId: string | null;
}

export function restartSettings(ctx: Ctx): RestartSettings {
  const hours = Number.parseInt(ctx.db.getSetting(HOURS_KEY) ?? '', 10);
  return {
    enabled: ctx.db.getSetting(ENABLED_KEY) === '1',
    intervalHours: Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_INTERVAL_HOURS,
    channelId: ctx.db.getSetting(CHANNEL_KEY) || null,
    roleId: ctx.db.getSetting(ROLE_KEY) || null,
  };
}

export function setRestartsEnabled(ctx: Ctx, enabled: boolean): void {
  ctx.db.setSetting(ENABLED_KEY, enabled ? '1' : '0');
}

export function setRestartInterval(ctx: Ctx, hours: number): void {
  ctx.db.setSetting(HOURS_KEY, String(hours));
}

export function setRestartAnnounce(ctx: Ctx, channelId: string, roleId: string | null): void {
  ctx.db.setSetting(CHANNEL_KEY, channelId);
  ctx.db.setSetting(ROLE_KEY, roleId ?? '');
}

// ------------------------------------------------------------------ notice --

function inGameWarning(minutes: number): string {
  return minutes === 1
    ? `${SERVER} restarts in 1 minute. Get somewhere safe and log out.`
    : `${SERVER} restarts in ${minutes} minutes. Find somewhere safe.`;
}

export function buildRestartEmbed(minutes: number, restart: Date): EmbedBuilder {
  const stamp = `<t:${Math.floor(restart.getTime() / 1000)}:t>`;
  const relative = `<t:${Math.floor(restart.getTime() / 1000)}:R>`;

  return new EmbedBuilder()
    .setColor(minutes <= 5 ? 0xed4245 : minutes <= 15 ? 0xfee75c : 0x5865f2)
    .setTitle(minutes <= 5 ? '⚠️  Restart imminent' : '🔄  Scheduled restart')
    .setDescription(
      `${SERVER} restarts ${relative}, at ${stamp}.\n\n` +
      (minutes <= 5
        ? '**Log out somewhere safe now.** Anything you are in the middle of will be interrupted.'
        : 'Find a safe spot before then. The world is saved first, so nothing is lost — ' +
          'but being mid-fight through a restart is nobody’s favourite.'),
    )
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

// ------------------------------------------------------------------ runner --

/**
 * Warns, saves, and asks the panel to restart.
 *
 * Ticks every 20 seconds. Each warning fires once per cycle, tracked against
 * the restart's own timestamp so a bot restart mid-cycle cannot replay warnings
 * that already went out.
 */
export function startRestartScheduler(ctx: Ctx, client: Client, log: (m: string) => void): void {
  let cycle = 0;
  const sent = new Set<number>();
  let restarting = false;
  /** The role is mentioned once per restart; later notices post silently. */
  let pinged = false;

  const tick = async (): Promise<void> => {
    const settings = restartSettings(ctx);
    if (!settings.enabled) return;

    const now = new Date();
    const restart = nextRestart(now, settings.intervalHours);

    // A new cycle: forget what was announced for the previous one.
    if (restart.getTime() !== cycle) {
      cycle = restart.getTime();
      sent.clear();
      restarting = false;
      pinged = false;
    }

    const minutes = minutesUntil(now, restart);

    // Fire the largest warning we have passed but not yet sent, so a bot that
    // was offline over a threshold still warns rather than skipping silently.
    const due = WARNINGS.filter((w) => minutes <= w && !sent.has(w));
    const warning = due.length ? Math.max(...due) : null;

    if (warning !== null) {
      for (const w of due) sent.add(w);
      const shouldPing = !pinged && DISCORD_WARNINGS.has(warning as 60);
      if (shouldPing) pinged = true;
      await announce(ctx, client, settings, warning, restart, log, shouldPing);
    }

    // Within the last 20 seconds: save, then hand over to the panel.
    if (minutes <= 0 && !restarting) {
      restarting = true;
      await performRestart(ctx, log);
    }
  };

  setInterval(() => void tick(), 20_000).unref();
  void tick();
}

async function announce(
  ctx: Ctx,
  client: Client,
  settings: RestartSettings,
  minutes: number,
  restart: Date,
  log: (m: string) => void,
  ping: boolean,
): Promise<void> {
  try {
    await ctx.rcon.announce(inGameWarning(minutes));
  } catch (err) {
    log(`restart: in-game warning failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!settings.channelId || !DISCORD_WARNINGS.has(minutes as 60)) return;

  try {
    const channel = await client.channels.fetch(settings.channelId).catch(() => null);
    if (channel?.isTextBased() && 'send' in channel) {
      // Only the first notice of a cycle mentions the role. The later ones
      // still post, they just do not buzz everybody again.
      await channel.send({
        content: ping && settings.roleId ? `<@&${settings.roleId}>` : undefined,
        embeds: [buildRestartEmbed(minutes, restart)],
      });
    }
  } catch (err) {
    log(`restart: Discord warning failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  log(`restart: warned ${minutes} minute(s) out`);
}

/**
 * Restart on demand, with a short countdown.
 *
 * This is the documented fix for stuck AI, wedged herds and similar: upstream
 * is explicit that clearing AI from Lua crashes the server, and that a restart
 * is the only supported cleanup. So the tool for "something is broken, fix it
 * now" is this, not a destroy path.
 */
export async function restartNow(
  ctx: Ctx,
  minutes: number,
  log: (m: string) => void,
): Promise<string> {
  if (!ctx.panel) {
    return 'No control panel is configured, so the bot cannot restart the server. ' +
      'It can still warn players — set PANEL_URL, PANEL_API_KEY and PANEL_SERVER_ID.';
  }

  log(`restart: manual restart requested in ${minutes} minute(s)`);

  if (minutes > 0) {
    await ctx.rcon
      .announce(`${SERVER} restarts in ${minutes} minute${minutes === 1 ? '' : 's'}. ` +
        'Find somewhere safe.')
      .catch(() => undefined);

    // A one minute warning as well, unless the whole wait is a minute.
    if (minutes > 1) {
      setTimeout(() => {
        void ctx.rcon
          .announce(`${SERVER} restarts in 1 minute. Get somewhere safe and log out.`)
          .catch(() => undefined);
      }, (minutes - 1) * 60_000);
    }

    await new Promise((resolve) => setTimeout(resolve, minutes * 60_000));
  }

  await performRestart(ctx, log);
  return 'done';
}

async function performRestart(ctx: Ctx, log: (m: string) => void): Promise<void> {
  // Save first, always. A restart that loses the world is far worse than a
  // late one, so this is not skipped even if the panel call later fails.
  try {
    await ctx.rcon.save();
    log('restart: world saved');
  } catch (err) {
    log(`restart: SAVE FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!ctx.panel) {
    log('restart: no panel configured — the host must restart it');
    return;
  }

  try {
    await ctx.panel.power('restart');
    log('restart: panel accepted the restart');
  } catch (err) {
    log(`restart: PANEL RESTART FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}
