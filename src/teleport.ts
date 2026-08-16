import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Client,
} from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';

/**
 * Teleporting to a friend, with their consent.
 *
 * Consent can come from either side of the fence — a button in Discord, or
 * `!accept` in game chat — because the person being asked is playing, and
 * making them alt-tab to answer is how a feature goes unused.
 *
 * Requests live in memory only. They expire in two minutes, so a bot restart
 * losing them costs nothing, and there is no stale row to clean up.
 */

const REQUEST_TTL_MS = 120_000;

const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2 };

export interface TeleportRequest {
  fromDiscord: string;
  fromSteam: string;
  toDiscord: string;
  toSteam: string;
  askedAt: number;
  accepted: boolean;
}

/** Keyed by the Steam ID of whoever is being asked, so `!accept` can find it. */
const pending = new Map<string, TeleportRequest>();

export function delaySeconds(ctx: Ctx): number {
  const raw = Number.parseInt(ctx.db.getSetting('teleport_delay_seconds') ?? '', 10);
  // Clamped: the wait is what stops this being an instant escape from a fight.
  return Math.min(120, Math.max(10, Number.isFinite(raw) ? raw : 45));
}

export function cooldownMinutes(ctx: Ctx): number {
  const raw = Number.parseInt(ctx.db.getSetting('teleport_cooldown_minutes') ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}

export function requestFor(steamId: string): TeleportRequest | null {
  const found = pending.get(steamId);
  if (!found) return null;
  if (Date.now() - found.askedAt > REQUEST_TTL_MS) {
    pending.delete(steamId);
    return null;
  }
  return found;
}

export function clearRequest(steamId: string): void {
  pending.delete(steamId);
}

export function addRequest(request: TeleportRequest): void {
  pending.set(request.toSteam, request);
}

export function askEmbed(fromName: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🧭  Someone wants to travel to you')
    .setDescription(
      `**${fromName}** is asking to teleport to where you are on ${SERVER}.\n\n` +
      'Accept below, or type `!accept` in game chat — whichever is easier.\n\n' +
      'They arrive a short while after you accept, not instantly.',
    )
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

export function askRows(fromSteam: string): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tp:yes:${fromSteam}`).setLabel('Accept')
        .setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp:no:${fromSteam}`).setLabel('Decline')
        .setEmoji('✖️').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/**
 * Runs the accepted teleport after the delay.
 *
 * Both sides are told in game, because the person being travelled to deserves
 * to know someone is on their way — and the traveller needs to know not to move.
 */
export async function runAccepted(
  ctx: Ctx,
  client: Client,
  request: TeleportRequest,
  log: (m: string) => void,
): Promise<void> {
  const wait = delaySeconds(ctx);

  // Where they stand now. Moving during the countdown cancels the travel, so
  // this has to be captured before the wait, not after.
  let from: { x: number; y: number; z: number } | null = null;
  try {
    const located = await ctx.mod.run('where', request.fromSteam, {}, { quiet: true });
    if (located.ok) from = located.data as unknown as { x: number; y: number; z: number };
  } catch {
    // No anchor means no movement check; the travel still goes ahead.
  }

  await ctx.rcon
    .directMessage(request.fromSteam, `Accepted. You travel in ${wait}s — do not move.`)
    .catch(() => undefined);
  await ctx.rcon
    .directMessage(request.toSteam, 'You accepted. They arrive shortly.')
    .catch(() => undefined);

  await new Promise((resolve) => setTimeout(resolve, wait * 1000));

  let message: string;
  let ok = false;
  try {
    const result = await ctx.mod.run('teleport', request.fromSteam, {
      to: request.toSteam,
      ...(from ? { fromX: from.x, fromY: from.y, fromZ: from.z } : {}),
    });
    ok = result.ok;
    message = result.msg;
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }

  if (ok) ctx.db.startCooldown(request.fromSteam, 'teleport');
  log(`teleport: ${request.fromSteam} -> ${request.toSteam} ok=${ok} ${message}`);

  await ctx.rcon.directMessage(request.fromSteam, message).catch(() => undefined);

  // Tell them in Discord too: the in-game notice vanishes in about a second.
  const user = await client.users.fetch(request.fromDiscord).catch(() => null);
  await user?.send({
    embeds: [new EmbedBuilder()
      .setColor(ok ? COLORS.good : COLORS.bad)
      .setTitle(ok ? '🧭  You have arrived' : 'Could not travel')
      .setDescription(ok
        ? 'You were moved next to your friend.'
        : `${message}\n\nNothing was changed — try again when you are both spawned in.`)
      .setFooter({ text: SIGNATURE })],
  }).catch(() => undefined);
}
