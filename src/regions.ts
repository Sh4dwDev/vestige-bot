import { EmbedBuilder, type Client } from 'discord.js';

import { toPlainAscii, type PlayerRow } from './bridge.js';
import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import { renderRegions } from './heatimage.js';
import { resolveMapImage, storedBounds } from './heatmap.js';
import { tell } from './tell.js';

/**
 * The Active Region: somewhere worth being, for a while.
 *
 * One broad area of the map is named for a stretch of time. Spend enough
 * *active* minutes inside it and the points land when it ends. Nothing is
 * marked on anybody's screen, nobody is moved, and taking part is optional —
 * the whole point is to give people a reason to drift toward each other
 * without telling anyone where anyone is.
 *
 * **Reuses what already runs.** Positions come from the same poll the contest
 * and heatmap use, identity is the linked Steam account, and points go through
 * the existing transaction. Nothing new enumerates the world.
 *
 * **Regions are circles, deliberately.** A polygon border would be more
 * faithful to the map and much harder to reason about; a centre and a radius
 * can be checked with one distance and explained to a player in a sentence.
 */

const STATE_KEY = 'region_event';
const KEYS = {
  channel: 'region_channel',
  mapChannel: 'region_map_channel',
  mapMessage: 'region_map_message',
  auto: 'region_auto',
  reward: 'region_reward',
  minutes: 'region_minutes',
  required: 'region_required_minutes',
  minPlayers: 'region_min_players',
  roleMention: 'region_role',
  overrides: 'region_overrides',
  lastRegion: 'region_last',
  custom: 'region_custom',
} as const;

export const DEFAULTS = {
  reward: 300,
  /** How long an event runs. */
  minutes: 45,
  /** Active time inside it before somebody qualifies. */
  requiredMinutes: 15,
  minPlayers: 2,
  /** The gap between automatic events is drawn from this range. */
  gapMinMinutes: 60,
  gapMaxMinutes: 90,
} as const;

/**
 * How often participation is counted.
 *
 * Ten rather than thirty. Costs nothing — it reads positions the poll already
 * has, so it is arithmetic more often, not another round trip — and thirty was
 * long enough to miss a crossing entirely: step out and back inside one sample
 * and no check ever sees you outside, so no notice fires. Correct, and
 * indistinguishable from broken.
 */
export const CHECK_SECONDS = 10;

/**
 * No meaningful movement for this long and somebody stops accruing.
 *
 * Generous on purpose. Resting, hiding and eating are all things a player
 * should be able to do inside the region without being called AFK, so this
 * only catches somebody who has not moved at all for a long stretch.
 */
export const AFK_MINUTES = 10;

/** Movement below this between two checks does not count as having moved. */
const MOVED_UNITS = 2000;

export interface Region {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  enabled: boolean;
}

/**
 * No regions ship with the feature.
 *
 * There were five, with invented coordinates, and they were worse than
 * nothing: a placeholder that looks like data gets used like data, and an
 * event running against a made-up centre sends people to an empty patch of
 * map. The areas worth gathering in already have names on this server, and the
 * only way to get their coordinates right is to stand in them.
 *
 * So the list is empty and `/active-region add` is the way in. It places a
 * region where the admin is standing, which makes naming an area the same act
 * as walking to it.
 */
export const REGIONS: Region[] = [];

/**
 * Regions somebody added themselves.
 *
 * The shipped five are a starting point, not the map. Anywhere worth gathering
 * has a name the server already uses, and those are the ones people will
 * actually travel to — so a custom region is a first-class one, not an
 * afterthought.
 */
export function customRegions(ctx: Ctx): Region[] {
  try {
    const raw = ctx.db.getSetting(KEYS.custom);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as Region[]).filter((r) => typeof r?.id === 'string' && r.id !== '')
      : [];
  } catch {
    // A broken list must not hide the shipped ones too.
    return [];
  }
}

const saveCustom = (ctx: Ctx, regions: Region[]): void =>
  ctx.db.setSetting(KEYS.custom, JSON.stringify(regions));

/** A readable id from a name: "The Lakes" becomes "the-lakes". */
export const slugFor = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);

export function addRegion(ctx: Ctx, region: Region): Region[] {
  // Replaces rather than duplicating, so adding the same name twice edits it.
  const kept = customRegions(ctx).filter((r) => r.id !== region.id);
  const next = [...kept, region];
  saveCustom(ctx, next);
  return next;
}

