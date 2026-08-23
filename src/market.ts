import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { StoredSlot } from './bridge.js';
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
export const ESCROW = 'escrow';

const CHANNEL_KEY = 'market_channel';
export const MARKET_MESSAGE_KEY = 'market_message';
const FEE_KEY = 'market_fee_percent';

const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2 };

/** Storage is three slots; a buyer with none has nowhere to put it. */
const MAX_SLOTS = 3;

export const marketChannel = (ctx: Ctx): string | null =>
  ctx.db.getSetting(CHANNEL_KEY) || null;

export function setMarketChannel(ctx: Ctx, channelId: string | null): void {
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
  ctx.db.setSetting(MARKET_MESSAGE_KEY, '');
}

/**
 * The server's cut, as a percentage of the sale.
 *
 * Zero by default. A cut is a points sink, which a server may well want — but
 * turning one on quietly would mean sellers being paid less than the number
 * they agreed to, so it is opt-in and stated on every listing.
 */
export function marketFee(ctx: Ctx): number {
  const raw = Number.parseInt(ctx.db.getSetting(FEE_KEY) || '0', 10);
  return Number.isFinite(raw) && raw >= 0 && raw <= 50 ? raw : 0;
}

export const setMarketFee = (ctx: Ctx, percent: number): void =>
  ctx.db.setSetting(FEE_KEY, String(Math.max(0, Math.min(50, Math.round(percent)))));

/** What the seller actually receives, after any cut. */
export const sellerTakes = (price: number, feePercent: number): number =>
  Math.max(0, price - Math.floor((price * feePercent) / 100));

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
export async function slotInfo(
  ctx: Ctx,
  steamId: string,
  slot: string,
): Promise<SlotInfo | null> {
  try {
    const read = await ctx.mod.run('slotinfo', steamId, { slot }, { quiet: true });
    if (!read.ok) return null;

    const data = (read.data ?? {}) as Record<string, unknown>;
    return {
      slot: String(data['slot'] ?? slot),
      species: String(data['species'] ?? 'Unknown'),
      growth: typeof data['growth'] === 'number' ? data['growth'] : 0,
      female: data['female'] === true,
      prime: data['prime'] === true,
      elderStacks: typeof data['elderStacks'] === 'number' ? data['elderStacks'] : 0,
      mutations: Array.isArray(data['mutations']) ? data['mutations'].map(String) : [],
    };
  } catch {
    return null;
  }
}

/** How many slots somebody has used, or null when the server would not say. */
export async function slotsUsed(ctx: Ctx, steamId: string): Promise<number | null> {
  try {
    const listed = await ctx.mod.run('list', steamId, {}, { quiet: true });
    if (!listed.ok) return null;
    return Array.isArray(listed.data) ? listed.data.length : 0;
  } catch {
    return null;
  }
}

export type ListResult =
  | { ok: true; listing: Listing }
  | { ok: false; reason: string };

/**
 * Puts one of the seller's stored dinosaurs on the market.
 *
 * The dinosaur moves to escrow **before** the row is written: a listing whose
 * dinosaur is still in the seller's archive is one they can quietly take back,
 * and a buyer would find out only after paying.
 */
