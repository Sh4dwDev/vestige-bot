import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, StringSelectMenuBuilder, } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { MAX_SLOTS } from './bridge.js';
import { completePurchase } from './commands.js';
import { mutationList, speciesList } from './catalog.js';
import { describeMutation } from './mutations.js';
import { display } from './points.js';
import { buildCatalogue, mutationPrice, peekPending, priceOf, primePrice, sellable, setPending, splitMutations, takePending, totalPrice, } from './shop.js';
/**
 * The shop as a panel, for people who will never type a command.
 *
 * Mutations are the awkward part: Discord allows 25 options in a select menu
 * and this build has around forty mutations, so the list is split across two
 * menus. Each remembers its own half, which is why re-picking in one does not
 * wipe the other.
 */
const CHANNEL_KEY = 'shop_panel_channel';
export const SHOP_PANEL_MESSAGE_KEY = 'shop_panel_message';
const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2 };
export function setShopPanelChannel(ctx, channelId) {
    ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
    ctx.db.setSetting(SHOP_PANEL_MESSAGE_KEY, '');
}
export function buildShopPanel(ctx) {
    return new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle(`🛒  The ${SERVER} shop`)
        .setDescription('Spend the points you earn by playing on a **fully grown** dinosaur, ' +
        'delivered straight into your archive.\n\n' +
        'You collect it by spawning that species and pressing **Release** — so ' +
        'what you are buying is skipping the grow, not the species itself.')
        .addFields({
        name: '📋  Browse',
        value: 'Every species and what it costs, with your balance.',
    }, {
        name: '🛒  Buy',
        value: `Pick a species, add mutations if you want them (+${mutationPrice(ctx)} each), ` +
            'and confirm.',
    }, {
        name: '⚠️  Before you buy',
        value: `It uses one of your ${MAX_SLOTS} vaults, and purchases are **not ` +
            'refundable**. You need to be linked.',
    })
        .setFooter({ text: SIGNATURE });
}
export function shopPanelRows() {
    return [
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shop:browse').setLabel('Browse')
            .setEmoji('📋').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('shop:start').setLabel('Buy')
            .setEmoji('🛒').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('shop:points').setLabel('My points')
            .setEmoji('🪙').setStyle(ButtonStyle.Secondary), 
        // On the panel itself, so an unlinked visitor is never sent elsewhere.
        new ButtonBuilder().setCustomId('hub:verify').setLabel('Verify')
            .setEmoji('✅').setStyle(ButtonStyle.Success)),
    ];
}
const notLinked = () => new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle('Link your account first')
    .setDescription('Points and storage are held against your Steam account, so nothing can ' +
    'be bought until it is linked.\n\nPress **Verify** below — you will need ' +
    `to be in game on ${SERVER} to finish it.`)
    .setFooter({ text: SIGNATURE });
/**
 * Offered wherever someone is turned away for not being linked. Being told to
 * go and run a command elsewhere is a dead end; the button starts it here.
 */
const verifyRow = () => new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('hub:verify').setLabel('Verify')
    .setEmoji('✅').setStyle(ButtonStyle.Success));
