import { tierOf } from './tiers.js';
/**
 * A starting set of population caps, as a share of the server's slots.
 *
 * Written **per 100 players** so the numbers read as percentages, then scaled
 * to whatever `MaxPlayerCount` actually says. A cap table hardcoded to 100 goes
 * quietly wrong the day the slot count changes.
 *
 * The shape of it: apexes bind almost always, mid tiers bind only on a busy
 * night, and the small stuff never binds at all. That last part matters — a cap
 * table where every species can fill up is one where a player who logs in late
 * has nothing to play.
 *
 * These are a **starting point**, not a rule. Every one can be moved with
 * `/admin species cap`.
 */
/** Caps per 100 slots. Anything the server has that is not listed stays uncapped. */
export const PER_HUNDRED = {
    // Tier 4 — the prize. Scarce on purpose.
    Tyrannosaurus: 5,
    Deinosuchus: 6,
    Triceratops: 10,
    // Tier 3 — strong, and worth queueing for.
    Allosaurus: 10,
    Stegosaurus: 10,
    Kentrosaurus: 10,
    Tenontosaurus: 12,
    Maiasaura: 12,
    // Tier 2 — the middle of the server. Binds on a full night, not otherwise.
    Carnotaurus: 12,
    Ceratosaurus: 10,
    Diabloceratops: 12,
    Pachycephalosaurus: 12,
    Austroraptor: 12,
    Herrerasaurus: 12,
    Beipiaosaurus: 14,
    Gallimimus: 14,
    Dilophosaurus: 12,
    // Fliers see everything, so they are held below their tier.
    Pteranodon: 10,
    // Tier 1 — the fallback. Deliberately generous: there must always be
    // something to spawn.
    Dryosaurus: 20,
    Hypsilophodon: 20,
    Troodon: 14,
    Omniraptor: 14,
};
/**
 * Scales the table to the real slot count.
 *
 * Only species the server actually reports are included — writing a cap for a
 * name this build does not have creates a row that can never unlock, and it
 * would show in the panel as a species nobody can play.
 */
export function planCaps(ctx, maxPlayers, available) {
    const have = new Set(available);
    const scale = maxPlayers / 100;
    return Object.entries(PER_HUNDRED)
        .filter(([species]) => have.size === 0 || have.has(species))
        .map(([species, per100]) => ({
        species,
        // A cap of 0 would lock the species permanently, so the floor is 1.
        cap: Math.max(1, Math.round(per100 * scale)),
        tier: tierOf(ctx, species),
    }))
        .sort((a, b) => b.tier - a.tier || a.species.localeCompare(b.species));
}
export function applyCaps(ctx, planned) {
    for (const entry of planned)
        ctx.db.setSpeciesCap(entry.species, entry.cap);
}
//# sourceMappingURL=capplan.js.map