export async function listForSale(
  ctx: Ctx,
  sellerSteam: string,
  slot: string,
  price: number,
): Promise<ListResult> {
  if (!Number.isInteger(price) || price < 1) {
    return { ok: false, reason: 'A price has to be a whole number of points, at least 1.' };
  }

  const info = await slotInfo(ctx, sellerSteam, slot);
  if (!info) {
    return {
      ok: false,
      reason: 'That slot is empty, or the server did not answer. Nothing was listed.',
    };
  }

  let moved;
  try {
    moved = await ctx.mod.run('transfer', sellerSteam, {
      from: sellerSteam, slot, to: ESCROW,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  if (!moved.ok) return { ok: false, reason: moved.msg };

  // The escrow slot name, which may have been renamed to avoid a collision with
  // another seller's. Everything afterwards has to use this one.
  const held = (moved.data ?? {}) as Record<string, unknown>;
  const escrowSlot = typeof held['slot'] === 'string' ? held['slot'] : slot;

  const id = ctx.db.createListing({
    sellerSteam,
    slot: escrowSlot,
    species: info.species,
    growth: info.growth,
    female: info.female,
    prime: info.prime,
    mutations: info.mutations,
    price,
  });

  const listing = ctx.db.listing(id);
  return listing
    ? { ok: true, listing }
    : { ok: false, reason: 'The listing could not be saved, but the dinosaur is in escrow.' };
}

export type BuyResult =
  | { ok: true; listing: Listing; paid: number; sellerGot: number }
  | { ok: false; reason: string };

/**
 * Sells a listing to a buyer.
 *
 * Order matters and is deliberate: **claim, move, then charge**. The claim is
 * one atomic statement so two simultaneous buyers cannot both win it. The move
 * is the only step that can fail for reasons outside the bot, so it happens
 * before any points change hands — a failed move releases the claim and nobody
 * is out of pocket. Charging is a local write that does not fail on its own.
 */
export async function buyListing(
  ctx: Ctx,
  id: number,
  buyerSteam: string,
): Promise<BuyResult> {
  const listing = ctx.db.listing(id);
  if (!listing) return { ok: false, reason: 'That listing no longer exists.' };
  if (listing.status !== 'open') {
    return { ok: false, reason: 'That one is already gone.' };
  }
  if (listing.sellerSteam === buyerSteam) {
    return { ok: false, reason: 'That is your own listing. Cancel it instead.' };
  }

  const balance = ctx.db.pointsFor(buyerSteam).balance;
  if (balance < listing.price) {
    return {
      ok: false,
      reason: `That costs **${listing.price}** points and you have **${balance}**.`,
    };
  }

  // Checked before the claim: telling somebody their archive is full is much
  // better than holding the listing hostage while they go and empty it.
  const used = await slotsUsed(ctx, buyerSteam);
  if (used === null) {
    return { ok: false, reason: `${SERVER} did not answer. Nothing was bought.` };
  }
  if (used >= MAX_SLOTS) {
    return {
      ok: false,
      reason: `Your archive is full (**${used} of ${MAX_SLOTS}**). Release or delete `
        + 'one first — a bought dinosaur needs somewhere to go.',
    };
  }

  if (!ctx.db.claimListing(id, buyerSteam)) {
    return { ok: false, reason: 'Somebody got there first.' };
  }

  let moved;
  try {
    // Asked in the buyer's name, not escrow's: the mod requires a real Steam
    // ID on the request, and escrow is a holding name rather than an account.
    moved = await ctx.mod.run('transfer', buyerSteam, {
      from: ESCROW, slot: listing.slot, to: buyerSteam,
    });
  } catch (err) {
    ctx.db.releaseListing(id);
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  if (!moved.ok) {
    ctx.db.releaseListing(id);
    return { ok: false, reason: `${moved.msg} — you were not charged.` };
  }

  const fee = marketFee(ctx);
  const sellerGot = sellerTakes(listing.price, fee);

  ctx.db.addPoints(buyerSteam, -listing.price, 0);
  ctx.db.addPoints(listing.sellerSteam, sellerGot, 0);
  ctx.db.closeListing(id, 'sold');

  return {
    ok: true,
    listing: { ...listing, status: 'sold', buyerSteam },
    paid: listing.price,
    sellerGot,
  };
}

export type CancelResult = { ok: true; listing: Listing } | { ok: false; reason: string };

/** Takes a listing down and puts the dinosaur back in the seller's archive. */
export async function cancelListing(
  ctx: Ctx,
  id: number,
  bySteam: string,
): Promise<CancelResult> {
  const listing = ctx.db.listing(id);
  if (!listing) return { ok: false, reason: 'That listing no longer exists.' };
  if (listing.sellerSteam !== bySteam) {
    return { ok: false, reason: 'That is not your listing.' };
  }
  if (listing.status !== 'open') {
    return {
      ok: false,
      reason: listing.status === 'pending'
        ? 'Somebody is buying it right now.'
        : 'That listing is already closed.',
    };
  }

  // Their archive has to have room, or the dinosaur has nowhere to go back to.
  const used = await slotsUsed(ctx, bySteam);
  if (used !== null && used >= MAX_SLOTS) {
    return {
      ok: false,
      reason: `Your archive is full (**${used} of ${MAX_SLOTS}**), so there is nowhere `
        + 'to put it back. Free a slot and try again — it stays listed until then.',
    };
  }

  let moved;
  try {
    moved = await ctx.mod.run('transfer', bySteam, {
      from: ESCROW, slot: listing.slot, to: bySteam,
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  if (!moved.ok) return { ok: false, reason: moved.msg };

  ctx.db.closeListing(id, 'cancelled');
  return { ok: true, listing: { ...listing, status: 'cancelled' } };
}

// ------------------------------------------------------------------ embeds --

const percent = (growth: number): string => `${Math.round(growth * 100)}%`;

/** One line describing what is on offer, for menus and summaries. */
export const describeListing = (listing: Listing): string =>
  `${listing.species} · ${percent(listing.growth)} · ${listing.female ? 'F' : 'M'}`
  + (listing.prime ? ' · Prime' : '')
  + (listing.mutations.length > 0 ? ` · ${listing.mutations.length} mut` : '')
  + ` — ${listing.price} pts`;

export function buildListingEmbed(
  listing: Listing,
  nameFor: (steamId: string) => string,
  fee = 0,
): EmbedBuilder {
  const sold = listing.status === 'sold';
  const gone = sold || listing.status === 'cancelled';

  const embed = new EmbedBuilder()
    .setColor(sold ? COLORS.good : gone ? 0x4f545c : COLORS.info)
    .setTitle(`${sold ? '✅' : gone ? '🚫' : '🦖'}  ${listing.species}`)
    .setDescription(
      gone
        ? sold
          ? `Sold to **${nameFor(listing.buyerSteam ?? '')}** for `
            + `**${listing.price}** points.`
          : 'This listing was taken down.'
        : `**${listing.price}** points.`,
    )
    .addFields(
      {
        name: 'What it is',
        value:
          `Growth **${percent(listing.growth)}**\n`
          + `${listing.female ? '♀ Female' : '♂ Male'}\n`
          + (listing.prime ? '⭐ Prime eligible\n' : '')
          + (listing.mutations.length > 0
            ? `🧬 ${listing.mutations.join(', ')}`
            : '🧬 No mutations'),
        inline: true,
      },
      {
        name: 'Seller',
        value: nameFor(listing.sellerSteam),
        inline: true,
      },
    )
    .setFooter({ text: `Listing #${listing.id} · ${SERVER} · ${SIGNATURE}` })
    .setTimestamp(new Date(listing.listedAt));

  if (!gone) {
    embed.addFields({
      name: 'Buying it',
      value: 'Press **Buy** and it goes straight into your archive. You need a '
        + `free slot.${fee > 0 ? ` The server takes **${fee}%**.` : ''}`,
    });
  }

  return embed;
}

export const listingRows = (listing: Listing): ActionRowBuilder<ButtonBuilder>[] =>
  listing.status === 'open' || listing.status === 'pending'
    ? [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`mk:buy:${listing.id}`).setLabel('Buy')
          .setEmoji('💰').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`mk:cancel:${listing.id}`).setLabel('Take it down')
          .setEmoji('🚫').setStyle(ButtonStyle.Secondary),
      ),
    ]
    : [];

export function buildMarketPanel(ctx: Ctx): EmbedBuilder {
  const fee = marketFee(ctx);
  const open = ctx.db.openListings(1000).length;

  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🦖  Dinosaur market')
    .setDescription(
      `Sell a stored dinosaur to another player on ${SERVER}, or buy one of theirs.\n\n`
      + `**${open}** ${open === 1 ? 'listing is' : 'listings are'} open right now.`,
    )
    .addFields(
      {
        name: '📦  Selling one',
        value: 'Press **Sell**, pick something from your archive and name a price. '
          + 'It moves out of your archive while it is listed, so it cannot be '
          + 'played, released or sold twice — take the listing down to get it back.',
      },
      {
        name: '💰  Buying one',
        value: 'Press **Buy** on a listing. The points come out of your balance '
          + 'and the dinosaur lands in your archive — you need a free slot for it.'
          + (fee > 0 ? `\n\nThe server takes **${fee}%** of each sale.` : ''),
      },
      {
        name: '🤝  Both of you can be offline',
        value: 'A stored dinosaur is a record, not a living animal, so nothing '
          + 'here needs either of you to be in game.',
      },
    )
    .setFooter({ text: SIGNATURE });
}

export const marketRows = (): ActionRowBuilder<ButtonBuilder>[] => [
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('mk:sell').setLabel('Sell')
      .setEmoji('📦').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('mk:browse').setLabel('Browse')
      .setEmoji('🔎').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mk:mine').setLabel('My listings')
      .setEmoji('🧾').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('hub:verify').setLabel('Verify')
      .setEmoji('✅').setStyle(ButtonStyle.Success),
  ),
];

/** Discord allows 25 options in a select. */
const MAX_OPTIONS = 25;

/** The picker of what to sell, built from what is actually in their archive. */
export function buildSellPicker(
  slots: Array<{ slot: string; species: string }>,
): { embed: EmbedBuilder; rows: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  if (slots.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(COLORS.warn)
        .setTitle('Nothing to sell')
        .setDescription('Your archive is empty. Store a dinosaur first — only '
          + 'stored ones can be sold, because selling moves the record rather '
          + 'than the animal.')
        .setFooter({ text: SIGNATURE }),
      rows: [],
    };
  }

  return {
    embed: new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('📦  What are you selling?')
      .setDescription('Pick one, then name your price. It leaves your archive '
        + 'while it is listed.')
      .setFooter({ text: SIGNATURE }),
    rows: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('mk:pick')
          .setPlaceholder('Choose a dinosaur')
          .addOptions(slots.slice(0, MAX_OPTIONS).map((s) => ({
            label: `${s.species}`.slice(0, 100),
            description: `Slot ${s.slot}`.slice(0, 100),
            value: s.slot,
          }))),
      ),
    ],
  };
}

