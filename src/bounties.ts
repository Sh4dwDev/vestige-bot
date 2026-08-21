import { EmbedBuilder, type Client } from 'discord.js';

import { SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import { activeEvents } from './events.js';
import type { PlayerRow } from './population.js';
import { tally } from './population.js';
import { speciesChannel } from './species.js';
import { tierOf } from './tiers.js';

/**
 * Bounties: a visible pot on a species the island has too many of.
 *
 * The population events already pay a quiet multiplier for culling. A bounty is
 * the same pressure made **legible** — a number on a board, with a limited
 * number of payouts, that people can see and go after. A multiplier nobody
 * notices changes nothing; "400 points, 3 left" changes what people do tonight.
 *
 * Three rules shape it:
 *
 * **Conditions post them, not staff.** A bounty appears when a species goes
 * over its cap and disappears when it comes back under, so it always points at
 * the problem the island actually has right now.
 *
 * **Never on an endangered species.** The same direction rule as events: paying
 * for kills on the last few of something would finish them off. This is checked
 * rather than assumed, because the two systems read the same counts and it
 * would be easy for them to disagree.
 *
 * **Limited payouts.** A condition-based bounty with unlimited claims is a
 * points printer — the species stays over cap, so the bounty never closes, so
 * it pays forever. Each one carries a small pot and closes when it is spent.
 */

const ENABLED = 'bounties_enabled';
const BASE = 'bounty_base';
const STATE = 'bounties_active';

/** Points per claim before the tier multiplier. */
export const DEFAULT_BASE = 150;

/** How long a spent bounty stays closed before conditions can post a new one. */
const COOLDOWN_MS = 30 * 60_000;

export interface Bounty {
  species: string;
  /** Points per kill. */
  reward: number;
  /** How many payouts are left. */
  claims: number;
  /** How far over the cap it was when posted, which is why it exists. */
  over: number;
  postedAt: number;
}

export interface BountySettings {
  enabled: boolean;
  base: number;
}

export function bountySettings(ctx: Ctx): BountySettings {
  const base = Number.parseFloat(ctx.db.getSetting(BASE) ?? '');
  return {
    enabled: ctx.db.getSetting(ENABLED) === '1',
    base: Number.isFinite(base) && base > 0 ? base : DEFAULT_BASE,
  };
}

export function setBountiesEnabled(ctx: Ctx, enabled: boolean): void {
  ctx.db.setSetting(ENABLED, enabled ? '1' : '0');
}

export function setBountyBase(ctx: Ctx, points: number): void {
  ctx.db.setSetting(BASE, String(points));
}

// ------------------------------------------------------------------- state --

export function activeBounties(ctx: Ctx): Bounty[] {
  try {
    const raw = JSON.parse(ctx.db.getSetting(STATE) || '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((b): b is Bounty =>
      typeof b === 'object' && b !== null
      && typeof (b as Bounty).species === 'string'
      && typeof (b as Bounty).claims === 'number');
  } catch {
    // A corrupt row must not take the population poll down with it.
    return [];
  }
}

function save(ctx: Ctx, bounties: Bounty[]): void {
  ctx.db.setSetting(STATE, JSON.stringify(bounties));
}

/** When a species last had a bounty close, so a new one is not posted instantly. */
function lastClosed(ctx: Ctx, species: string): number {
  return Number.parseInt(ctx.db.getSetting(`bounty_closed:${species}`) ?? '', 10) || 0;
}

function markClosed(ctx: Ctx, species: string): void {
  ctx.db.setSetting(`bounty_closed:${species}`, String(Date.now()));
}

// -------------------------------------------------------------- generation --

/**
 * What the island should have a bounty on, given the live counts.
 *
 * Pure so the balance is testable: the reward is deliberately a function of how
 * far over the cap a species is, so a badly overpopulated apex is worth going
 * out of your way for and a species one over its limit is not.
 */
export function bountiesFor(
  caps: Array<{ species: string; cap: number }>,
  counts: Map<string, number>,
  base: number,
  tier: (species: string) => number,
  endangered: Set<string> = new Set(),
): Bounty[] {
  const out: Bounty[] = [];

  for (const entry of caps) {
    if (entry.cap <= 0) continue;
    if (endangered.has(entry.species)) continue;

    const count = counts.get(entry.species) ?? 0;
    const over = count - entry.cap;
    if (over < 0) continue;

    // Tier decides what a kill is worth; the overflow decides how many payouts
    // are on offer. One over the cap is a single bounty, not an open season.
    const reward = Math.round(base * Math.max(1, tier(entry.species) / 2));
    out.push({
      species: entry.species,
      reward,
      claims: Math.min(5, Math.max(1, over + 1)),
      over,
      postedAt: Date.now(),
    });
  }

  return out.sort((a, b) => b.reward - a.reward || a.species.localeCompare(b.species));
}

/**
 * Recomputes the board from live counts.
 *
 * Existing bounties keep their remaining claims: refreshing must not quietly
 * top somebody's pot back up while they are working through it.
 */
export function refreshBounties(ctx: Ctx, players: PlayerRow[]): {
  posted: Bounty[];
  ended: string[];
} {
  const settings = bountySettings(ctx);
  if (!settings.enabled) return { posted: [], ended: [] };

  const counts = new Map<string, number>();
  for (const row of tally(players)) counts.set(row.species, row.online);

  const endangered = new Set(
    [...activeEvents(ctx)].filter(([, kind]) => kind === 'rare').map(([species]) => species),
  );

  const wanted = bountiesFor(
    ctx.db.speciesCaps(), counts, settings.base,
    (species) => tierOf(ctx, species), endangered,
  );

  const current = activeBounties(ctx);
  const byName = new Map(current.map((b) => [b.species, b]));
  const now = Date.now();

  const next: Bounty[] = [];
  const posted: Bounty[] = [];

  for (const bounty of wanted) {
    const existing = byName.get(bounty.species);
    if (existing) {
      // Already running. Keep it exactly as it is, claims included.
      next.push(existing);
      continue;
    }
    if (now - lastClosed(ctx, bounty.species) < COOLDOWN_MS) continue;

    next.push(bounty);
    posted.push(bounty);
  }

  const ended = current
    .filter((b) => !next.some((n) => n.species === b.species))
    .map((b) => b.species);
  for (const species of ended) markClosed(ctx, species);

  save(ctx, next);
  return { posted, ended };
}

/**
 * Pays a bounty for a kill, if one is on that species.
 *
 * Returns what was paid so the caller can say so. Spending the last claim
 * closes the bounty, which is what stops a permanently over-cap species paying
 * out forever.
 */
export function claimBounty(ctx: Ctx, species: string): Bounty | null {
  const settings = bountySettings(ctx);
  if (!settings.enabled) return null;

  const bounties = activeBounties(ctx);
  const found = bounties.find((b) => b.species === species);
  if (!found || found.claims <= 0) return null;

  found.claims -= 1;
  const remaining = bounties.filter((b) => b.claims > 0);
  if (found.claims <= 0) markClosed(ctx, species);

  save(ctx, remaining);
  return found;
}

// ------------------------------------------------------------------ notice --

/** One line per bounty, for the population panel. */
export function bountyLines(bounties: Bounty[]): string {
  return bounties
    .map((b) => `**${b.species}** — ${b.reward} points · ${b.claims} left`)
    .join('\n');
}

export function buildBountyEmbed(bounty: Bounty): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`💰  Bounty: ${bounty.species}`)
    .setDescription(
      `**${bounty.reward} points** per kill, **${bounty.claims}** payouts on offer.\n\n` +
      `There are ${bounty.over === 0 ? 'as many as the island allows' : `${bounty.over} over the limit`}` +
      '. Thin them out and get paid for it.',
    )
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}

