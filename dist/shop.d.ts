import { EmbedBuilder } from 'discord.js';
import type { Ctx } from './commands.js';
import { MAX_SLOTS } from './bridge.js';
export { MAX_SLOTS };
export declare function priceOf(ctx: Ctx, species: string): number;
export declare function mutationPrice(ctx: Ctx): number;
export declare function totalPrice(ctx: Ctx, species: string, mutations: string[]): number;
export declare function setSpeciesPrice(ctx: Ctx, species: string, price: number): void;
export declare function setTierPrice(ctx: Ctx, tier: number, price: number): void;
export interface Pending {
    species: string;
    mutations: string[];
    price: number;
    at: number;
}
export declare function setPending(discordId: string, purchase: Pending): void;
export declare function takePending(discordId: string): Pending | null;
export declare function buildCatalogue(ctx: Ctx, species: string[], balance: number): EmbedBuilder;
export declare function buildReceipt(species: string, mutations: string[], price: number, left: number, slot: string): EmbedBuilder;
