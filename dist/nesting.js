import { tell } from './tell.js';
/**
 * Points for successfully nesting.
 *
 * Nesting is the hardest thing the game asks of a group and the least rewarded:
 * it costs an adult a long sit in one place, and the payoff is somebody else's
 * hatchling. This pays for it.
 *
 * **The child is fact, the parent is inference.** Prime condition 2, "get
 * nested in", is only true for a dinosaur born from a player's nest — that is
 * precisely what separates a hatchling from somebody who spawned in as a
 * juvenile, and the mod already reads it. Nothing in the flags says *whose*
 * nest it was, so the parent is worked out from where people are standing: a
 * hatchling appears at the nest, and whoever nested it is sitting on it.
 *
 * That heuristic is deliberately narrow. Only **adults of the same species**
 * within a short distance count, and no more than a few of them, so a crowd
 * gathering at a nest cannot turn into a payout each. It will still be wrong
 * occasionally — somebody walking past a hatching nest on the right species is
 * indistinguishable from a parent — and that is the honest cost of an engine
 * that does not expose parentage.
 *
 * **Costs almost nothing.** The condition read happens only for a player seen
 * at hatchling growth who has not been checked yet, which is rare, and the
 * positions are the ones the poll already has.
 */
const ENABLED = 'nesting_enabled';
const PARENT_KEY = 'nesting_parent_points';
const RADIUS_KEY = 'nesting_radius';
const CONDITION_KEY = 'nesting_condition';
const GROWTH_KEY = 'nesting_growth';
export const DEFAULT_PARENT_POINTS = 400;
/** HUD units. A nest is a small thing; standing on it is the claim. */
export const DEFAULT_RADIUS = 20;
/**
 * Which prime flag means "get nested in".
 *
 * Configurable rather than hardcoded because the project's own condition table
 * says indexes 2 and 9 were inferred from ordering and never individually
 * watched — and that it should be believed over the table when a player
 * reports otherwise. A wrong guess here would pay for the wrong achievement,
 * so it is a setting rather than a constant.
 */
export const DEFAULT_CONDITION = 2;
/** Growth at or below which somebody is new enough to have just hatched. */
export const DEFAULT_GROWTH = 0.2;
/** However big the crowd, this many parents at most. */
export const MAX_PARENTS = 3;
/** An adult, for the purpose of being somebody's parent. */
const ADULT_GROWTH = 0.75;
const num = (ctx, key, fallback) => {
    const raw = Number.parseFloat(ctx.db.getSetting(key) ?? '');
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};
export function nestingSettings(ctx) {
    return {
        enabled: ctx.db.getSetting(ENABLED) === '1',
        parentPoints: num(ctx, PARENT_KEY, DEFAULT_PARENT_POINTS),
        radius: num(ctx, RADIUS_KEY, DEFAULT_RADIUS),
        condition: Math.round(num(ctx, CONDITION_KEY, DEFAULT_CONDITION)),
        growth: num(ctx, GROWTH_KEY, DEFAULT_GROWTH),
    };
}
export const setNestingEnabled = (ctx, on) => ctx.db.setSetting(ENABLED, on ? '1' : '0');
export const setNestingPoints = (ctx, points) => ctx.db.setSetting(PARENT_KEY, String(Math.max(0, Math.round(points))));
export const setNestingRadius = (ctx, hud) => ctx.db.setSetting(RADIUS_KEY, String(Math.max(1, Math.round(hud))));
export const setNestingCondition = (ctx, index) => ctx.db.setSetting(CONDITION_KEY, String(Math.max(1, Math.min(10, Math.round(index)))));
/**
 * Who was near enough, adult enough and the right species to have nested this
 * hatchling.
 *
 * Pure, because this is the part that decides who gets paid on a guess — and a
 * guess is worth testing precisely.
 */
