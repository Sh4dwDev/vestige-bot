import { EmbedBuilder } from 'discord.js';
import type { Ctx } from './commands.js';
import { MAX_SLOTS } from './bridge.js';
export { MAX_SLOTS };
export declare function maxShopTier(ctx: Ctx): number;
export declare function setMaxShopTier(ctx: Ctx, tier: number): void;
/**
 * Whether the shop will sell this at all.
 *
 * Checked when buying, not only when listing. Hiding a species from the
 * catalogue while `/shop buy` still accepts it by name is not a restriction,
 * it is a secret — and the species names are public in `/population`.
 */
export declare function sellable(ctx: Ctx, species: string): boolean;
export declare function priceOf(ctx: Ctx, species: string): number;
export declare function elderStacks(ctx: Ctx): number;
export declare function setElderStacks(ctx: Ctx, stacks: number): void;
export declare function primeFactor(ctx: Ctx): number;
export declare function setPrimeFactor(ctx: Ctx, factor: number): void;
/**
 * What Prime adds to this species.
 *
 * A flat override still wins where one is set, so a server that wants one price
 * for everything can still have it.
 */
export declare function primePrice(ctx: Ctx, species: string): number;
export declare function mutationPrice(ctx: Ctx): number;
export declare function totalPrice(ctx: Ctx, species: string, mutations: string[], prime?: boolean): number;
export declare function setSpeciesPrice(ctx: Ctx, species: string, price: number): void;
export declare function setTierPrice(ctx: Ctx, tier: number, price: number): void;
export interface Pending {
    species: string;
    mutations: string[];
    price: number;
    at: number;
    /** Bought as Prime. Elder comes free either way. */
    prime?: boolean;
    /**
     * Mutations chosen from each half of the picker, kept apart so re-picking in
     * one menu replaces only that half. Discord caps a select at 25 options and
     * there are more mutations than that, so the list is split in two.
     */
    mutA?: string[];
    mutB?: string[];
}
/** The two halves of the mutation list, split so each fits a select menu. */
export declare function splitMutations(all: string[]): {
    first: string[];
    second: string[];
};
export declare function setPending(discordId: string, purchase: Pending): void;
/** Reads without consuming, for redrawing the panel as choices change. */
export declare function peekPending(discordId: string): Pending | null;
export declare function takePending(discordId: string): Pending | null;
export declare function buildCatalogue(ctx: Ctx, species: string[], balance: number): EmbedBuilder;
export declare function buildReceipt(species: string, mutations: string[], price: number, left: number, slot: string): EmbedBuilder;
