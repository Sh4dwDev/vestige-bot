import { EmbedBuilder } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import { display } from './points.js';
import { multiplierFor, TIER_LABEL, tierOf } from './tiers.js';

/**
 * The shop.
 *
 * It sells one thing: a **grown** dinosaur, delivered into storage. Restore is
 * same-species and transform-in-place, so buying a Tyrannosaurus does not let
 * anyone play one — they still have to spawn a juvenile and release the adult
 * over it. What is actually being sold is skipping the grow.
 *
 * Prices default from tier and are overridable per species. They start high on
 * purpose: cutting a price later reads as a gift, raising one reads as a nerf.
 */

const DEFAULT_TIER_PRICE: Record<number, number> = { 1: 300, 2: 600, 3: 1000, 4: 1800 };
const DEFAULT_MUTATION_PRICE = 200;

import { MAX_SLOTS } from './bridge.js';

export { MAX_SLOTS };

export function priceOf(ctx: Ctx, species: string): number {
  const override = Number.parseFloat(ctx.db.getSetting(`shop_price:${species}`) ?? '');
  if (Number.isFinite(override) && override >= 0) return override;

  const tier = tierOf(ctx, species);
  const byTier = Number.parseFloat(ctx.db.getSetting(`shop_price_tier:${tier}`) ?? '');
  if (Number.isFinite(byTier) && byTier >= 0) return byTier;

  return DEFAULT_TIER_PRICE[tier] ?? DEFAULT_TIER_PRICE[1] ?? 300;
}

export function mutationPrice(ctx: Ctx): number {
  const stored = Number.parseFloat(ctx.db.getSetting('shop_mutation_price') ?? '');
  return Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_MUTATION_PRICE;
}

export function totalPrice(ctx: Ctx, species: string, mutations: string[]): number {
  return priceOf(ctx, species) + mutations.length * mutationPrice(ctx);
}

export function setSpeciesPrice(ctx: Ctx, species: string, price: number): void {
  ctx.db.setSetting(`shop_price:${species}`, String(price));
}

export function setTierPrice(ctx: Ctx, tier: number, price: number): void {
  ctx.db.setSetting(`shop_price_tier:${tier}`, String(price));
}

// ----------------------------------------------------------------- pending --

export interface Pending {
  species: string;
  mutations: string[];
  price: number;
  at: number;
}

const PENDING_TTL_MS = 120_000;

/**
 * One in flight per person. This is also the double-click guard: a second press
 * finds the pending gone and buys nothing rather than buying twice.
 */
const pending = new Map<string, Pending>();

export function setPending(discordId: string, purchase: Pending): void {
  pending.set(discordId, purchase);
}

export function takePending(discordId: string): Pending | null {
  const found = pending.get(discordId);
  pending.delete(discordId);
  if (!found) return null;
  return Date.now() - found.at > PENDING_TTL_MS ? null : found;
}

// ------------------------------------------------------------------ embeds --

export function buildCatalogue(ctx: Ctx, species: string[], balance: number): EmbedBuilder {
  const byTier = new Map<number, string[]>();
  for (const name of species) {
    const tier = tierOf(ctx, name);
    byTier.set(tier, [...(byTier.get(tier) ?? []), `${name} — **${priceOf(ctx, name)}**`]);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🛒  The ${SERVER} shop`)
    .setDescription(
      `You have **${display(balance).toLocaleString()}** points.\n\n` +
      'Buy a **fully grown** dinosaur, delivered into your archive. You collect ' +
      'it by spawning that species and pressing **Release** — so what you are ' +
      'buying is skipping the grow, not the species itself.',
    )
    .setFooter({
      text: `Mutations +${mutationPrice(ctx)} each · uses one of your ${MAX_SLOTS} vaults\n${SIGNATURE}`,
    });

  for (const tier of [4, 3, 2, 1]) {
    const entries = byTier.get(tier);
    if (entries?.length) {
      embed.addFields({
        name: `${TIER_LABEL[tier]}  ·  earns ×${multiplierFor(ctx, tier)}`,
        value: entries.join('\n'),
      });
    }
  }

  return embed;
}

export function buildReceipt(
  species: string,
  mutations: string[],
  price: number,
  left: number,
  slot: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🛒  Bought')
    .setDescription(
      `A grown **${species}** is in your archive as \`${slot}\`.` +
      (mutations.length ? `\nMutations: ${mutations.join(', ')}` : '') +
      `\n\nSpent **${display(price).toLocaleString()}**, ` +
      `**${display(left).toLocaleString()}** left.\n\n` +
      `Spawn a ${species} and press **Release** to collect it.`,
    )
    .setFooter({ text: SIGNATURE })
    .setTimestamp();
}
