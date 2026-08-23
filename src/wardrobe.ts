import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
import { captureBaseline, encodeColours, hexToInt, restoreBaseline } from './skins.js';

/**
 * The skins a player owns, and wearing them.
 *
 * A reward skin is a **preset that has been granted**, not a second kind of
 * thing. Staff already have commands to build presets, so the only new idea
 * here is ownership — and that keeps one definition of what a look is rather
 * than two that drift.
 *
 * **Early Member skins are deliberately absent.** They live on their own panel
 * and are held by a role rather than owned, so listing them here would give two
 * answers to "do I have this" and let somebody keep wearing one after the role
 * was taken away.
 *
 * Ownership is against the **Steam account**, like points and storage, so it
 * survives unlinking. It is not against the dinosaur: a skin is worn on
 * whatever is being played, and re-worn on the next one.
 */

const CHANNEL_KEY = 'wardrobe_channel';
export const WARDROBE_MESSAGE_KEY = 'wardrobe_message';

const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2 };

/** Discord allows 25 options in a select, which is also plenty of skins. */
const MAX_LISTED = 25;

export function setWardrobeChannel(ctx: Ctx, channelId: string | null): void {
  ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
  ctx.db.setSetting(WARDROBE_MESSAGE_KEY, '');
}

export function wardrobeChannel(ctx: Ctx): string | null {
  return ctx.db.getSetting(CHANNEL_KEY) || null;
}

export function buildWardrobePanel(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🎽  Your skins')
    .setDescription(
      `Every look you have earned on ${SERVER}, in one place.\n\n` +
      'Skins are won at events and handed out by staff. They are yours for ' +
      'good — wear whichever suits what you are playing, and change as often ' +
      'as you like.',
    )
    .addFields(
      {
        name: '👕  Wear one',
        value: 'Press **My skins** while you are on a dinosaur, pick one, and ' +
          'it goes on straight away.',
      },
      {
        name: '🧼  Taking one off',
        value: '**Reset** puts the colours your dinosaur hatched with back, ' +
          'without relogging.',
      },
      {
        name: '💀  They come off when you die',
        value: 'Colours belong to the dinosaur, not to you. The bot puts your ' +
          'last one back on automatically, so this is only needed when you ' +
          'want to change.',
      },
    )
    .setFooter({ text: SIGNATURE });
}

export function wardrobeRows(): ActionRowBuilder<ButtonBuilder>[] {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('wd:mine').setLabel('My skins')
        .setEmoji('🎽').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('wd:reset').setLabel('Reset my colours')
        .setEmoji('🧼').setStyle(ButtonStyle.Secondary),
      // Somebody with no skins yet still needs a way in; sending them off to
      // find another panel is a dead end.
      new ButtonBuilder().setCustomId('hub:verify').setLabel('Verify')
        .setEmoji('✅').setStyle(ButtonStyle.Success),
    ),
  ];
}

/** The picker, built from what this player actually owns. */
export function buildPicker(
  ctx: Ctx,
  steamId: string,
): { embed: EmbedBuilder; rows: ActionRowBuilder<StringSelectMenuBuilder>[] } {
  const owned = ctx.db.ownedSkins(steamId)
    // A preset can be deleted after being granted; owning a name that no
    // longer resolves would offer a skin that cannot be worn.
    .filter((o) => ctx.db.preset(o.preset) !== null);

  if (owned.length === 0) {
    return {
      embed: new EmbedBuilder()
        .setColor(COLORS.warn)
        .setTitle('No skins yet')
        .setDescription(
          'You have not earned any yet. They are given out at events and by ' +
          'staff.\n\nEarly Member skins are on their own panel — this one only ' +
          'holds what you own.',
        )
        .setFooter({ text: SIGNATURE }),
      rows: [],
    };
  }

  const listed = owned.slice(0, MAX_LISTED);

  return {
    embed: new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('🎽  Your skins')
      .setDescription(
        `You own **${owned.length}**. Pick one to wear it on the dinosaur you ` +
        'are playing right now.' +
        (owned.length > listed.length
          ? `\n\n-# Showing the first ${listed.length}.`
          : ''),
      )
      .setFooter({ text: SIGNATURE }),
    rows: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('wd:wear')
          .setPlaceholder('Choose a skin')
          .addOptions(listed.map((o) => ({
            label: o.preset.slice(0, 100),
            value: o.preset,
            ...(o.source ? { description: o.source.slice(0, 100) } : {}),
          }))),
      ),
    ],
  };
}

