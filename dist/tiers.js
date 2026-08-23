/**
 * Species tiers, 1 to 4.
 *
 * These are a **server policy, not a fact about the game** — Evrima has no
 * notion of tiers — so the defaults below are a starting point and every one of
 * them can be overridden per species without touching code.
 *
 * Tier drives two things: how fast you earn points for playing something, and
 * what a kill on it is worth.
 */
export const MAX_TIER = 4;
/** Agreed with the server owner. Anything unlisted falls to tier 1. */
const DEFAULT_TIERS = {
    Tyrannosaurus: 4,
    Deinosuchus: 4,
    Triceratops: 4,
    Allosaurus: 3,
    Stegosaurus: 3,
    Kentrosaurus: 3,
    Tenontosaurus: 3,
    Maiasaura: 3,
    Carnotaurus: 2,
    Ceratosaurus: 2,
    Diabloceratops: 2,
    Pachycephalosaurus: 2,
    Austroraptor: 2,
    Herrerasaurus: 2,
    Beipiaosaurus: 2,
    Gallimimus: 2,
    Pteranodon: 2,
    Dilophosaurus: 2,
    Dryosaurus: 1,
    Hypsilophodon: 1,
    Troodon: 1,
    Omniraptor: 1,
};
/** How much faster each tier earns, and what its kills are worth. */
const DEFAULT_MULTIPLIER = { 1: 1, 2: 1.5, 3: 2, 4: 3 };
export const TIER_LABEL = {
    1: 'Tier 1',
    2: 'Tier 2',
    3: 'Tier 3',
    4: 'Tier 4 · Apex',
};
/**
 * Every species this server knows by name, from the tier table.
 *
 * Used to seed the species roster. A species capped to zero disappears from the
 * live spawn menu, and if its cap row is later rewritten away there is nothing
 * left anywhere that remembers it existed - which strands it as unspawnable
 * with no way to name it again. This list is curated and does not move, so it
 * is the one source a lockout cannot erase.
 */
export const TIERED_SPECIES = Object.keys(DEFAULT_TIERS);
export function tierOf(ctx, species) {
    const stored = ctx.db.getSetting(`tier:${species}`);
    const parsed = Number.parseInt(stored ?? '', 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= MAX_TIER)
        return parsed;
    return DEFAULT_TIERS[species] ?? 1;
}
export function setTier(ctx, species, tier) {
    ctx.db.setSetting(`tier:${species}`, String(tier));
}
export function multiplierFor(ctx, tier) {
    const stored = Number.parseFloat(ctx.db.getSetting(`tier_multiplier:${tier}`) ?? '');
    if (Number.isFinite(stored) && stored >= 0)
        return stored;
    return DEFAULT_MULTIPLIER[tier] ?? 1;
}
export function setMultiplier(ctx, tier, multiplier) {
    ctx.db.setSetting(`tier_multiplier:${tier}`, String(multiplier));
}
/**
 * What a kill pays.
 *
 * The victim's tier sets the base — killing something big is worth more. On top
 * of that, punching **up** pays a bonus, because a Dryosaurus that brings down
 * a Rex has done something a Rex killing a Dryosaurus has not.
 */
export function killReward(ctx, killerTier, victimTier) {
    const base = Number.parseFloat(ctx.db.getSetting('kill_points') ?? '') || 50;
    const points = base * multiplierFor(ctx, victimTier);
    const upset = Math.max(0, victimTier - killerTier);
    return { points: points * (1 + upset * 0.5), upset };
}
//# sourceMappingURL=tiers.js.map