/** ASCII and a full sentence: this lands in chat as <RCON> and stays there. */
export function bountyAnnounce(bounty: Bounty): string {
  return `Bounty posted on ${bounty.species}: ${bounty.reward} points per kill, `
    + `${bounty.claims} payouts available. Population is over the limit.`;
}

export function bountyPaidAnnounce(species: string, reward: number, left: number): string {
  return left > 0
    ? `Bounty claimed on ${species} for ${reward} points. ${left} payouts left.`
    : `Bounty claimed on ${species} for ${reward} points. That was the last one.`;
}

/** Called from the population poll, which already has the counts. */
export async function checkBounties(
  ctx: Ctx,
  client: Client,
  players: PlayerRow[],
  log: (m: string) => void,
): Promise<void> {
  const { posted } = refreshBounties(ctx, players);
  if (posted.length === 0) return;

  const channelId = speciesChannel(ctx);
  const channel = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;

  for (const bounty of posted) {
    log(`bounty: posted on ${bounty.species} (${bounty.reward} x ${bounty.claims})`);
    if (channel?.isTextBased() && 'send' in channel) {
      await channel.send({ embeds: [buildBountyEmbed(bounty)] }).catch(() => undefined);
    }
    await ctx.rcon.announce(bountyAnnounce(bounty)).catch(() => undefined);
  }
}