/** Returns true when the interaction was ours. */
export async function handleWardrobe(
  ctx: Ctx,
  interaction: ButtonInteraction | StringSelectMenuInteraction,
): Promise<boolean> {
  const id = interaction.customId;
  if (!id.startsWith('wd:')) return false;

  const link = ctx.db.linkFor(interaction.user.id);
  if (!link) {
    await interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Verify first')
        .setDescription('Skins are held against your Steam account, so the bot ' +
          'needs to know which one is yours. Press **Verify**.')],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'wd:mine' && interaction.isButton()) {
    const { embed, rows } = buildPicker(ctx, link.steamId);
    await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (id === 'wd:reset' && interaction.isButton()) {
    await resetColours(ctx, interaction, link.steamId);
    return true;
  }

  if (id === 'wd:wear' && interaction.isStringSelectMenu()) {
    await wear(ctx, interaction, link.steamId, interaction.values[0] ?? '');
    return true;
  }

  return true;
}

/** What they are on right now, or null. Colours belong to the dinosaur. */
async function playingNow(ctx: Ctx, steamId: string): Promise<string | null> {
  const players = await ctx.mod.players().catch(() => []);
  return players.find((p) => p.steam === steamId)?.species ?? null;
}

const notOnADino = (): EmbedBuilder =>
  new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle('Not on a dinosaur')
    .setDescription(
      'Colours are painted onto the dinosaur you are playing, so you have to ' +
      'be on one. The spawn screen and admin cam have nothing to paint.',
    )
    .setFooter({ text: SIGNATURE });

async function wear(
  ctx: Ctx,
  interaction: StringSelectMenuInteraction,
  steamId: string,
  name: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Checked again here rather than trusted from the menu: a select can be
  // replayed, and the answer may have changed since it was drawn.
  if (!ctx.db.ownsSkin(steamId, name)) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Not yours')
        .setDescription('You do not own that skin.')],
    });
    return;
  }

  const look = ctx.db.preset(name);
  if (!look) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('That skin is gone')
        .setDescription(`**${name}** no longer exists. Staff can rebuild it, ` +
          'and you keep the entitlement in the meantime.')],
    });
    return;
  }

  const species = await playingNow(ctx, steamId);
  if (!species) {
    await interaction.editReply({ embeds: [notOnADino()] });
    return;
  }

  // Before the first paint, so Reset has something to put back.
  await captureBaseline(ctx, steamId, species);

  try {
    // Pattern first: it decides which parts each colour lands on, so the other
    // order paints onto whatever pattern happened to be there.
    if (look.pattern !== undefined) {
      const patterned = await ctx.mod.run('pattern', steamId, { index: look.pattern });
      if (!patterned.ok) {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Not on this species')
            .setDescription(`${patterned.msg}\n\nThis dinosaur does not have the ` +
              `pattern **${name}** needs. It will work on another species.`)],
        });
        return;
      }
    }

    const result = await ctx.mod.run('skinmany', steamId, { colors: encodeColours(look.colours) });
    if (!result.ok) {
      await interaction.editReply({
        embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Could not apply it')
          .setDescription(result.msg)],
      });
      return;
    }

    // Remembered so it goes back on after a death, which is the difference
    // between a skin and a one-off paint.
    ctx.db.setSkin(steamId, species, look.colours);

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(hexToInt(look.colours['BodyColor'] ?? '') ?? COLORS.good)
        .setTitle(`🎽  Wearing ${name}`)
        .setDescription(`On your **${species}**, and back on automatically after ` +
          'a death. Press **Reset** to take it off.')
        .setFooter({ text: SIGNATURE })],
    });
  } catch (err) {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Could not apply it')
        .setDescription(err instanceof Error ? err.message : String(err))],
    });
  }
}

async function resetColours(
  ctx: Ctx,
  interaction: ButtonInteraction,
  steamId: string,
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const species = await playingNow(ctx, steamId);
  if (!species) {
    await interaction.editReply({ embeds: [notOnADino()] });
    return;
  }

  const result = await restoreBaseline(ctx, steamId, species);
  // Cleared either way, or the resync paints it straight back on after the
  // next death and the reset looks like it never happened.
  ctx.db.clearSkin(steamId, species);

  await interaction.editReply({
    embeds: [result === 'restored'
      ? new EmbedBuilder().setColor(COLORS.good).setTitle('🧼  Colours reset')
        .setDescription(`Your ${species} is back to the colours it hatched with.`)
        .setFooter({ text: SIGNATURE })
      : new EmbedBuilder().setColor(COLORS.warn).setTitle('Nothing to go back to')
        .setDescription(`No original colours were recorded for this ${species}, ` +
          'so there is nothing to restore. The skin is forgotten either way, so ' +
          'it will not return after a death.')
        .setFooter({ text: SIGNATURE })],
  });
}
