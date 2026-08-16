import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type APIEmbedField,
  type ChatInputCommandInteraction,
} from 'discord.js';

import { AdminStore } from './admins.js';
import { ARCHIVE_CAP, SERVER, SIGNATURE } from './brand.js';
import type { ModBridge } from './bridge.js';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { buildCommandsEmbed, buildStorageGuideEmbed } from './guides.js';
import { refreshPopulationPanel, setPopulationChannel } from './livepanel.js';
import { showPanel, stopAutoRefresh } from './panel.js';
import { postOrEdit } from './pinned.js';
import { buildPopulationEmbed } from './population.js';
import type { EvrimaRcon } from './rcon.js';

export interface Ctx {
  config: Config;
  db: Database;
  rcon: EvrimaRcon;
  mod: ModBridge;
  admins: AdminStore;
}

const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2, quiet: 0x4f545c };

function embed(color: number, title: string, description?: string, fields?: APIEmbedField[]): EmbedBuilder {
  const e = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setTimestamp()
    // The bot signs everything it says, so its voice is recognisable even on a
    // one-line confirmation.
    .setFooter({ text: SIGNATURE });
  if (description) e.setDescription(description);
  if (fields?.length) e.addFields(fields);
  return e;
}

const isSteamId = (v: string): boolean => /^7656119\d{10}$/.test(v);

/**
 * The /link reply, kept so the watcher can turn it into "linked" in place once
 * the player types their code in game.
 *
 * Better than a DM: it stays in the channel they are already looking at, only
 * they can see it, and plenty of people have DMs closed. Interaction tokens are
 * valid for 15 minutes, which is longer than the code itself lasts.
 */
const linkReplies = new Map<string, ChatInputCommandInteraction>();

export async function announceLinked(discordId: string): Promise<boolean> {
  const interaction = linkReplies.get(discordId);
  linkReplies.delete(discordId);
  if (!interaction) return false;

  try {
    await interaction.editReply({
      embeds: [embed(COLORS.good, 'Recognised',
        `${ARCHIVE_CAP} knows you now.\n\n` +
        'Run `/storage` while playing a fully grown dinosaur to commit it.')],
    });
    return true;
  } catch {
    // The token expired, or the message was dismissed.
    return false;
  }
}