export function removeRegion(ctx: Ctx, id: string): boolean {
  const before = customRegions(ctx);
  const next = before.filter((r) => r.id !== id);
  if (next.length === before.length) return false;

  saveCustom(ctx, next);
  // The override would otherwise linger and reappear if the name were reused.
  clearRegionOverride(ctx, id);
  return true;
}

/** Regions with any admin overrides applied, plus the custom ones. */
export function regionsFor(ctx: Ctx): Region[] {
  let overrides: Record<string, Partial<Region>> = {};
  try {
    const raw = ctx.db.getSetting(KEYS.overrides);
    if (raw) overrides = JSON.parse(raw) as Record<string, Partial<Region>>;
  } catch {
    // A broken override must not hide every region.
  }

  return [
    ...REGIONS.map((region) => ({ ...region, ...(overrides[region.id] ?? {}) })),
    // Custom ones take overrides too, so `move` works the same on both.
    ...customRegions(ctx).map((region) => ({ ...region, ...(overrides[region.id] ?? {}) })),
  ];
}

export function setRegionOverride(ctx: Ctx, id: string, patch: Partial<Region>): void {
  let overrides: Record<string, Partial<Region>> = {};
  try {
    const raw = ctx.db.getSetting(KEYS.overrides);
    if (raw) overrides = JSON.parse(raw) as Record<string, Partial<Region>>;
  } catch {
    overrides = {};
  }
  overrides[id] = { ...(overrides[id] ?? {}), ...patch };
  ctx.db.setSetting(KEYS.overrides, JSON.stringify(overrides));
}

export function clearRegionOverride(ctx: Ctx, id: string): void {
  try {
    const raw = ctx.db.getSetting(KEYS.overrides);
    if (!raw) return;
    const overrides = JSON.parse(raw) as Record<string, Partial<Region>>;
    delete overrides[id];
    ctx.db.setSetting(KEYS.overrides, JSON.stringify(overrides));
  } catch {
    // Nothing to clear if it was unreadable anyway.
  }
}

export const regionById = (ctx: Ctx, id: string): Region | null =>
  regionsFor(ctx).find((r) => r.id === id) ?? null;

// ----------------------------------------------------------------- settings --