export function buildBrowseEmbed(
  listings: Listing[],
  nameFor: (steamId: string) => string,
): EmbedBuilder {
  if (listings.length === 0) {
    return new EmbedBuilder()
      .setColor(COLORS.warn)
      .setTitle('Nothing for sale')
      .setDescription('Nobody is selling anything right now. Press **Sell** to '
        + 'be the first.')
      .setFooter({ text: SIGNATURE });
  }

  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`🔎  ${listings.length} for sale`)
    .setDescription(
      listings
        .slice(0, 20)
        .map((l) => `**#${l.id}** · ${describeListing(l)} · ${nameFor(l.sellerSteam)}`)
        .join('\n'),
    )
    .setFooter({ text: `Buy one from its listing above · ${SIGNATURE}` });
}

// ------------------------------------------------------------ interactions --

/** In-game names where the bot has seen one, since Steam IDs mean nothing. */
const steamNameFor = (ctx: Ctx) => (steamId: string): string =>
  ctx.db.gameName(steamId) ?? steamId;

export function buildPriceModal(slot: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`mk:price:${slot}`)
    .setTitle('Name your price')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('price')
          .setLabel('Price in points')
          .setPlaceholder('e.g. 2500')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(7)
          .setRequired(true),
      ),
    );
}

/**
 * Everything the market panel does.
 *
 * Returns true when the interaction was ours, so the router can move on.
 */