export const commandData = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription(`Let ${SERVER} recognise your Steam account`)
    .addStringOption((o) =>
      o.setName('steamid').setDescription('Your Steam64 ID (17 digits)').setRequired(true)
        .setMinLength(17).setMaxLength(17),
    ),


  new SlashCommandBuilder().setName('unlink').setDescription('Disconnect your Steam account'),

  new SlashCommandBuilder().setName('slay').setDescription('Kill your own dinosaur'),

  new SlashCommandBuilder()
    .setName('storage')
    .setDescription('Open your archive'),

  new SlashCommandBuilder()
    .setName('population')
    .setDescription(`What is roaming ${SERVER} right now`),

  // Deliberately not hidden behind setDefaultMemberPermissions: staff who are
  // on the bot's own admin list may not hold Manage Server, and a command they
  // cannot see is a command they cannot use. The check happens in code.
  new SlashCommandBuilder()
    .setName('admin')
    .setDescription(`Manage ${SERVER} and bot administrators`)
    .addSubcommandGroup((g) =>
      g.setName('game').setDescription('In-game admins (Game.ini)')
        .addSubcommand((s) =>
          s.setName('add').setDescription('Grant in-game admin')
            .addStringOption((o) =>
              o.setName('steamid').setDescription('Steam64 ID (17 digits)')
                .setRequired(true).setMinLength(17).setMaxLength(17)))
        .addSubcommand((s) =>
          s.setName('remove').setDescription('Revoke in-game admin')
            .addStringOption((o) =>
              o.setName('steamid').setDescription('Steam64 ID (17 digits)')
                .setRequired(true).setMinLength(17).setMaxLength(17)))
        .addSubcommand((s) => s.setName('list').setDescription('Show in-game admins')),
    )
    .addSubcommandGroup((g) =>
      g.setName('bot').setDescription('Who may use these commands')
        .addSubcommand((s) =>
          s.setName('add').setDescription('Allow someone to use /admin')
            .addUserOption((o) => o.setName('user').setDescription('Discord member').setRequired(true)))
        .addSubcommand((s) =>
          s.setName('remove').setDescription('Stop someone using /admin')
            .addUserOption((o) => o.setName('user').setDescription('Discord member').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('Show bot admins')),
    )
    .addSubcommandGroup((g) =>
      g.setName('population').setDescription('The self-updating population panel')
        .addSubcommand((s) =>
          s.setName('channel').setDescription('Put the live population panel in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it should live')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((s) => s.setName('off').setDescription('Stop updating the panel')),
    )
    .addSubcommandGroup((g) =>
      g.setName('guide').setDescription('The storage guide')
        .addSubcommand((s) =>
          s.setName('channel').setDescription('Post the storage guide in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it should live')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('commands').setDescription('The command reference')
        .addSubcommand((s) =>
          s.setName('channel').setDescription('Post the command list in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it should live')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
    ),
].map((b) => b.toJSON());

export async function handleCommand(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  switch (i.commandName) {
    case 'link': return handleLink(ctx, i);
    case 'unlink': return handleUnlink(ctx, i);
    case 'slay': return handleSlay(ctx, i);
    case 'storage': return handleStorage(ctx, i);
    case 'population': return handlePopulation(ctx, i);
    case 'admin': return handleAdmin(ctx, i);
    default:
      await i.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
  }
}

// ---------------------------------------------------------------- linking --

async function handleLink(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const steamId = i.options.getString('steamid', true).trim();
  if (!isSteamId(steamId)) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'That is not a Steam64 ID',
        'It is 17 digits and starts with 7656119. You can find yours on steamid.io.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const taken = ctx.db.linkBySteam(steamId);
  if (taken && taken.discordId !== i.user.id) {
    await i.reply({
      embeds: [embed(COLORS.bad, 'Already linked',
        'That Steam account is connected to a different Discord account.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const online = await ctx.rcon.players();
  if (!online.some((p) => p.steamId === steamId)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, `You need to be on ${SERVER}`,
        `Join ${SERVER}, then run \`/link\` again — you finish this in game chat.`)],
    });
    return;
  }

  // No 0/O/1/I: this gets read off one screen and typed on another.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let n = 0; n < 6; n += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];

  ctx.db.setPending(i.user.id, steamId, code, ctx.config.linkCodeTtlMinutes * 60_000);

  // Typing the code IN GAME is what proves they control the Steam account —
  // only someone playing as it can put it in that account's chat.
  linkReplies.set(i.user.id, i);
  await i.editReply({
    embeds: [embed(COLORS.info, 'Prove it is you',
      `Type this in **game chat**:\n\n\`\`\`\n!link ${code}\n\`\`\`\n` +
      `${ARCHIVE_CAP} will recognise you within a few seconds. The code lasts ` +
      `${ctx.config.linkCodeTtlMinutes} minutes.`)],
  });
}

async function handleUnlink(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.quiet, 'Nothing to forget', `${ARCHIVE_CAP} has no record of you.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  ctx.db.removeLink(i.user.id);
  stopAutoRefresh(i.user.id);
  await i.reply({
    embeds: [embed(COLORS.good, 'Forgotten',
      'Whatever you had kept stays in the archive, and is yours again the moment you link back.')],
    flags: MessageFlags.Ephemeral,
  });
}

// ------------------------------------------------------------------- slay --

/** Confirmation for anything that destroys a dinosaur. */
async function confirm(
  i: ChatInputCommandInteraction,
  prompt: EmbedBuilder,
  label: string,
): Promise<boolean> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('yes').setLabel(label).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const message = await i.editReply({ embeds: [prompt], components: [row] });

  try {
    const click = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (c) => c.user.id === i.user.id,
      time: 30_000,
    });
    await click.deferUpdate();
    return click.customId === 'yes';
  } catch {
    // Clear the buttons so a stale prompt cannot be clicked later.
    await i.editReply({
      embeds: [embed(COLORS.quiet, 'Timed out', 'Nothing was changed.')],
      components: [],
    });
    return false;
  }
}

/**
 * Only ever targets the caller's own dinosaur — the Steam ID comes from the
 * link table, never from user input, so this cannot be pointed at anyone else.
 */
async function handleSlay(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        `Join ${SERVER} and run \`/link\` so it knows which dinosaur is yours.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const proceed = await confirm(
      i,
      embed(COLORS.warn, 'Kill your dinosaur?',
        'Nothing is kept. If you want it back later, use `/storage` instead.'),
      'Kill it',
    );

    if (!proceed) {
      await i.editReply({
        embeds: [embed(COLORS.quiet, 'Cancelled', 'Your dinosaur is fine.')],
        components: [],
      });
      return;
    }

    const result = await ctx.mod.run('slay', link.steamId);

    await i.editReply({
      embeds: [result.ok
        ? embed(COLORS.good, 'It is done', `${result.msg}.\n\nSpawn again whenever you like.`)
        : embed(COLORS.bad, 'Could not do that', result.msg)],
      components: [],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Something went wrong', describeError(err))],
      components: [],
    });
  }
}

// ------------------------------------------------------------- population --

/** Public: no link needed, and it names nobody. */
async function handlePopulation(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply();

  try {
    const players = await ctx.mod.players();
    await i.editReply({ embeds: [buildPopulationEmbed(players)] });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, `Could not read ${SERVER}`, describeError(err))],
    });
  }
}

// ---------------------------------------------------------------- storage --

/** Opens the panel; every action from here on is a button. */
async function handleStorage(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        'The archive works on your live dinosaur, so it needs to know which account is yours.\n\n' +
        `Join ${SERVER} and run \`/link\`.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await showPanel(ctx, i, i.user.id, link.steamId);
}

// ------------------------------------------------------------------ admin --

/**
 * Manage Server is the bootstrap: it always works, so the server owner can
 * never lock themselves out of their own bot, and it is how the first entry on
 * the bot admin list gets added.
 */
function mayAdminister(ctx: Ctx, i: ChatInputCommandInteraction): boolean {
  if (i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  return ctx.db.isBotAdmin(i.user.id);
}

async function handleAdmin(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  if (!mayAdminister(ctx, i)) {
    await i.reply({
      embeds: [embed(COLORS.bad, 'Not allowed',
        'You need **Manage Server**, or an entry on the bot admin list.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const group = i.options.getSubcommandGroup(true);
  const action = i.options.getSubcommand(true);

  if (group === 'bot') return handleBotAdmin(ctx, i, action);
  if (group === 'population') return handlePopulationPanel(ctx, i, action);
  if (group === 'guide') return handleReferencePanel(ctx, i, 'guide');
  if (group === 'commands') return handleReferencePanel(ctx, i, 'commands');
  return handleGameAdmin(ctx, i, action);
}

/**
 * The two static reference embeds. Unlike the population panel these never
 * change on their own, so nothing polls them — re-running the command is how
 * you move or refresh one.
 */
async function handleReferencePanel(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  which: 'guide' | 'commands',
): Promise<void> {
  const channel = i.options.getChannel('channel', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const panel = which === 'guide' ? buildStorageGuideEmbed() : buildCommandsEmbed();
  const key = which === 'guide' ? 'guide_message' : 'commands_message';
  const label = which === 'guide' ? 'Storage guide' : 'Command list';

  try {
    await postOrEdit(ctx.db, i.client, channel.id, key, [panel]);
    await i.editReply({
      embeds: [embed(COLORS.good, `${label} posted`,
        `It is in <#${channel.id}>.\n\n` +
        'Run this again to update it or move it — the same message is reused ' +
        'rather than a second one posted.')],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post there',
        `${describeError(err)}\n\nCheck the bot can **View Channel**, ` +
        '**Send Messages** and **Embed Links** there.')],
    });
  }
}

