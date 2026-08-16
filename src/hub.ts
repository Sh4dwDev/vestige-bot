import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import { beginLink, describeError, runSlay, type Ctx } from './commands.js';
import { showPanel } from './panel.js';

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
  interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction,
): Promise<boolean> {
  const id = interaction.customId;
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
          '**Slay** — kill it. Nothing is kept.',
        )
        .setFooter({ text: SIGNATURE })],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId('hub:archive').setLabel('Open archive')
          .setEmoji('🏛️').setStyle(ButtonStyle.Success),
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

  if (id === 'hub:stats') {
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('📊  Stats')
        .setDescription(
          `\`/population\` — what is roaming ${SERVER} right now\n` +
          '`/points` — what you have earned, `/points top` for the leaderboard\n' +
          '`/kills top` — the deadliest players, `/kills me` for your record',
        )
        .setFooter({ text: SIGNATURE })],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}