const num = (ctx: Ctx, key: string, fallback: number): number => {
  const raw = Number.parseFloat(ctx.db.getSetting(key) ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

export const regionChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(KEYS.channel) || null;
export const regionMapChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(KEYS.mapChannel) || null;
export const REGION_MAP_MESSAGE_KEY = KEYS.mapMessage;
export const regionRole = (ctx: Ctx): string | null =>
  ctx.db.getSetting(KEYS.roleMention) || null;

export const autoRegions = (ctx: Ctx): boolean => ctx.db.getSetting(KEYS.auto) === '1';

export interface RegionSettings {
  reward: number;
  minutes: number;
  requiredMinutes: number;
  minPlayers: number;
}

export const regionSettings = (ctx: Ctx): RegionSettings => ({
  reward: num(ctx, KEYS.reward, DEFAULTS.reward),
  minutes: num(ctx, KEYS.minutes, DEFAULTS.minutes),
  requiredMinutes: num(ctx, KEYS.required, DEFAULTS.requiredMinutes),
  minPlayers: num(ctx, KEYS.minPlayers, DEFAULTS.minPlayers),
});

export const setRegionSetting = (ctx: Ctx, key: keyof typeof KEYS, value: string): void =>
  ctx.db.setSetting(KEYS[key], value);

// -------------------------------------------------------------------- event --

export interface Participant {
  /** Eligible seconds accrued so far. */
  seconds: number;
  /** Where they were last seen, for the movement check. */
  lastX?: number;
  lastY?: number;
  /** When they last moved meaningfully. */
  movedAt: number;
}

export interface RegionEvent {
  eventId: string;
  regionId: string;
  regionName: string;
  startedAt: number;
  endsAt: number;
  reward: number;
  requiredMinutes: number;
  minPlayers: number;
  participants: Record<string, Participant>;
  /** Set once, so a restart or a repeated finish cannot pay twice. */
  rewarded: boolean;
  /** A test event pays nobody and says so. */
  dryRun?: boolean;
  lastCheck: number;
}

export function activeEvent(ctx: Ctx): RegionEvent | null {
  const raw = ctx.db.getSetting(STATE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RegionEvent>;
    return typeof parsed.eventId === 'string' && typeof parsed.endsAt === 'number'
      ? (parsed as RegionEvent)
      : null;
  } catch {
    return null;
  }
}

export const saveEvent = (ctx: Ctx, event: RegionEvent | null): void =>
  ctx.db.setSetting(STATE_KEY, event ? JSON.stringify(event) : '');

/** Straight-line distance, which is what "inside" means for a circle. */
export const distanceTo = (region: Region, x: number, y: number): number =>
  Math.hypot(x - region.x, y - region.y);

export const inside = (region: Region, player: PlayerRow): boolean =>
  typeof player.x === 'number' && typeof player.y === 'number'
  && distanceTo(region, player.x, player.y) <= region.radius;

/**
 * Picks the next region, avoiding an immediate repeat.
 *
 * Pure so the "never twice running" rule can be tested without a clock.
 */
export function pickRegion(
  regions: Region[],
  lastId: string | null,
  roll: number = Math.random(),
): Region | null {
  const usable = regions.filter((r) => r.enabled);
  if (usable.length === 0) return null;

  // Only exclude the last one when there is something else to pick.
  const choices = usable.length > 1 ? usable.filter((r) => r.id !== lastId) : usable;
  const at = Math.min(choices.length - 1, Math.floor(roll * choices.length));
  return choices[at] ?? null;
}

export interface TickResult {
  event: RegionEvent;
  /** Who accrued time this check. */
  counted: string[];
  /** Inside the region but not moving. */
  afk: string[];
  /** Crossed in since the last check. */
  entered: string[];
  /** Crossed out, died, or logged off. */
  left: string[];
}

/**
 * One participation check.
 *
 * Pure: this is the part that decides who gets paid, so it is testable without
 * a server. Time is credited between two checks rather than on first sighting,
 * the same way the contest does it — being seen once says only that somebody
 * arrived at some point in the last interval.
 */
export function tickEvent(
  event: RegionEvent,
  region: Region,
  players: PlayerRow[],
  now: number,
): TickResult {
  const elapsed = Math.max(0, Math.min(now - event.lastCheck, CHECK_SECONDS * 4 * 1000));
  const next: RegionEvent = {
    ...event,
    participants: { ...event.participants },
    lastCheck: now,
  };

  const counted: string[] = [];
  const afk: string[] = [];
  const insideNow = new Set<string>();

  for (const player of players) {
    // No Steam account is no identity, and nothing can be paid to it.
    if (!player.steam) continue;
    // A stored or dead dinosaur is not somebody standing in the region.
    if (player.x === undefined || player.y === undefined) continue;
    if (!inside(region, player)) continue;

    const before = next.participants[player.steam];
    const moved = before?.lastX === undefined || before.lastY === undefined
      ? true
      : Math.hypot(player.x - before.lastX, player.y - before.lastY) > MOVED_UNITS;

    const movedAt = moved ? now : (before?.movedAt ?? now);
    const idleMs = now - movedAt;

    const entry: Participant = {
      seconds: before?.seconds ?? 0,
      lastX: player.x,
      lastY: player.y,
      movedAt,
    };

    // Resting, hiding and eating are all fine. Only somebody who has not moved
    // at all for a long stretch stops accruing.
    if (idleMs > AFK_MINUTES * 60_000) {
      afk.push(player.steam);
      next.participants[player.steam] = entry;
      continue;
    }

    // Credited only between two sightings INSIDE the region. `lastX` is
    // cleared on the way out, so somebody who left and came back is treated
    // like a fresh arrival — otherwise the whole time they were away is paid
    // for on their first check back.
    if (before?.lastX !== undefined && elapsed > 0) {
      entry.seconds = before.seconds + Math.round(elapsed / 1000);
      counted.push(player.steam);
    }

    next.participants[player.steam] = entry;
    insideNow.add(player.steam);
  }

  // Edges, from who was inside last time. `lastX` is only set for somebody seen
  // in the region, so its presence is the record of having been there.
  const wasInside = new Set(
    Object.entries(event.participants)
      .filter(([, p]) => p.lastX !== undefined)
      .map(([steam]) => steam),
  );

  const entered = [...insideNow].filter((s) => !wasInside.has(s));
  const left = [...wasInside].filter((s) => !insideNow.has(s));

  // Somebody who left stops being "inside" without losing their time.
  for (const steam of left) {
    const held = next.participants[steam];
    if (held) next.participants[steam] = { ...held, lastX: undefined, lastY: undefined };
  }

  return { event: next, counted, afk, entered, left };
}

/** Who has put in the time. */
export const qualified = (event: RegionEvent): string[] =>
  Object.entries(event.participants)
    .filter(([, p]) => p.seconds >= event.requiredMinutes * 60)
    .map(([steam]) => steam);

export interface Payout {
  paid: string[];
  reward: number;
  enough: boolean;
  dryRun: boolean;
}

/**
 * Pays everybody who qualified, once.
 *
 * `rewarded` is set before the payments and saved immediately, so a crash
 * midway cannot pay the same event twice on the next start. Each payment is
 * its own transaction: one failure must not cost everybody else theirs.
 */
export function payOut(ctx: Ctx, event: RegionEvent, log: (m: string) => void): Payout {
  const winners = qualified(event);
  const enough = winners.length >= event.minPlayers;
  const dryRun = event.dryRun === true;

  if (event.rewarded) {
    log(`region: ${event.eventId} was already paid, skipping`);
    return { paid: [], reward: event.reward, enough, dryRun };
  }

  saveEvent(ctx, { ...event, rewarded: true });

  if (!enough || dryRun) return { paid: [], reward: event.reward, enough, dryRun };

  const paid: string[] = [];
  for (const steam of winners) {
    try {
      ctx.db.addPoints(steam, event.reward, 0);
      paid.push(steam);
    } catch (err) {
      log(`region: could not pay ${steam}: ${
        err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(`region: ${event.eventId} paid ${paid.length} of ${winners.length} qualified`);
  return { paid, reward: event.reward, enough, dryRun };
}

/**
 * Tells people as they cross the boundary.
 *
 * Persistent rather than the brief banner, by request: this is the same widget
 * the game draws the prime checklist in, so it stays on screen until something
 * replaces it. That is the right trade here — the boundary is invisible, and a
 * line that vanishes in a second cannot tell somebody they are in the right
 * place for the next fifteen minutes. It does mean the prime list is hidden
 * until the game next redraws it.
 */
export async function notifyEdges(
  ctx: Ctx,
  event: RegionEvent,
  region: Region,
  result: TickResult,
): Promise<void> {
  for (const steam of result.entered) {
    void tell(ctx, steam,
      `ACTIVE REGION: you are inside ${region.name}. `
      + `${event.requiredMinutes} active minutes earns ${event.reward} points.`,
      { persist: true });
  }

  for (const steam of result.left) {
    const held = Math.round((result.event.participants[steam]?.seconds ?? 0) / 60);
    void tell(ctx, steam,
      `ACTIVE REGION: you left ${region.name}. `
      + `${held} minute${held === 1 ? '' : 's'} kept - come back to carry on.`,
      { persist: true });
  }
}

/**
 * The in-game lines.
 *
 * ASCII only: RCON drops anything else silently. Short, because these land in
 * the announcement banner rather than a channel somebody can scroll back
 * through — and most players are not reading Discord while they play, which is
 * exactly who the event is for.
 */
export const startAnnounce = (event: RegionEvent): string =>
  `ACTIVE REGION: ${event.regionName} for ${
    Math.round((event.endsAt - event.startedAt) / 60_000)} minutes. `
  + `${event.requiredMinutes} active minutes inside it earns ${event.reward} points.`;

export const endAnnounce = (event: RegionEvent, payout: Payout): string =>
  payout.paid.length > 0
    ? `ACTIVE REGION: ${event.regionName} is over. ${payout.paid.length} paid `
      + `${payout.reward} points each.`
    : `ACTIVE REGION: ${event.regionName} is over. Nobody qualified.`;

// ------------------------------------------------------------------ embeds --

export function buildStartEmbed(event: RegionEvent): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xff6b35)
    .setTitle(`🔥  Active Region: ${event.regionName}`)
    .setDescription(
      `**${event.regionName}** is the Active Region for the next `
      + `**${Math.round((event.endsAt - event.startedAt) / 60_000)} minutes**.\n\n`
      + `Spend at least **${event.requiredMinutes} active minutes** inside it to `
      + `earn **${event.reward}** points.`
      + (event.dryRun ? '\n\n🧪 This is a test event. Nobody is paid.' : ''),
    )
    .addFields({
      name: 'How it works',
      value: 'No exact locations are shown and nobody is moved. Taking part is '
        + 'optional — resting, hiding and eating all still count, so long as you '
        + 'are somewhere in the region.',
    })
    .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
    .setTimestamp(new Date(event.startedAt));
}

export function buildEndEmbed(
  event: RegionEvent,
  payout: Payout,
  gapMinutes: [number, number],
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(payout.paid.length > 0 ? 0x57f287 : 0x4f545c)
    .setTitle('Active Region ended')
    .setDescription(`The **${event.regionName}** event has finished.`)
    .setFooter({ text: `${SERVER} · ${SIGNATURE}` })
    .setTimestamp();

  if (payout.dryRun) {
    embed.addFields({
      name: '🧪  Test event',
      value: `**${qualified(event).length}** would have qualified. No points were paid.`,
    });
    return embed;
  }

  if (!payout.enough) {
    embed.addFields({
      name: 'No rewards this time',
      value: `Only **${qualified(event).length}** qualified, and **${event.minPlayers}** `
        + 'are needed. Nothing was paid.',
    });
  } else {
    embed.addFields(
      { name: 'Qualified players', value: String(payout.paid.length), inline: true },
      { name: 'Reward', value: `${payout.reward} points each`, inline: true },
    );
  }

  embed.addFields({
    name: 'Next region',
    value: `approximately ${gapMinutes[0]}–${gapMinutes[1]} minutes`,
  });

  return embed;
}

// ------------------------------------------------------------------ running --

/** When the next automatic event is due. Stored so a restart does not reset it. */
const NEXT_KEY = 'region_next_at';

export const nextEventAt = (ctx: Ctx): number => {
  const raw = Number.parseInt(ctx.db.getSetting(NEXT_KEY) ?? '', 10);
  return Number.isFinite(raw) ? raw : 0;
};

export function scheduleNext(ctx: Ctx, now = Date.now(), roll = Math.random()): number {
  const span = DEFAULTS.gapMaxMinutes - DEFAULTS.gapMinMinutes;
  const minutes = DEFAULTS.gapMinMinutes + Math.round(roll * span);
  const at = now + (minutes * 60_000);
  ctx.db.setSetting(NEXT_KEY, String(at));
  return at;
}

export interface StartOptions {
  regionId?: string;
  minutes?: number;
  reward?: number;
  requiredMinutes?: number;
  dryRun?: boolean;
}

export type StartResult =
  | { ok: true; event: RegionEvent }
  | { ok: false; reason: string };

/**
 * Opens an event.
 *
 * Refuses while one is running: two at once would split everybody and neither
 * would gather anyone, which is the entire point of the feature.
 */
export function startEvent(
  ctx: Ctx,
  options: StartOptions = {},
  now = Date.now(),
): StartResult {
  if (activeEvent(ctx)) return { ok: false, reason: 'An Active Region is already running.' };

  const settings = regionSettings(ctx);
  const regions = regionsFor(ctx);

  const region = options.regionId
    ? regions.find((r) => r.id === options.regionId) ?? null
    : pickRegion(regions, ctx.db.getSetting(KEYS.lastRegion) || null);

  if (!region) {
    return {
      ok: false,
      reason: options.regionId
        ? 'No region with that id.'
        : 'No regions are enabled. Check `/active-region regions`.',
    };
  }

  const minutes = options.minutes ?? settings.minutes;
  const event: RegionEvent = {
    eventId: `AR-${now}`,
    regionId: region.id,
    regionName: region.name,
    startedAt: now,
    endsAt: now + (minutes * 60_000),
    reward: options.reward ?? settings.reward,
    requiredMinutes: options.requiredMinutes ?? settings.requiredMinutes,
    minPlayers: settings.minPlayers,
    participants: {},
    rewarded: false,
    ...(options.dryRun ? { dryRun: true } : {}),
    lastCheck: now,
  };

  saveEvent(ctx, event);
  ctx.db.setSetting(KEYS.lastRegion, region.id);
  return { ok: true, event };
}

/**
 * Finishes an event: pays, clears, and schedules the next.
 *
 * Safe to call twice — `payOut` refuses a second payment on the same event, so
 * a restart that finds an expired event finalises it exactly once.
 */
export function finishEvent(
  ctx: Ctx,
  event: RegionEvent,
  log: (m: string) => void,
): Payout {
  const payout = payOut(ctx, event, log);
  saveEvent(ctx, null);
  scheduleNext(ctx);
  return payout;
}

// ------------------------------------------------------------- the runner --

/** Posts an embed to the announcement channel, mentioning a role if configured. */
export async function announceRegion(
  ctx: Ctx,
  client: Client,
  embed: EmbedBuilder,
  log: (m: string) => void,
  map: Buffer | null = null,
): Promise<void> {
  const channelId = regionChannel(ctx);
  if (!channelId) {
    log('region: no announcement channel configured');
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
      log(`region: announcement channel ${channelId} is unreachable`);
      return;
    }

    // Off by default. Nobody wants an every-hour ping, so it is opt-in and
    // limited to the one role that asked for it.
    const role = regionRole(ctx);
    // Attached rather than posted separately: two messages for one event made
    // the channel twice as long and said the same thing twice.
    if (map) embed.setImage('attachment://region.png');

    await channel.send({
      ...(role ? { content: `<@&${role}>` } : {}),
      embeds: [embed],
      ...(map ? { files: [{ attachment: map, name: 'region.png' }] } : {}),
      allowedMentions: role ? { roles: [role] } : { parse: [] },
    });
  } catch (err) {
    log(`region: could not announce: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * One pass of the whole feature: count participation, finish what is due, and
 * start the next when it is time.
 *
 * Called from the poll that already reads positions, so it costs nothing
 * extra. Never throws: an Active Region must not be able to take the poll down.
 */
export async function runRegions(
  ctx: Ctx,
  client: Client,
  players: PlayerRow[],
  log: (m: string) => void,
): Promise<void> {
  const now = Date.now();
  const event = activeEvent(ctx);

  if (event) {
    const region = regionById(ctx, event.regionId);

    // The region was disabled or renamed mid-event. Finish rather than leaving
    // it running against something that no longer exists.
    if (!region) {
      log(`region: ${event.regionId} is gone, finishing ${event.eventId}`);
      const payout = finishEvent(ctx, event, log);
      await announceRegion(ctx, client, buildEndEmbed(event, payout,
        [DEFAULTS.gapMinMinutes, DEFAULTS.gapMaxMinutes]), log);
      return;
    }

    if (now >= event.endsAt) {
      const payout = finishEvent(ctx, event, log);
      log(`region: ${event.eventId} ended, ${payout.paid.length} paid`);
      await announceRegion(ctx, client, buildEndEmbed(event, payout,
        [DEFAULTS.gapMinMinutes, DEFAULTS.gapMaxMinutes]), log);
      await ctx.rcon.announce(toPlainAscii(endAnnounce(event, payout)))
        .catch(() => undefined);
      return;
    }

    // Only every CHECK_SECONDS, however often the poll runs.
    if (now - event.lastCheck < CHECK_SECONDS * 1000) return;

    const result = tickEvent(event, region, players, now);
    saveEvent(ctx, result.event);

    // The same on-screen notices the contest gives, for the same reason: the
    // boundary is invisible, so crossing it is the only way anybody knows they
    // are in. Edges only — one every check would be unreadable.
    await notifyEdges(ctx, event, region, result);
    return;
  }

  // Nothing running. Start one when automatic events are on and it is due.
  if (!autoRegions(ctx)) return;
  if (!regionChannel(ctx)) return;

  const due = nextEventAt(ctx);
  if (due === 0) {
    // First run after the channel was set: schedule rather than firing now.
    scheduleNext(ctx, now);
    return;
  }
  if (now < due) return;

  const started = startEvent(ctx, {}, now);
  if (!started.ok) {
    log(`region: could not start — ${started.reason}`);
    scheduleNext(ctx, now);
    return;
  }

  log(`region: ${started.event.eventId} started in ${started.event.regionName}`);
  await announceRegion(ctx, client, buildStartEmbed(started.event), log,
    await renderRegionMap(ctx, log));
  await ctx.rcon.announce(toPlainAscii(startAnnounce(started.event)))
    .catch(() => undefined);

  // Somebody already standing in it should hear so now, not at the first
  // check — otherwise the people best placed to take part are the last to know.
  const region = regionById(ctx, started.event.regionId);
  if (region) {
    const seeded = tickEvent(started.event, region, players, now);
    saveEvent(ctx, seeded.event);
    await notifyEdges(ctx, started.event, region, seeded);
  }
}

/**
 * The region map: the areas, and deliberately not the players.
 *
 * Shares the heatmap's projection and base image, so a region drawn here lands
 * where the same coordinates land there — which is what makes it possible to
 * check a placeholder against the real map.
 */
export async function renderRegionMap(
  ctx: Ctx,
  log: (m: string) => void,
): Promise<Buffer | null> {
  try {
    const event = activeEvent(ctx);
    const shapes = regionsFor(ctx)
      .filter((r) => r.enabled)
      .map((r) => ({
        name: r.name,
        x: r.x,
        y: r.y,
        radius: r.radius,
        active: event?.regionId === r.id,
      }));

    const base = await resolveMapImage(ctx);
    const png = await renderRegions(shapes, storedBounds(ctx), base);

    return png;
  } catch (err) {
    log(`region: could not draw the map: ${
      err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