/** The live basket: species, mutations chosen so far, and the running total. */
function basket(ctx, discordId, balance) {
    const held = peekPending(discordId);
    const species = held?.species ?? '';
    const chosen = held?.mutations ?? [];
    const prime = held?.prime === true;
    const price = species ? totalPrice(ctx, species, chosen, prime) : 0;
    const affordable = price <= balance;
    const embed = new EmbedBuilder()
        .setColor(species && !affordable ? COLORS.warn : COLORS.info)
        .setTitle('🛒  Buy a dinosaur')
        .setDescription(species
        ? `**${species}**, fully grown — ${priceOf(ctx, species)}\n` +
            (chosen.length
                ? `Mutations: ${chosen.join(', ')} — ${chosen.length * mutationPrice(ctx)}\n`
                : '_No mutations._\n') +
            // Elder is free, and worth saying so: it cannot be earned on a bought
            // dinosaur, so left unmentioned it reads as missing rather than given.
            'Elder: **included**\n' +
            (prime ? `Prime: **yes** — ${primePrice(ctx, species)}\n` : '_Not Prime._\n') +
            `\n**Total ${display(price).toLocaleString()}** · you have ` +
            `**${display(balance).toLocaleString()}**` +
            (affordable ? '' : '\n\n⚠️ Not enough points.')
        : 'Pick a species to begin.')
        .setFooter({ text: SIGNATURE });
    const { first, second } = splitMutations(mutationList(ctx));
    const option = (name) => {
        const description = describeMutation(name);
        return description
            ? { label: name.slice(0, 100), value: name, description: description.slice(0, 100) }
            : { label: name.slice(0, 100), value: name };
    };
    const rows = [];
    if (!species) {
        return { embed, rows };
    }
    if (first.length) {
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('shop:muta')
            .setPlaceholder('Mutations (A–M)')
            .setMinValues(0)
            .setMaxValues(Math.min(4, first.length))
            .addOptions(first.slice(0, 25).map(option))));
    }
    if (second.length) {
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('shop:mutb')
            .setPlaceholder('Mutations (N–Z)')
            .setMinValues(0)
            .setMaxValues(Math.min(4, second.length))
            .addOptions(second.slice(0, 25).map(option))));
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('shop:buy').setLabel('Buy it')
        .setEmoji('🛒').setStyle(ButtonStyle.Success).setDisabled(!affordable), 
    // One toggle rather than add/remove buttons, so the row never shows a
    // control that does nothing.
    new ButtonBuilder().setCustomId('shop:prime')
        .setLabel(prime ? 'Prime: on' : `Prime +${primePrice(ctx, species)}`)
        .setEmoji('👑').setStyle(prime ? ButtonStyle.Primary : ButtonStyle.Secondary), new ButtonBuilder().setCustomId('shop:cancel').setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)));
    return { embed, rows };
}
/** Returns true when the interaction was ours. */
export async function handleShopPanel(ctx, interaction) {
    const id = interaction.customId;
    if (!id.startsWith('shop:'))
        return false;
    if (id === 'shop:cancel' && interaction.isButton()) {
        takePending(interaction.user.id);
        await interaction.update({
            embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Cancelled')
                    .setDescription('Nothing was bought.')],
            components: [],
        });
        return true;
    }
    if (id === 'shop:prime' && interaction.isButton()) {
        const held = peekPending(interaction.user.id);
        if (held) {
            setPending(interaction.user.id, { ...held, prime: held.prime !== true });
        }
        const link = ctx.db.linkFor(interaction.user.id);
        const balance = link ? ctx.db.pointsFor(link.steamId).balance : 0;
        const { embed: next, rows } = basket(ctx, interaction.user.id, balance);
        await interaction.update({ embeds: [next], components: rows });
        return true;
    }
    if (id === 'shop:buy' && interaction.isButton()) {
        await completePurchase(ctx, interaction);
        return true;
    }
    const link = ctx.db.linkFor(interaction.user.id);
    if (id === 'shop:browse') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const balance = link ? ctx.db.pointsFor(link.steamId).balance : 0;
        await interaction.editReply({
            embeds: [buildCatalogue(ctx, await speciesList(ctx), balance)],
        });
        return true;
    }
    if (id === 'shop:points') {
        if (!link) {
            await interaction.reply({ embeds: [notLinked()], components: [verifyRow()], flags: MessageFlags.Ephemeral });
            return true;
        }
        const { balance, minutes } = ctx.db.pointsFor(link.steamId);
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🪙  Your points')
                    .setDescription(`## ${display(balance).toLocaleString()}\n` +
                    `Earned over ${Math.floor(minutes / 60)}h ${minutes % 60}m of play.`)
                    .setFooter({ text: SIGNATURE })],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (id === 'shop:start') {
        if (!link) {
            await interaction.reply({ embeds: [notLinked()], components: [verifyRow()], flags: MessageFlags.Ephemeral });
            return true;
        }
        const species = (await speciesList(ctx)).filter((name) => sellable(ctx, name));
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.info).setTitle('🛒  Buy a dinosaur')
                    .setDescription('Pick a species to begin. Apexes are not sold — growing '
                    + 'one is most of the point of playing it.')
                    .setFooter({ text: SIGNATURE })],
            components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
                    .setCustomId('shop:species')
                    .setPlaceholder('Choose a species')
                    .addOptions(species.slice(0, 25).map((name) => ({
                    label: name,
                    value: name,
                    description: `${priceOf(ctx, name)} points`,
                }))))],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (!interaction.isStringSelectMenu())
        return false;
    if (!link) {
        await interaction.update({ embeds: [notLinked()], components: [verifyRow()] });
        return true;
    }
    const balance = ctx.db.pointsFor(link.steamId).balance;
    const held = peekPending(interaction.user.id);
    if (id === 'shop:species') {
        const species = interaction.values[0] ?? '';
        setPending(interaction.user.id, {
            species,
            mutations: [],
            mutA: [],
            mutB: [],
            price: totalPrice(ctx, species, []),
            at: Date.now(),
        });
    }
    else if (id === 'shop:muta' || id === 'shop:mutb') {
        if (!held) {
            await interaction.update({
                embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Expired')
                        .setDescription('That took too long. Press **Buy** again.')],
                components: [],
            });
            return true;
        }
        // Only this menu's half is replaced; the other keeps what it had.
        const mutA = id === 'shop:muta' ? [...interaction.values] : held.mutA ?? [];
        const mutB = id === 'shop:mutb' ? [...interaction.values] : held.mutB ?? [];
        // Four across both halves, so a full second menu cannot smuggle in a fifth.
        const mutations = [...mutA, ...mutB].slice(0, 4);
        setPending(interaction.user.id, {
            species: held.species,
            mutations,
            mutA,
            mutB,
            price: totalPrice(ctx, held.species, mutations),
            at: Date.now(),
        });
    }
    const view = basket(ctx, interaction.user.id, balance);
    await interaction.update({ embeds: [view.embed], components: view.rows });
    return true;
}
//# sourceMappingURL=shoppanel.js.map