export function parentsOf(hatchling, players, radiusHud) {
    if (hatchling.x === undefined || hatchling.y === undefined)
        return [];
    const radius = radiusHud * 1000;
    return players
        .filter((p) => p.steam && p.steam !== hatchling.steam)
        // Same species: a nest hatches its own kind, so an Allosaurus standing over
        // a Dryosaurus hatchling is a predator rather than a parent.
        .filter((p) => p.species === hatchling.species)
        .filter((p) => p.growth >= ADULT_GROWTH)
        .filter((p) => p.x !== undefined && p.y !== undefined)
        .map((p) => ({
        steam: p.steam,
        away: Math.hypot(p.x - hatchling.x, p.y - hatchling.y),
    }))
        .filter((p) => p.away <= radius)
        // Closest first, so the cap keeps whoever was actually on the nest rather
        // than whoever the server listed first.
        .sort((a, b) => a.away - b.away)
        .slice(0, MAX_PARENTS)
        .map((p) => p.steam);
}
/** Who is small enough to be worth asking about, and has not been asked yet. */
export function hatchlingCandidates(players, growth, checked) {
    return players.filter((p) => p.steam !== undefined
        && p.growth <= growth
        && p.x !== undefined
        && !checked.has(p.steam));
}
/**
 * Players who have grown past the threshold and can be forgotten.
 *
 * Without this the checked set grows forever, and a player who hatches, dies
 * and hatches again is never paid for the second nest.
 */
export function grownUp(players, growth, checked) {
    const small = new Set(players.filter((p) => p.steam && p.growth <= growth).map((p) => p.steam));
    return [...checked].filter((steam) => !small.has(steam));
}
/** The in-game line. ASCII only: the mod drops anything else silently. */
export const nestAnnounce = (species, parents, points) => `NEST: a ${species} nest hatched. ${parents} parent${parents === 1 ? '' : 's'} `
    + `paid ${points} points each.`;
/** What the parent sees on their own screen. */
export const parentNotice = (species, points) => `+${points} points - your ${species} nest hatched.`;
// ------------------------------------------------------------------ running --
/**
 * Who has already been asked about, so the condition is read once per hatchling
 * rather than once per poll.
 *
 * In memory rather than in the database: it is a cache of a question, not a
 * record of a payment, and losing it on a restart costs one extra read each.
 */
const checked = new Set();
/** Test seam, and the way a restart-like reset is done. */
export const forgetChecked = () => checked.clear();
/**
 * One pass: find new hatchlings, confirm they were nested, pay the parents.
 *
 * Reads the prime flags only for players small enough to have just hatched and
 * not already asked about — normally nobody, occasionally one. Never throws:
 * a nest payout must not be able to take down the poll it rides on.
 */
export async function runNesting(ctx, players, log) {
    const settings = nestingSettings(ctx);
    if (!settings.enabled)
        return [];
    // Forget anybody who has grown up, so a later life can be paid for again.
    for (const steam of grownUp(players, settings.growth, checked))
        checked.delete(steam);
    const out = [];
    for (const hatchling of hatchlingCandidates(players, settings.growth, checked)) {
        const steam = hatchling.steam;
        // Marked before the read, not after: a read that throws must not mean
        // asking again every poll for the rest of their childhood.
        checked.add(steam);
        let nested = false;
        try {
            const state = await ctx.mod.prime(steam);
            nested = state.conditions[String(settings.condition)] === true;
        }
        catch {
            // Offline, dead, or the server did not answer. Not a nest either way.
            continue;
        }
        if (!nested)
            continue;
        const parents = parentsOf(hatchling, players, settings.radius);
        if (parents.length === 0) {
            // Genuinely happens: the parents can be dead or gone by the time the poll
            // comes round. Logged rather than paid to nobody in particular.
            log(`nesting: ${hatchling.species} hatchling ${steam} had no parent nearby`);
            continue;
        }
        for (const parent of parents) {
            ctx.db.addPoints(parent, settings.parentPoints, 0);
            void tell(ctx, parent, parentNotice(hatchling.species, settings.parentPoints));
        }
        log(`nesting: ${hatchling.species} hatched, paid ${parents.length} parent(s) `
            + `${settings.parentPoints} each`);
        out.push({
            hatchling: steam,
            species: hatchling.species,
            parents,
            points: settings.parentPoints,
        });
    }
    return out;
}
//# sourceMappingURL=nesting.js.map