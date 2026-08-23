import type { Ctx } from './commands.js';
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
export declare const MAX_TIER = 4;
export declare const TIER_LABEL: Record<number, string>;
/**
 * Every species this server knows by name, from the tier table.
 *
 * Used to seed the species roster. A species capped to zero disappears from the
 * live spawn menu, and if its cap row is later rewritten away there is nothing
 * left anywhere that remembers it existed - which strands it as unspawnable
 * with no way to name it again. This list is curated and does not move, so it
 * is the one source a lockout cannot erase.
 */
export declare const TIERED_SPECIES: string[];
export declare function tierOf(ctx: Ctx, species: string): number;
export declare function setTier(ctx: Ctx, species: string, tier: number): void;
export declare function multiplierFor(ctx: Ctx, tier: number): number;
export declare function setMultiplier(ctx: Ctx, tier: number, multiplier: number): void;
/**
 * What a kill pays.
 *
 * The victim's tier sets the base — killing something big is worth more. On top
 * of that, punching **up** pays a bonus, because a Dryosaurus that brings down
 * a Rex has done something a Rex killing a Dryosaurus has not.
 */
export declare function killReward(ctx: Ctx, killerTier: number, victimTier: number): {
    points: number;
    upset: number;
};
