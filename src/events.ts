import { EmbedBuilder, type Client } from 'discord.js';

import { SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './population.js';
import { tally } from './population.js';
import { speciesChannel } from './species.js';

/**
 * Population events: the island pushing back on its own imbalance.
 *
 * Two states, and they are opposites of each other:
 *
 * - **Culling** — a species is at or over its cap. Killing one pays extra, so
 *   the pressure to thin it out comes from players wanting points rather than
 *   from staff asking nicely.
 * - **Endangered** — barely any of a species are alive. *Surviving* as one pays
 *   extra, so somebody is rewarded for taking the unpopular pick and living
 *   with it.
 *
 * Both are derived from the same live counts the population poll already has,
 * so they cost no extra RCON traffic.
 *
 * The design rule that matters: an event pays for the thing that fixes the
 * imbalance. Culling pays the killer, not the victim. Endangered pays for time
 * survived, not for kills — paying an endangered species to fight would just
 * get the last few killed faster.
 */

const ENABLED = 'events_enabled';
const CULL_BONUS = 'events_cull_bonus';
const RARE_BONUS = 'events_rare_bonus';

/** Under this many alive, a capped species counts as endangered. */
export const RARE_AT = 2;

/** At this share of the cap or above, it is overpopulated. */
export const CULL_AT = 1.0;

export const DEFAULT_CULL_BONUS = 2;
export const DEFAULT_RARE_BONUS = 2;

export type EventKind = 'cull' | 'rare';

export interface SpeciesEvent {
  species: string;
  kind: EventKind;
  count: number;
  cap: number;
}

export interface EventSettings {
  enabled: boolean;
  cullBonus: number;
  rareBonus: number;
}

export function eventSettings(ctx: Ctx): EventSettings {
  const cull = Number.parseFloat(ctx.db.getSetting(CULL_BONUS) ?? '');
  const rare = Number.parseFloat(ctx.db.getSetting(RARE_BONUS) ?? '');
  return {
    enabled: ctx.db.getSetting(ENABLED) === '1',
    cullBonus: Number.isFinite(cull) && cull > 0 ? cull : DEFAULT_CULL_BONUS,
    rareBonus: Number.isFinite(rare) && rare > 0 ? rare : DEFAULT_RARE_BONUS,
  };
}

export function setEventsEnabled(ctx: Ctx, enabled: boolean): void {
  ctx.db.setSetting(ENABLED, enabled ? '1' : '0');
}

export function setCullBonus(ctx: Ctx, multiplier: number): void {
  ctx.db.setSetting(CULL_BONUS, String(multiplier));
}

export function setRareBonus(ctx: Ctx, multiplier: number): void {
  ctx.db.setSetting(RARE_BONUS, String(multiplier));
}

/**
 * Which species are in an event right now.
 *
 * Pure, and only ever considers species that have a cap: without one there is
 * no notion of "too many", and every empty species on the server would read as
 * endangered the moment nobody happened to be playing it.
 */
export function eventsFor(
  caps: Array<{ species: string; cap: number }>,
  counts: Map<string, number>,
): SpeciesEvent[] {
  const out: SpeciesEvent[] = [];

  for (const entry of caps) {
    if (entry.cap <= 0) continue;
    const count = counts.get(entry.species) ?? 0;

    if (count >= entry.cap * CULL_AT) {
      out.push({ species: entry.species, kind: 'cull', count, cap: entry.cap });
    } else if (count > 0 && count <= RARE_AT) {
      // Nobody playing it is not endangered, it is simply out of fashion. An
      // event with no participants has nobody to pay.
      out.push({ species: entry.species, kind: 'rare', count, cap: entry.cap });
    }
  }

  return out.sort((a, b) => a.species.localeCompare(b.species));
}

/** The live set, stored so a bot restart does not re-announce what is running. */
export function activeEvents(ctx: Ctx): Map<string, EventKind> {
  const raw = ctx.db.getSetting('events_active') || '';
  const out = new Map<string, EventKind>();
  for (const part of raw.split(',')) {
    const [species, kind] = part.split(':');
    if (species && (kind === 'cull' || kind === 'rare')) out.set(species, kind);
  }
  return out;
}

function saveActive(ctx: Ctx, active: Map<string, EventKind>): void {
  ctx.db.setSetting(
    'events_active',
    [...active].map(([species, kind]) => `${species}:${kind}`).join(','),
  );
}

/** What a kill on this species is multiplied by right now. */
export function killMultiplier(ctx: Ctx, species: string): number {
  const settings = eventSettings(ctx);
  if (!settings.enabled) return 1;
  return activeEvents(ctx).get(species) === 'cull' ? settings.cullBonus : 1;
}

/** What playing this species earns per hour, multiplied. */
export function playMultiplier(ctx: Ctx, species: string): number {
  const settings = eventSettings(ctx);
  if (!settings.enabled) return 1;
  return activeEvents(ctx).get(species) === 'rare' ? settings.rareBonus : 1;
}

// ------------------------------------------------------------------ notice --

export function buildEventEmbed(event: SpeciesEvent, bonus: number): EmbedBuilder {
  const cull = event.kind === 'cull';
  return new EmbedBuilder()
    .setColor(cull ? 0xed4245 : 0x57f287)
    .setTitle(cull
      ? `🩸  Cull: ${event.species}`
      : `🛡️  Endangered: ${event.species}`)
    .setDescription(
      cull
        ? `**${event.count}** are online and the cap is **${event.cap}**.\n\n` +
          `Killing a ${event.species} pays **${bonus}x** points until the ` +
          'population comes down.'
        : `Only **${event.count}** left on the island.\n\n` +
          `Playing a ${event.species} earns **${bonus}x** points while it lasts. ` +
          'Stay alive.',
    )
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

export function buildEventOverEmbed(species: string, kind: EventKind): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${species} is back to normal`)
    .setDescription(kind === 'cull'
      ? 'The population has come down. Kills pay the usual again.'
      : 'There are enough of them again. Playing one pays the usual.')
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

/** ASCII, and a full sentence: these land in chat as <RCON> and stay there. */
export function eventAnnounce(event: SpeciesEvent, bonus: number): string {
  return event.kind === 'cull'
    ? `Cull event: ${event.species} is over its limit (${event.count}/${event.cap}). `
      + `Killing one pays ${bonus}x points until the population drops.`
    : `Endangered: only ${event.count} ${event.species} left. `
      + `Playing one pays ${bonus}x points while it lasts.`;
}

export function overAnnounce(species: string, kind: EventKind): string {
  return kind === 'cull'
    ? `${species} is back under its limit. Kills pay the usual again.`
    : `${species} numbers have recovered. Playing one pays the usual again.`;
}

/**
 * Called from the population poll, which already has the player list.
 *
 * Only differences are announced, so a species sitting in an event for an hour
 * is mentioned once at each end rather than every minute.
 */
export async function checkEvents(
  ctx: Ctx,
  client: Client,
  players: PlayerRow[],
  log: (m: string) => void,
): Promise<void> {
  const settings = eventSettings(ctx);
  if (!settings.enabled) return;

  const caps = ctx.db.speciesCaps();
  if (caps.length === 0) return;

  const counts = new Map<string, number>();
  for (const row of tally(players)) counts.set(row.species, row.online);

  const now = new Map(eventsFor(caps, counts).map((e) => [e.species, e] as const));
  const before = activeEvents(ctx);

  const started = [...now.values()].filter((e) => before.get(e.species) !== e.kind);
  const ended = [...before].filter(([species, kind]) => now.get(species)?.kind !== kind);

  if (started.length === 0 && ended.length === 0) return;

  saveActive(ctx, new Map([...now].map(([species, e]) => [species, e.kind])));

  const channelId = speciesChannel(ctx);
  const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  const send = async (embed: EmbedBuilder): Promise<void> => {
    if (channel?.isTextBased() && 'send' in channel) {
      await channel.send({ embeds: [embed] }).catch(() => undefined);
    }
  };

  for (const event of started) {
    const bonus = event.kind === 'cull' ? settings.cullBonus : settings.rareBonus;
    log(`event: ${event.species} ${event.kind} (${event.count}/${event.cap})`);
    await send(buildEventEmbed(event, bonus));
    await ctx.rcon.announce(eventAnnounce(event, bonus)).catch(() => undefined);
  }

  for (const [species, kind] of ended) {
    log(`event: ${species} ${kind} over`);
    await send(buildEventOverEmbed(species, kind));
    await ctx.rcon.announce(overAnnounce(species, kind)).catch(() => undefined);
  }
}