export async function handleMarket(
  ctx: Ctx,
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith('mk:')) return false;

  const link = ctx.db.linkFor(interaction.user.id);
  if (!link) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Verify first')
        .setDescription('Dinosaurs and points are held against your Steam account, '
          + 'so the bot needs to know which one is yours. Press **Verify**.')],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'mk:sell' && interaction.isButton()) {
    await openSellPicker(ctx, interaction, link.steamId);
    return true;
  }

  if (id === 'mk:browse' && interaction.isButton()) {
    await interaction.reply({
      embeds: [buildBrowseEmbed(ctx.db.openListings(), steamNameFor(ctx))],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'mk:mine' && interaction.isButton()) {
    const mine = ctx.db.listingsBySeller(link.steamId);
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(mine.length > 0 ? COLORS.info : COLORS.warn)
        .setTitle('🧾  Your listings')
        .setDescription(mine.length === 0
          ? 'You have nothing on the market.'
          : `${mine.map((l) => `**#${l.id}** · ${describeListing(l)}`).join('\n')}\n\n`
            + '-# Take one down from its own listing in the market channel.')
        .setFooter({ text: SIGNATURE })],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // Picking what to sell opens the price form, carrying the slot in the modal's
  // id — a modal cannot be handed state any other way.
  if (id === 'mk:pick' && interaction.isStringSelectMenu()) {
    await interaction.showModal(buildPriceModal(interaction.values[0] ?? ''));
    return true;
  }

  if (id.startsWith('mk:price:') && interaction.isModalSubmit()) {
    await submitListing(ctx, interaction, link.steamId, id.slice('mk:price:'.length));
    return true;
  }

  if (id.startsWith('mk:buy:') && interaction.isButton()) {
    await completeBuy(ctx, interaction, link.steamId, Number(id.slice('mk:buy:'.length)));
    return true;
  }

  if (id.startsWith('mk:cancel:') && interaction.isButton()) {
    await completeCancel(ctx, interaction, link.steamId, Number(id.slice('mk:cancel:'.length)));
    return true;
  }

  return true;
}

async function openSellPicker(
  ctx: Ctx,
  interaction: ButtonInteraction,
  steamId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let slots: Array<{ slot: string; species: string }> = [];
  try {
    const listed = await ctx.mod.run('list', steamId, {}, { quiet: true });
    if (listed.ok && Array.isArray(listed.data)) {
      slots = (listed.data as StoredSlot[])
        .map((row) => ({ slot: String(row.slot ?? ''), species: String(row.species ?? 'Unknown') }))
        .filter((s) => s.slot !== '');
    }
  } catch {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('No answer')
        .setDescription(`${SERVER} did not answer, so the bot cannot see your archive.`)],
    });
    return;
  }

  // Already listed ones are gone from their archive, so the picker cannot offer
  // them by accident — the server's own list is the source of truth here.
  const picker = buildSellPicker(slots);
  await interaction.editReply({ embeds: [picker.embed], components: picker.rows });
}

