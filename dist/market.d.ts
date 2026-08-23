import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, type ButtonInteraction, type Client, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import type { Ctx } from './commands.js';
import type { Listing } from './db.js';
/**
 * Players selling stored dinosaurs to each other.
 *
 * **Why this is safe to build at all:** a stored dinosaur is a file and an
 * index row on the game server, not a pawn. So a sale is a rename — no
 * respawn, no `RequestRespawn`, none of the engine risk that killed the AI
 * work. It also completes while both parties are offline, which is what makes
 * a market rather than a handshake.
 *
 * **Escrow.** A listed dinosaur is moved out of the seller's archive into a
 * holding account the moment it is listed. Without that, the seller could
 * restore it, delete it, or list it twice and sell the same animal to three
 * people. The mod exempts that account from the slot cap because it holds the
 * whole server's listings, not one person's.
 *
 * **Fixed price only, deliberately.** Bidding needs a clock, a bid history and
 * a way to unwind a bid nobody can pay — every one of which is a place to lose
 * somebody's dinosaur. Sold-at-a-price works, and can be extended later.
 */
/** Must match ESCROW in the mod. A name, not a Steam ID, so it cannot collide. */
export declare const ESCROW = "escrow";
export declare const MARKET_MESSAGE_KEY = "market_message";
export declare const marketChannel: (ctx: Ctx) => string | null;
export declare function setMarketChannel(ctx: Ctx, channelId: string | null): void;
/**
 * The server's cut, as a percentage of the sale.
 *
 * Zero by default. A cut is a points sink, which a server may well want — but
 * turning one on quietly would mean sellers being paid less than the number
 * they agreed to, so it is opt-in and stated on every listing.
 */
export declare function marketFee(ctx: Ctx): number;
export declare const setMarketFee: (ctx: Ctx, percent: number) => void;
/** What the seller actually receives, after any cut. */
export declare const sellerTakes: (price: number, feePercent: number) => number;
export interface SlotInfo {
    slot: string;
    species: string;
    growth: number;
    female: boolean;
    prime: boolean;
    elderStacks: number;
    mutations: string[];
}
/** Reads what is actually in one of somebody's slots. */
export declare function slotInfo(ctx: Ctx, steamId: string, slot: string): Promise<SlotInfo | null>;
/** How many slots somebody has used, or null when the server would not say. */
export declare function slotsUsed(ctx: Ctx, steamId: string): Promise<number | null>;
export type ListResult = {
    ok: true;
    listing: Listing;
} | {
    ok: false;
    reason: string;
};
/**
 * Puts one of the seller's stored dinosaurs on the market.
 *
 * The dinosaur moves to escrow **before** the row is written: a listing whose
 * dinosaur is still in the seller's archive is one they can quietly take back,
 * and a buyer would find out only after paying.
 */
export declare function listForSale(ctx: Ctx, sellerSteam: string, slot: string, price: number): Promise<ListResult>;
export type BuyResult = {
    ok: true;
    listing: Listing;
    paid: number;
    sellerGot: number;
} | {
    ok: false;
    reason: string;
};
/**
 * Sells a listing to a buyer.
 *
 * Order matters and is deliberate: **claim, move, then charge**. The claim is
 * one atomic statement so two simultaneous buyers cannot both win it. The move
 * is the only step that can fail for reasons outside the bot, so it happens
 * before any points change hands — a failed move releases the claim and nobody
 * is out of pocket. Charging is a local write that does not fail on its own.
 */
export declare function buyListing(ctx: Ctx, id: number, buyerSteam: string): Promise<BuyResult>;
export type CancelResult = {
    ok: true;
    listing: Listing;
} | {
    ok: false;
    reason: string;
};
/** Takes a listing down and puts the dinosaur back in the seller's archive. */
export declare function cancelListing(ctx: Ctx, id: number, bySteam: string): Promise<CancelResult>;
/** One line describing what is on offer, for menus and summaries. */
export declare const describeListing: (listing: Listing) => string;
export declare function buildListingEmbed(listing: Listing, nameFor: (steamId: string) => string, fee?: number): EmbedBuilder;
export declare const listingRows: (listing: Listing) => ActionRowBuilder<ButtonBuilder>[];
export declare function buildMarketPanel(ctx: Ctx): EmbedBuilder;
export declare const marketRows: () => ActionRowBuilder<ButtonBuilder>[];
/** The picker of what to sell, built from what is actually in their archive. */
export declare function buildSellPicker(slots: Array<{
    slot: string;
    species: string;
}>): {
    embed: EmbedBuilder;
    rows: ActionRowBuilder<StringSelectMenuBuilder>[];
};
export declare function buildBrowseEmbed(listings: Listing[], nameFor: (steamId: string) => string): EmbedBuilder;
export declare function buildPriceModal(slot: string): ModalBuilder;
/**
 * Everything the market panel does.
 *
 * Returns true when the interaction was ours, so the router can move on.
 */
export declare function handleMarket(ctx: Ctx, interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean>;
/**
 * Posts every open listing that has no message of its own, and redraws the rest.
 *
 * Each listing lives in its own message so it can carry its own Buy button and
 * be struck through the moment it sells. That only happens at the moment of
 * listing, though, so a listing made before the channel was set — or one whose
 * message somebody deleted — would have nowhere to be bought from. This is the
 * way back.
 */
export declare function refreshMarket(ctx: Ctx, client: Client): Promise<{
    posted: number;
    redrawn: number;
    missing: boolean;
}>;
