import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
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
const DEFAULT_TIER_PRICE = { 1: 300, 2: 600, 3: 1000, 4: 1800 };
const DEFAULT_MUTATION_PRICE = 200;
import { MAX_SLOTS } from './bridge.js';
export { MAX_SLOTS };
/**
 * The highest tier the shop will sell.
 *
 * Apexes are off the shelf. Buying one skips the grow on the dinosaur the grow
 * is most of the point of, and a server where the strongest thing on the island
 * is a purchase rather than an evening reads as pay-to-win however carefully it
 * is priced. Tiers 1 to 3 still sell, so the shop keeps its reason to exist.
 *
 * A server policy rather than a fact, so it is overridable: setting it to 4
 * puts apexes back without a code change.
 */
const DEFAULT_MAX_SHOP_TIER = 3;
export function maxShopTier(ctx) {
    const stored = Number.parseInt(ctx.db.getSetting('shop_max_tier') ?? '', 10);
    return Number.isFinite(stored) && stored >= 1 ? stored : DEFAULT_MAX_SHOP_TIER;
}
export function setMaxShopTier(ctx, tier) {
    ctx.db.setSetting('shop_max_tier', String(tier));
}
/**
 * Whether the shop will sell this at all.
 *
 * Checked when buying, not only when listing. Hiding a species from the
 * catalogue while `/shop buy` still accepts it by name is not a restriction,
 * it is a secret — and the species names are public in `/population`.
 */
export function sellable(ctx, species) {
    return tierOf(ctx, species) <= maxShopTier(ctx);
}
export function priceOf(ctx, species) {
    const override = Number.parseFloat(ctx.db.getSetting(`shop_price:${species}`) ?? '');
    if (Number.isFinite(override) && override >= 0)
        return override;
    const tier = tierOf(ctx, species);
    const byTier = Number.parseFloat(ctx.db.getSetting(`shop_price_tier:${tier}`) ?? '');
    if (Number.isFinite(byTier) && byTier >= 0)
        return byTier;
    return DEFAULT_TIER_PRICE[tier] ?? DEFAULT_TIER_PRICE[1] ?? 300;
}
export function mutationPrice(ctx) {
    const stored = Number.parseFloat(ctx.db.getSetting('shop_mutation_price') ?? '');
    return Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_MUTATION_PRICE;
}
export function totalPrice(ctx, species, mutations) {
    return priceOf(ctx, species) + mutations.length * mutationPrice(ctx);
}
export function setSpeciesPrice(ctx, species, price) {
    ctx.db.setSetting(`shop_price:${species}`, String(price));
}
export function setTierPrice(ctx, tier, price) {
    ctx.db.setSetting(`shop_price_tier:${tier}`, String(price));
}
/** The two halves of the mutation list, split so each fits a select menu. */
export function splitMutations(all) {
    const sorted = [...all].sort((a, b) => a.localeCompare(b));
    const half = Math.ceil(sorted.length / 2);
    return { first: sorted.slice(0, half), second: sorted.slice(half) };
}
const PENDING_TTL_MS = 120_000;
/**
 * One in flight per person. This is also the double-click guard: a second press
 * finds the pending gone and buys nothing rather than buying twice.
 */
const pending = new Map();
export function setPending(discordId, purchase) {
    pending.set(discordId, purchase);
}
/** Reads without consuming, for redrawing the panel as choices change. */
export function peekPending(discordId) {
    const found = pending.get(discordId);
    if (!found)
        return null;
    return Date.now() - found.at > PENDING_TTL_MS ? null : found;
}
export function takePending(discordId) {
    const found = pending.get(discordId);
    pending.delete(discordId);
    if (!found)
        return null;
    return Date.now() - found.at > PENDING_TTL_MS ? null : found;
}
// ------------------------------------------------------------------ embeds --
export function buildCatalogue(ctx, species, balance) {
    const byTier = new Map();
    for (const name of species.filter((s) => sellable(ctx, s))) {
        const tier = tierOf(ctx, name);
        byTier.set(tier, [...(byTier.get(tier) ?? []), `${name} — **${priceOf(ctx, name)}**`]);
    }
    // Said out loud rather than left as an absence. Someone who scrolls the list
    // looking for a Rex should find out why it is missing here, not by trying to
    // buy one.
    const excluded = species.filter((s) => !sellable(ctx, s));
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🛒  The ${SERVER} shop`)
        .setDescription(`You have **${display(balance).toLocaleString()}** points.\n\n` +
        'Buy a **fully grown** dinosaur, delivered into your archive. You collect ' +
        'it by spawning that species and pressing **Release** — so what you are ' +
        'buying is skipping the grow, not the species itself.' +
        (excluded.length > 0
            ? `\n\n🚫 **${excluded.sort().join(', ')}** are not sold. Grow them ` +
                'yourself — nobody buys their way to the top of the island.'
            : ''))
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
export function buildReceipt(species, mutations, price, left, slot) {
    return new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🛒  Bought')
        .setDescription(`A grown **${species}** is in your archive as \`${slot}\`.` +
        (mutations.length ? `\nMutations: ${mutations.join(', ')}` : '') +
        `\n\nSpent **${display(price).toLocaleString()}**, ` +
        `**${display(left).toLocaleString()}** left.\n\n` +
        `Spawn a ${species} and press **Release** to collect it.`)
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
}
//# sourceMappingURL=shop.js.map