async function handlePopulationPanel(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'off') {
    setPopulationChannel(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.good, 'Panel stopped',
        'The existing message stays where it is; it just will not update any more.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = i.options.getChannel('channel', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  setPopulationChannel(ctx, channel.id);

  try {
    await refreshPopulationPanel(ctx, i.client);
    await i.editReply({
      embeds: [embed(COLORS.good, 'Panel is live',
        `The population panel is in <#${channel.id}> and updates every minute.\n\n` +
        'If someone deletes the message, the bot posts a new one on the next update.')],
    });
  } catch (err) {
    // Leave the setting in place: the usual cause is a missing permission, and
    // the panel starts working by itself once that is fixed.
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post there',
        `${describeError(err)}\n\nCheck the bot can **View Channel**, ` +
        '**Send Messages** and **Embed Links** there.')],
    });
  }
}

async function handleBotAdmin(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'list') {
    const ids = ctx.db.botAdmins();
    await i.reply({
      embeds: [embed(COLORS.info, 'Bot admins',
        ids.length
          ? ids.map((id) => `<@${id}>`).join('\n')
          : 'Nobody yet. Anyone with **Manage Server** can already use these commands.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = i.options.getUser('user', true);
  if (user.bot) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'That is a bot', 'Pick a person instead.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'add') {
    ctx.db.addBotAdmin(user.id, i.user.id);
    await i.reply({
      embeds: [embed(COLORS.good, 'Bot admin added',
        `${user} can now use \`/admin\`.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const removed = ctx.db.removeBotAdmin(user.id);
  await i.reply({
    embeds: [removed
      ? embed(COLORS.good, 'Bot admin removed', `${user} can no longer use \`/admin\`.`)
      : embed(COLORS.quiet, 'Nothing to do', `${user} was not on the list.`)],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * The database is authoritative and Game.ini is caught up separately, because
 * the server rewrites that file when it stops — see AdminStore.
 */
async function handleGameAdmin(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (action === 'list') {
      const desired = ctx.db.gameAdmins();
      const live = AdminStore.parseAdmins(await ctx.admins.readIni());
      const pending = desired.filter((id) => !live.includes(id));
      const leaving = live.filter((id) => !desired.includes(id));

      const describe = (id: string): string => {
        const link = ctx.db.linkBySteam(id);
        const who = link ? ` — <@${link.discordId}>` : '';
        const mark = live.includes(id) ? '🟢' : '🟡';
        return `${mark} \`${id}\`${who}`;
      };

      const lines = desired.length ? desired.map(describe).join('\n') : '_Nobody._';
      const note = pending.length || leaving.length
        ? `\n\n🟡 ${pending.length + leaving.length} change(s) waiting — they apply at the ` +
          'next server restart.'
        : '\n\nGame.ini is up to date.';

      await i.editReply({
        embeds: [embed(COLORS.info, 'In-game admins', lines + note)],
      });
      return;
    }

    const steamId = i.options.getString('steamid', true).trim();
    if (!isSteamId(steamId)) {
      await i.editReply({
        embeds: [embed(COLORS.warn, 'That is not a Steam64 ID',
          'It is 17 digits and starts with 7656119.')],
      });
      return;
    }

    if (action === 'add') {
      if (ctx.db.gameAdmins().includes(steamId)) {
        await i.editReply({
          embeds: [embed(COLORS.quiet, 'Already an admin', `\`${steamId}\` is already on the list.`)],
        });
        return;
      }
      ctx.db.addGameAdmin(steamId, i.user.id);
    } else {
      if (!ctx.db.removeGameAdmin(steamId)) {
        await i.editReply({
          embeds: [embed(COLORS.quiet, 'Not an admin', `\`${steamId}\` was not on the list.`)],
        });
        return;
      }
    }

    // Try to apply straight away; it only lands if the server is currently down.
    const serverUp = await ctx.rcon.players().then(() => true).catch(() => false);
    const outcome = await ctx.admins.reconcile(serverUp);

    const verb = action === 'add' ? 'added' : 'removed';
    await i.editReply({
      embeds: [embed(COLORS.good, `Admin ${verb}`,
        `\`${steamId}\` was ${verb}.\n\n` +
        (outcome === 'applied'
          ? '**Applied to Game.ini now.** It takes effect when the server starts.'
          : '**Queued.** The server rewrites its config when it shuts down, so the ' +
            'change is written during the next restart — no action needed from you.'))],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not reach the config file', describeError(err))],
    });
  }
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