async function submitListing(
  ctx: Ctx,
  interaction: ModalSubmitInteraction,
  steamId: string,
  slot: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const typed = interaction.fields.getTextInputValue('price').trim();
  const price = Number.parseInt(typed.replace(/[^\d]/g, ''), 10);

  if (!Number.isInteger(price) || price < 1) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('That is not a price')
        .setDescription(`**${typed}** is not a number of points. Nothing was listed.`)],
    });
    return;
  }

  const result = await listForSale(ctx, steamId, slot, price);
  if (!result.ok) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Not listed')
        .setDescription(result.reason)],
    });
    return;
  }

  await postListing(ctx, interaction, result.listing);

  const fee = marketFee(ctx);
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(COLORS.good).setTitle('Listed')
      .setDescription(
        `Your **${result.listing.species}** is on the market for **${price}** points.`
        + (fee > 0
          ? ` You will receive **${sellerTakes(price, fee)}** after the server's `
            + `${fee}% cut.`
          : '')
        + '\n\nIt has left your archive while it is listed, so you cannot play it. '
        + '**Take it down** to get it back.')
      .setFooter({ text: SIGNATURE })],
  });
}

/** Posts the listing publicly, and remembers where so it can be edited later. */
async function postListing(
  ctx: Ctx,
  interaction: ModalSubmitInteraction,
  listing: Listing,
): Promise<void> {
  const channelId = marketChannel(ctx);
  if (!channelId) return;

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) return;

  const sent = await channel.send({
    embeds: [buildListingEmbed(listing, steamNameFor(ctx), marketFee(ctx))],
    components: listingRows(listing),
  }).catch(() => null);

  if (sent) ctx.db.setListingMessage(listing.id, sent.id);
}

