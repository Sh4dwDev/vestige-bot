import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
} from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import { handleShopPanel } from './shoppanel.js';
import {
  beginLink,
  describeError,
  runSlay,
  startTeleport,
  steamNamer,
  type Ctx,
} from './commands.js';
import { buildKillsEmbed } from './kills.js';
import { showPanel } from './panel.js';
import { buildBalanceEmbed, buildLeaderboardEmbed, ratePerHour } from './points.js';
import { buildPopulationEmbed } from './population.js';
import { clearRequest, requestFor, runAccepted } from './teleport.js';

/**
 * One panel in a channel, with everything behind category buttons.
 *
 * Nobody has to know a command name to use the bot: they press a category and
 * get the actions they can actually take, privately.
 *
 * The buttons carry no state, so this message keeps working forever — including
 * across bot restarts and redeploys. A panel that quietly stops responding
 * after a restart is worse than no panel.
 */

const CHANNEL_KEY = 'hub_channel';
export const HUB_MESSAGE_KEY = 'hub_message';

const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2 };

export function setHubChannel(ctx: Ctx, channelId: string | null): void {
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
  ctx.db.setSetting(HUB_MESSAGE_KEY, '');
}

export function buildHubEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle(`🦕  ${SERVER} Panel`)
    .setDescription(
      `Everything ${SERVER} can do for you, in one place. Pick a category — ` +
      'only you see what comes back.\n\n' +
      '📌 You must be **in game** to store, release or slay.\n' +
      '💡 Browsing and stats work any time.',
    )
    .addFields(
      {
        name: '🏛️  Archive',
        value: 'Store a dinosaur, release one, rename or discard.',
      },
      {
        name: '🎮  In-game actions',
        value: 'Things that act on your live dinosaur — storing and slaying.',
      },
      {
        name: '📊  Stats',
        value: 'Population, points and the kill leaderboard.',
      },
      {
        name: '✅  Verify (required)',
        value: 'Link your Steam account. Nothing that touches your dinosaur works until you do.',
      },
    )
    .setFooter({ text: SIGNATURE });
}

export function hubRows(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('hub:archive').setLabel('Archive')
        .setEmoji('🏛️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('hub:ingame').setLabel('In-game actions')
        .setEmoji('🎮').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('hub:stats').setLabel('Stats')
        .setEmoji('📊').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('hub:verify').setLabel('Verify')
        .setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
  ];
}

function verifyModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('hub:verifymodal')
    .setTitle(`Verify with ${SERVER}`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('steamid')
          .setLabel('Your Steam64 ID')
          .setPlaceholder('7656119…  (17 digits)')
          .setStyle(TextInputStyle.Short)
          .setMinLength(17)
          .setMaxLength(17)
          .setRequired(true),
      ),
    );
}

const notLinked = (): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle('Verify first')
    .setDescription(
      'This acts on your live dinosaur, so the bot needs to know which account ' +
      'is yours.\n\nPress **Verify** on the panel — it takes about ten seconds.',
    )
    .setFooter({ text: SIGNATURE });