/**
 * Posts every open listing that has no message of its own, and redraws the rest.
 *
 * Each listing lives in its own message so it can carry its own Buy button and
 * be struck through the moment it sells. That only happens at the moment of
 * listing, though, so a listing made before the channel was set — or one whose
 * message somebody deleted — would have nowhere to be bought from. This is the
 * way back.
 */
export async function refreshMarket(
  ctx: Ctx,
  client: Client,
): Promise<{ posted: number; redrawn: number; missing: boolean }> {
  const channelId = marketChannel(ctx);
  if (!channelId) return { posted: 0, redrawn: 0, missing: true };

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) {
    return { posted: 0, redrawn: 0, missing: true };
  }

  let posted = 0;
  let redrawn = 0;
  const fee = marketFee(ctx);

  // Oldest first, so the channel reads in the order things were listed.
  for (const listing of [...ctx.db.openListings(1000)].reverse()) {
    const existing = listing.messageId
      ? await channel.messages.fetch(listing.messageId).catch(() => null)
      : null;

    if (existing) {
      await existing.edit({
        embeds: [buildListingEmbed(listing, steamNameFor(ctx), fee)],
        components: listingRows(listing),
      }).catch(() => undefined);
      redrawn += 1;
      continue;
    }

    const sent = await channel.send({
      embeds: [buildListingEmbed(listing, steamNameFor(ctx), fee)],
      components: listingRows(listing),
    }).catch(() => null);

    if (sent) {
      ctx.db.setListingMessage(listing.id, sent.id);
      posted += 1;
    }
  }

  return { posted, redrawn, missing: false };
}

/** Redraws a listing where it was posted, so a sold one stops offering a button. */
async function refreshListing(ctx: Ctx, client: Client, listing: Listing): Promise<void> {
  if (!listing.messageId) return;

  const channelId = marketChannel(ctx);
  if (!channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const message = await channel.messages.fetch(listing.messageId).catch(() => null);
  await message?.edit({
    embeds: [buildListingEmbed(listing, steamNameFor(ctx), marketFee(ctx))],
    components: listingRows(listing),
  }).catch(() => undefined);
}

async function completeBuy(
  ctx: Ctx,
  interaction: ButtonInteraction,
  buyerSteam: string,
  id: number,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await buyListing(ctx, id, buyerSteam);
  if (!result.ok) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Not bought')
        .setDescription(result.reason)],
    });
    return;
  }

  await refreshListing(ctx, interaction.client, result.listing);

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(COLORS.good).setTitle('Bought')
      .setDescription(
        `The **${result.listing.species}** is in your archive. `
        + `**${result.paid}** points spent.\n\n`
        + 'Release it from `/storage` when you want to play it.')
      .setFooter({ text: SIGNATURE })],
  });

  // The seller is told, because the sale happens whether or not they are looking.
  const sellerDiscord = ctx.db.linkBySteam(result.listing.sellerSteam)?.discordId;
  if (!sellerDiscord) return;

  const user = await interaction.client.users.fetch(sellerDiscord).catch(() => null);
  await user?.send({
    embeds: [new EmbedBuilder().setColor(COLORS.good).setTitle('Your dinosaur sold')
      .setDescription(
        `Your **${result.listing.species}** sold for **${result.paid}** points`
        + (result.sellerGot !== result.paid
          ? `, and **${result.sellerGot}** landed in your balance after the server's cut.`
          : '. The points are in your balance.'))
      .setFooter({ text: `${SERVER} · ${SIGNATURE}` })],
  }).catch(() => undefined);
}

async function completeCancel(
  ctx: Ctx,
  interaction: ButtonInteraction,
  bySteam: string,
  id: number,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await cancelListing(ctx, id, bySteam);
  if (!result.ok) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Still listed')
        .setDescription(result.reason)],
    });
    return;
  }

  await refreshListing(ctx, interaction.client, result.listing);

  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(COLORS.good).setTitle('Taken down')
      .setDescription(`Your **${result.listing.species}** is back in your archive.`)
      .setFooter({ text: SIGNATURE })],
  });
}