/** Returns true when the interaction was ours. */
export async function handleHubInteraction(
  ctx: Ctx,
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
    | UserSelectMenuInteraction,
): Promise<boolean> {
  const id = interaction.customId;

  // Accept/decline arrive as a DM button, so they are handled here rather than
  // on the panel — the person answering may never have opened the panel.
  if (id.startsWith('tp:') && interaction.isButton()) {
    const [, answer] = id.split(':');
    const link = ctx.db.linkFor(interaction.user.id);
    const request = link ? requestFor(link.steamId) : null;

    if (!request) {
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Too late')
          .setDescription('That request has expired or was already answered.')],
        components: [],
      });
      return true;
    }

    clearRequest(request.toSteam);

    if (answer === 'no') {
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Declined')
          .setDescription('They have not been moved.')],
        components: [],
      });
      await ctx.mod.notify(request.fromSteam, 'Your travel request was declined');
      return true;
    }

    request.accepted = true;
    await interaction.update({
      embeds: [new EmbedBuilder().setColor(COLORS.good).setTitle('Accepted')
        .setDescription('They will arrive shortly. You do not need to do anything else.')],
      components: [],
    });

    // Not awaited: it waits out the delay before moving them.
    void runAccepted(ctx, interaction.client, request, () => {});
    return true;
  }

  // The shop panel owns everything prefixed shop:, including the confirm
  // buttons that /shop buy also raises.
  if (id.startsWith('shop:') && (interaction.isButton() || interaction.isStringSelectMenu())) {
    return handleShopPanel(ctx, interaction);
  }

  if (!id.startsWith('hub:')) return false;

  // The modal has to be the first response, so it cannot be deferred first.
  if (id === 'hub:verify' && interaction.isButton()) {
    await interaction.showModal(verifyModal());
    return true;
  }

  if (id === 'hub:verifymodal' && interaction.isModalSubmit()) {
    const steamId = interaction.fields.getTextInputValue('steamid');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await beginLink(ctx, interaction, interaction.user.id, steamId);
    return true;
  }

  if (interaction.isUserSelectMenu() && id === 'hub:tppick') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await startTeleport(ctx, interaction, interaction.values[0] ?? '');
    return true;
  }

  if (!interaction.isButton()) return false;

  const link = ctx.db.linkFor(interaction.user.id);

  if (id === 'hub:archive') {
    if (!link) {
      await interaction.reply({ embeds: [notLinked()], flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await showPanel(ctx, interaction, interaction.user.id, link.steamId);
    return true;
  }

  if (id === 'hub:ingame') {
    if (!link) {
      await interaction.reply({ embeds: [notLinked()], flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('🎮  In-game actions')
        .setDescription(
          'These act on the dinosaur you are playing right now, so you must be ' +
          'on the server.\n\n' +
          '**Open archive** — store this dinosaur, or release one you kept.\n' +
          '**Travel to a friend** — they have to agree, and you move a short while after.\n' +
          '**Slay** — kill it. Nothing is kept.',
        )
        .setFooter({ text: SIGNATURE })],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('hub:archive').setLabel('Open archive')
          .setEmoji('🏛️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('hub:teleport').setLabel('Travel to a friend')
          .setEmoji('🧭').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('hub:slay').setLabel('Slay')
          .setEmoji('💀').setStyle(ButtonStyle.Danger),
      )],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'hub:slay') {
    if (!link) {
      await interaction.reply({ embeds: [notLinked()], flags: MessageFlags.Ephemeral });
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await runSlay(ctx, interaction, link.steamId);
    } catch (err) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Something went wrong')
          .setDescription(describeError(err))],
        components: [],
      });
    }
    return true;
  }

  if (id === 'hub:teleport') {
    if (!link) {
      await interaction.reply({ embeds: [notLinked()], flags: MessageFlags.Ephemeral });
      return true;
    }
    // A user picker beats asking them to type a name — and it only offers
    // people who are actually in the server.
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('🧭  Travel to a friend')
        .setDescription(
          'Pick who you want to go to. They have to agree — with a button here ' +
          'or `!accept` in game — and you move a short while after they do.\n\n' +
          'You both need to be spawned in.',
        )
        .setFooter({ text: SIGNATURE })],
      components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder().setCustomId('hub:tppick').setPlaceholder('Choose a friend'),
      )],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'hub:stats') {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('📊  Stats')
        .setDescription(
          `Everything ${SERVER} keeps track of. All of it is public except your ` +
          'own balance, which only you can see.',
        )
        .setFooter({ text: SIGNATURE })],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('hub:population').setLabel('Population')
          .setEmoji('🦕').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('hub:mypoints').setLabel('My points')
          .setEmoji('🪙').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('hub:toppoints').setLabel('Top points')
          .setEmoji('🏆').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('hub:kills').setLabel('Kills')
          .setEmoji('⚔️').setStyle(ButtonStyle.Secondary),
      )],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'hub:population') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await interaction.editReply({
        embeds: [buildPopulationEmbed(await ctx.mod.players())],
      });
    } catch {
      // Same embed the pinned panel shows when the server is unreachable.
      await interaction.editReply({
        embeds: [buildPopulationEmbed([], { unreachable: true })],
      });
    }
    return true;
  }

  if (id === 'hub:toppoints') {
    await interaction.reply({
      embeds: [buildLeaderboardEmbed(ctx.db.topPoints(10), steamNamer(ctx))],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'hub:kills') {
    await interaction.reply({
      embeds: [buildKillsEmbed(ctx.db.topKillers(10), ctx.db.killTotals(), steamNamer(ctx))],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'hub:mypoints') {
    if (!link) {
      await interaction.reply({ embeds: [notLinked()], flags: MessageFlags.Ephemeral });
      return true;
    }
    const { balance, minutes } = ctx.db.pointsFor(link.steamId);
    await interaction.reply({
      embeds: [buildBalanceEmbed(balance, minutes, ratePerHour(ctx))],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}
