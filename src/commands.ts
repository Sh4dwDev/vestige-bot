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
  type AutocompleteInteraction,
  type Client,
  type ChatInputCommandInteraction,
  type Message,
} from 'discord.js';

import { AdminStore } from './admins.js';
import { ARCHIVE_CAP, SERVER, SIGNATURE } from './brand.js';
import type { ModBridge } from './bridge.js';
import type { Config } from './config.js';
import type { Database } from './db.js';
import { buildCommandsEmbed, buildStorageGuideEmbed } from './guides.js';
import { refreshPopulationPanel, setPopulationChannel } from './livepanel.js';
import { mutationList, speciesList, suggest } from './catalog.js';
import { isRemoved, mutationChoices } from './mutations.js';
import { cleanSlotName, showPanel, stopAutoRefresh } from './panel.js';
import {
  addRequest,
  askEmbed,
  askRows,
  cooldownMinutes,
  delaySeconds,
  requestFor,
} from './teleport.js';
import { buildHubEmbed, hubRows, HUB_MESSAGE_KEY, setHubChannel } from './hub.js';
import { buildKillsEmbed, setKillfeedChannel } from './kills.js';
import { postOrEdit } from './pinned.js';
import {
  buildBalanceEmbed,
  buildLeaderboardEmbed,
  display,
  ratePerHour,
  setRatePerHour,
} from './points.js';
import type { Panel } from './pterodactyl.js';
import {
  nextRestart,
  restartSettings,
  setRestartAnnounce,
  setRestartInterval,
  setRestartsEnabled,
  WARNINGS,
} from './restarts.js';
import { setSpeciesChannel } from './species.js';
import { refreshStatusPanel, setStatusChannel } from './status.js';
import { buildPopulationEmbed } from './population.js';
import type { EvrimaRcon } from './rcon.js';

export interface Ctx {
  config: Config;
  db: Database;
  rcon: EvrimaRcon;
  mod: ModBridge;
  admins: AdminStore;
  /** Null when no control panel is configured; restarts then warn but cannot act. */
  panel: Panel | null;
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
interface Editable {
  editReply: (options: { embeds: EmbedBuilder[] }) => Promise<unknown>;
}

const linkReplies = new Map<string, Editable>();

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

  new SlashCommandBuilder()
    .setName('points')
    .setDescription('Points you have earned by playing')
    .addSubcommand((s) => s.setName('balance').setDescription('How many points you have'))
    .addSubcommand((s) => s.setName('top').setDescription('Who has the most')),

  new SlashCommandBuilder()
    .setName('teleport')
    .setDescription('Ask a friend if you can travel to them')
    .addUserOption((o) =>
      o.setName('friend').setDescription('Who you want to travel to').setRequired(true)),

  new SlashCommandBuilder()
    .setName('kills')
    .setDescription('Kill counts')
    .addSubcommand((s) => s.setName('top').setDescription('The deadliest players'))
    .addSubcommand((s) => s.setName('me').setDescription('Your own kills and deaths')),

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
    )
    .addSubcommandGroup((g) =>
      g.setName('give').setDescription('Put a dinosaur into someone’s archive')
        .addSubcommand((s) =>
          s.setName('dino').setDescription('Add a dinosaur to a player’s storage')
            .addUserOption((o) => o.setName('user').setDescription('Who gets it').setRequired(true))
            .addStringOption((o) =>
              o.setName('species').setDescription('Start typing — the list comes from the server')
                .setAutocomplete(true).setRequired(true))
            .addIntegerOption((o) =>
              o.setName('growth').setDescription('Growth percent, default 100')
                .setMinValue(5).setMaxValue(100))
            .addStringOption((o) =>
              o.setName('gender').setDescription('Shown on the slot — the game decides the real one')
                .addChoices({ name: 'Male', value: 'male' }, { name: 'Female', value: 'female' }))
            .addStringOption((o) =>
              o.setName('mutation1').setDescription('Mutation').setAutocomplete(true))
            .addStringOption((o) =>
              o.setName('mutation2').setDescription('Mutation').setAutocomplete(true))
            .addStringOption((o) =>
              o.setName('mutation3').setDescription('Mutation').setAutocomplete(true))
            .addStringOption((o) =>
              o.setName('mutation4').setDescription('Mutation').setAutocomplete(true))
            .addStringOption((o) =>
              o.setName('slot').setDescription('Slot name they will see (default: the species)'))),
    )
    .addSubcommandGroup((g) =>
      g.setName('species').setDescription('Per-species population caps')
        .addSubcommand((s) =>
          s.setName('cap').setDescription('Cap how many of a species may be online')
            .addStringOption((o) =>
              o.setName('species').setDescription('Exact species name, e.g. Tyrannosaurus')
                .setRequired(true))
            .addIntegerOption((o) =>
              o.setName('max').setDescription('How many may be online at once')
                .setMinValue(0).setMaxValue(200).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('clear').setDescription('Remove a species cap')
            .addStringOption((o) =>
              o.setName('species').setDescription('Exact species name').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('Show every cap and its state'))
        .addSubcommand((s) =>
          s.setName('channel').setDescription('Where locks and unlocks are announced')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Channel for lock notices')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('teleport').setDescription('Travel limits')
        .addSubcommand((s) =>
          s.setName('delay').setDescription('Seconds between accepting and arriving')
            .addIntegerOption((o) =>
              o.setName('seconds').setDescription('10 to 120, default 45')
                .setMinValue(10).setMaxValue(120).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('cooldown').setDescription('Minutes between travels')
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('0 disables the limit')
                .setMinValue(0).setMaxValue(1440).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('slay').setDescription('Slay limits')
        .addSubcommand((s) =>
          s.setName('cooldown').setDescription('Minutes players must wait between slays')
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('0 disables the limit')
                .setMinValue(0).setMaxValue(1440).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('panel').setDescription('The main player panel')
        .addSubcommand((s) =>
          s.setName('channel').setDescription('Post the player panel in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it should live')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('status').setDescription('The live server status panel')
        .addSubcommand((s) =>
          s.setName('channel').setDescription('Put the status panel in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it should live')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((s) => s.setName('off').setDescription('Stop updating the panel')),
    )
    .addSubcommandGroup((g) =>
      g.setName('restarts').setDescription('Scheduled server restarts')
        .addSubcommand((s) =>
          s.setName('on').setDescription('Turn scheduled restarts on'))
        .addSubcommand((s) =>
          s.setName('off').setDescription('Turn scheduled restarts off'))
        .addSubcommand((s) =>
          s.setName('every').setDescription('How often to restart')
            .addIntegerOption((o) =>
              o.setName('hours').setDescription('Hours between restarts')
                .setMinValue(1).setMaxValue(24).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('announce').setDescription('Where to post restart warnings')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Channel for warnings')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addRoleOption((o) =>
              o.setName('role').setDescription('Role to ping (optional)')))
        .addSubcommand((s) =>
          s.setName('status').setDescription('Show the restart schedule')),
    )
    .addSubcommandGroup((g) =>
      g.setName('killfeed').setDescription('Where kills are posted')
        .addSubcommand((s) =>
          s.setName('channel').setDescription('Post each kill in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where kills go')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((s) => s.setName('off').setDescription('Stop posting kills')),
    )
    .addSubcommandGroup((g) =>
      g.setName('points').setDescription('Adjust player points')
        .addSubcommand((s) =>
          s.setName('give').setDescription('Add points to someone')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
            .addNumberOption((o) =>
              o.setName('amount').setDescription('How many').setMinValue(0).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('take').setDescription('Remove points from someone')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
            .addNumberOption((o) =>
              o.setName('amount').setDescription('How many').setMinValue(0).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('set').setDescription('Set someone’s balance exactly')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
            .addNumberOption((o) =>
              o.setName('amount').setDescription('New balance').setMinValue(0).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('rate').setDescription('Points earned per hour played')
            .addNumberOption((o) =>
              o.setName('per_hour').setDescription('Points per hour')
                .setMinValue(0).setMaxValue(10_000).setRequired(true))),
    ),
].map((b) => b.toJSON());

export async function handleCommand(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  switch (i.commandName) {
    case 'link': return handleLink(ctx, i);
    case 'unlink': return handleUnlink(ctx, i);
    case 'slay': return handleSlay(ctx, i);
    case 'storage': return handleStorage(ctx, i);
    case 'population': return handlePopulation(ctx, i);
    case 'points': return handlePoints(ctx, i);
    case 'kills': return handleKills(ctx, i);
    case 'teleport': return handleTeleport(ctx, i);
    case 'admin': return handleAdmin(ctx, i);
    default:
      await i.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
  }
}

// ---------------------------------------------------------------- linking --

async function handleLink(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const steamId = i.options.getString('steamid', true).trim();
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await beginLink(ctx, i, i.user.id, steamId);
}

/**
 * Issues a link code. Shared by `/link` and the Verify button, so both routes
 * behave identically — the interaction must already be deferred, ephemerally.
 */
export async function beginLink(
  ctx: Ctx,
  i: Editable,
  discordId: string,
  rawSteamId: string,
): Promise<void> {
  const steamId = rawSteamId.trim();

  if (!isSteamId(steamId)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'That is not a Steam64 ID',
        'It is 17 digits and starts with 7656119. You can find yours on steamid.io.')],
    });
    return;
  }

  const taken = ctx.db.linkBySteam(steamId);
  if (taken && taken.discordId !== discordId) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Already linked',
        'That Steam account is connected to a different Discord account.')],
    });
    return;
  }

  const online = await ctx.rcon.players().catch(() => []);
  if (!online.some((p) => p.steamId === steamId)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, `You need to be on ${SERVER}`,
        `Join ${SERVER}, then try again — you finish this in game chat.`)],
    });
    return;
  }

  // No 0/O/1/I: this gets read off one screen and typed on another.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let n = 0; n < 6; n += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];

  ctx.db.setPending(discordId, steamId, code, ctx.config.linkCodeTtlMinutes * 60_000);

  // Typing the code IN GAME is what proves they control the Steam account —
  // only someone playing as it can put it in that account's chat.
  linkReplies.set(discordId, i);
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

/** Anything that can show a prompt and wait on a button click. */
interface Confirmable {
  editReply: (options: {
    embeds: EmbedBuilder[];
    components?: ActionRowBuilder<ButtonBuilder>[];
  }) => Promise<{ awaitMessageComponent: (o: never) => Promise<never> } | unknown>;
  user: { id: string };
}

/** Confirmation for anything that destroys a dinosaur. */
async function confirm(
  i: Confirmable,
  prompt: EmbedBuilder,
  label: string,
): Promise<boolean> {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('yes').setLabel(label).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('no').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  const message = (await i.editReply({ embeds: [prompt], components: [row] })) as Message;

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
    await runSlay(ctx, i, link.steamId);
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Something went wrong', describeError(err))],
      components: [],
    });
  }
}

/**
 * Confirms, then kills. Shared by `/slay` and the panel button so both ask the
 * same question. The interaction must already be deferred, ephemerally.
 *
 * The Steam ID comes from the link table, never from user input, so this cannot
 * be pointed at anyone else.
 */
/** Minutes between slays. Zero disables the limit entirely. */
export function slayCooldownMinutes(ctx: Ctx): number {
  const raw = Number.parseInt(ctx.db.getSetting('slay_cooldown_minutes') ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 15;
}

export async function runSlay(ctx: Ctx, i: Confirmable, steamId: string): Promise<void> {
  // why: without this, slaying is a free reroll — kill, respawn, repeat until
  // the spawn lands somewhere good.
  const windowMs = slayCooldownMinutes(ctx) * 60_000;
  const left = ctx.db.cooldownLeft(steamId, 'slay', windowMs);
  if (left > 0) {
    const ready = Math.floor((Date.now() + left) / 1000);
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Not yet',
        `You can slay again <t:${ready}:R>.\n\n` +
        'The wait is there so slaying cannot be used to reroll your spawn. ' +
        'Storing a dinosaur is not affected.')],
      components: [],
    });
    return;
  }

  const proceed = await confirm(
    i,
    embed(COLORS.warn, 'Kill your dinosaur?',
      'Nothing is kept. If you want it back later, store it instead.'),
    'Kill it',
  );

  if (!proceed) {
    await i.editReply({
      embeds: [embed(COLORS.quiet, 'Cancelled', 'Your dinosaur is fine.')],
      components: [],
    });
    return;
  }

  const result = await ctx.mod.run('slay', steamId);

  // Only on success: a failed slay left the dinosaur alive, so charging them
  // the wait would be punishing them for the server's problem.
  if (result.ok) ctx.db.startCooldown(steamId, 'slay');

  const minutes = slayCooldownMinutes(ctx);
  await i.editReply({
    embeds: [result.ok
      ? embed(COLORS.good, 'It is done',
          `${result.msg}.\n\nSpawn again whenever you like.` +
          (minutes > 0 ? `\n\nYou can slay again in ${minutes} minutes.` : ''))
      : embed(COLORS.bad, 'Could not do that', result.msg)],
    components: [],
  });
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

// ----------------------------------------------------------------- points --

async function handlePoints(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  if (i.options.getSubcommand() === 'top') {
    await i.deferReply();

    const rows = ctx.db.topPoints(10);
    // Points are keyed by Steam ID, so anyone unlinked has no name to show.
    const nameFor = (steamId: string): string => {
      const link = ctx.db.linkBySteam(steamId);
      return link ? `<@${link.discordId}>` : `\`${steamId.slice(-6)}\``;
    };

    await i.editReply({ embeds: [buildLeaderboardEmbed(rows, nameFor)] });
    return;
  }

  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        `Points are earned in game, so \`/link\` first — anything you have already ` +
        'earned is waiting for you.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { balance, minutes } = ctx.db.pointsFor(link.steamId);
  await i.reply({
    embeds: [buildBalanceEmbed(balance, minutes, ratePerHour(ctx))],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAdminPoints(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'rate') {
    const rate = i.options.getNumber('per_hour', true);
    setRatePerHour(ctx, rate);
    await i.reply({
      embeds: [embed(COLORS.good, 'Rate changed',
        `Players now earn **${rate}** points an hour. Existing balances are untouched.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = i.options.getUser('user', true);
  const link = ctx.db.linkFor(user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Not linked',
        `${user} has not linked a Steam account, and points are held against the ` +
        'Steam ID rather than the Discord account.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const amount = i.options.getNumber('amount', true);
  const before = ctx.db.pointsFor(link.steamId).balance;

  if (action === 'give') ctx.db.addPoints(link.steamId, amount);
  else if (action === 'take') ctx.db.setPoints(link.steamId, before - amount);
  else ctx.db.setPoints(link.steamId, amount);

  const after = ctx.db.pointsFor(link.steamId).balance;

  await i.reply({
    embeds: [embed(COLORS.good, 'Points updated',
      `${user}: **${display(before).toLocaleString()}** → **${display(after).toLocaleString()}**` +
      (action === 'take' && before - amount < 0
        ? '\n\nThat would have gone negative, so it stopped at zero.'
        : ''))],
    flags: MessageFlags.Ephemeral,
  });
}

// ------------------------------------------------------------------ kills --

/** Steam IDs are the key, so anyone unlinked shows as a partial ID. */
export function steamNamer(ctx: Ctx): (steamId: string) => string {
  return (steamId) => {
    const link = ctx.db.linkBySteam(steamId);
    return link ? `<@${link.discordId}>` : `\`${steamId.slice(-6)}\``;
  };
}

async function handleKills(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  if (i.options.getSubcommand() === 'top') {
    await i.deferReply();
    await i.editReply({
      embeds: [buildKillsEmbed(ctx.db.topKillers(10), ctx.db.killTotals(), steamNamer(ctx))],
    });
    return;
  }

  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        'Kills are recorded against your Steam account, so `/link` first.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { kills, deaths } = ctx.db.killStats(link.steamId);
  await i.reply({
    embeds: [embed(COLORS.info, 'Your record',
      `**${kills}** kills · **${deaths}** deaths\n\n` +
      'Only direct attacks count as a kill. Bleeding out, starving, drowning ' +
      'and AI show as deaths with nobody credited.')],
    flags: MessageFlags.Ephemeral,
  });
}

// --------------------------------------------------------------- teleport --

export async function startTeleport(
  ctx: Ctx,
  i: { editReply: (o: { embeds: EmbedBuilder[] }) => Promise<unknown>; client: Client; user: { id: string; tag: string } },
  friendId: string,
): Promise<void> {
  const mine = ctx.db.linkFor(i.user.id);
  if (!mine) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        'Travelling moves your live dinosaur, so the bot needs to know which account is yours.')],
    });
    return;
  }

  if (friendId === i.user.id) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'That is you', 'Pick somebody else.')],
    });
    return;
  }

  const theirs = ctx.db.linkFor(friendId);
  if (!theirs) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'They are not linked',
        `<@${friendId}> has not linked a Steam account, so there is no way to find them.`)],
    });
    return;
  }

  const left = ctx.db.cooldownLeft(mine.steamId, 'teleport', cooldownMinutes(ctx) * 60_000);
  if (left > 0) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Not yet',
        `You can travel again <t:${Math.floor((Date.now() + left) / 1000)}:R>.`)],
    });
    return;
  }

  // Both must be spawned: the mod moves a live pawn, and there is nothing to
  // move or move to otherwise.
  const online = await ctx.rcon.players().catch(() => []);
  const onServer = (steamId: string): boolean => online.some((p) => p.steamId === steamId);

  if (!onServer(mine.steamId)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, `You are not on ${SERVER}`, 'Join first, then ask again.')],
    });
    return;
  }
  if (!onServer(theirs.steamId)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'They are not on the server',
        `<@${friendId}> is not playing right now.`)],
    });
    return;
  }

  if (requestFor(theirs.steamId)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'They are already being asked',
        'Someone else asked them a moment ago. Wait for that to resolve.')],
    });
    return;
  }

  addRequest({
    fromDiscord: i.user.id,
    fromSteam: mine.steamId,
    toDiscord: friendId,
    toSteam: theirs.steamId,
    askedAt: Date.now(),
    accepted: false,
  });

  // Ask in game first: that reaches them whether or not their DMs are open.
  await ctx.rcon
    .directMessage(theirs.steamId, `${i.user.tag} wants to teleport to you — type !accept`)
    .catch(() => undefined);

  const friend = await i.client.users.fetch(friendId).catch(() => null);
  const dmSent = friend
    ? await friend
        .send({ embeds: [askEmbed(i.user.tag)], components: askRows(mine.steamId) })
        .then(() => true)
        .catch(() => false)
    : false;

  await i.editReply({
    embeds: [embed(COLORS.info, 'Asked',
      `<@${friendId}> has been asked${dmSent ? ' in Discord and in game' : ' in game'}.\n\n` +
      (dmSent ? '' : '⚠️ Their DMs are closed, so they can only answer with `!accept` in game.\n\n') +
      `They can accept with the button or by typing \`!accept\`. You will travel ` +
      `**${delaySeconds(ctx)} seconds** after they do — stay put until then.`)],
  });
}

async function handleTeleport(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await startTeleport(ctx, i, i.options.getUser('friend', true).id);
}

// ------------------------------------------------------------------- give --

/**
 * Writes a dinosaur straight into someone's archive.
 *
 * The recipient does not need to be online — the snapshot is synthesised, and
 * restore only ever compares the species. They collect it by spawning that
 * species and pressing Release.
 */
async function handleGive(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const user = i.options.getUser('user', true);
  const link = ctx.db.linkFor(user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Not linked',
        `${user} has not linked a Steam account, and storage is held against the ` +
        'Steam ID. Ask them to run `/link` first.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const species = i.options.getString('species', true).trim();
  const slot = cleanSlotName(i.options.getString('slot') ?? species) ?? 'gift';
  const growth = (i.options.getInteger('growth') ?? 100) / 100;

  const mutations = [1, 2, 3, 4]
    .map((n) => i.options.getString(`mutation${n}`)?.trim())
    .filter((m): m is string => Boolean(m));

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  // Typed rather than picked is the likely cause of a species that cannot be
  // collected, so it is worth saying before the gift is written.
  const known = await speciesList(ctx);
  if (known.length > 0 && !known.includes(species)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'That species does not exist',
        `${SERVER} has no **${species}**. Pick from the suggestions — the list ` +
        'comes from the server itself.\n\nDid you mean: ' +
        (known.filter((s) => s.toLowerCase().startsWith(species.slice(0, 3).toLowerCase()))
          .slice(0, 5).join(', ') || known.slice(0, 5).join(', ')) + '?')],
    });
    return;
  }

  try {
    const result = await ctx.mod.run('give', link.steamId, {
      slot,
      species,
      growth,
      female: i.options.getString('gender') === 'female',
      mutations,
      by: i.user.tag,
    });

    await i.editReply({
      embeds: [result.ok
        ? embed(COLORS.good, 'Added to their archive',
            `${user} now has a **${species}** in the slot \`${slot}\`.\n\n` +
            `Growth **${Math.round(growth * 100)}%**` +
            (mutations.length ? ` · Mutations: ${mutations.join(', ')}` : '') +
            (mutations.some(isRemoved)
              ? '\n\n⚠️ ' + mutations.filter(isRemoved).join(', ') +
                ' no longer exists in this build, so the game will ignore it.'
              : '') +
            '\n\nThey collect it by spawning a ' + species + ' and pressing **Release**. ' +
            'They do not need to be online now.')
        : embed(COLORS.bad, 'Could not do that', result.msg)],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Something went wrong', describeError(err))],
    });
  }
}

// ---------------------------------------------------------------- species --

async function handleSpecies(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'channel') {
    const channel = i.options.getChannel('channel', true);
    setSpeciesChannel(ctx, channel.id);
    await i.reply({
      embeds: [embed(COLORS.good, 'Lock notices set up',
        `Locks and unlocks will be posted in <#${channel.id}>, and announced in game.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'list') {
    const caps = ctx.db.speciesCaps();
    await i.reply({
      embeds: [embed(COLORS.info, 'Species caps',
        caps.length === 0
          ? 'No caps set. Use `/admin species cap` to add one.'
          : caps.map((c) => `${c.locked ? '🔒' : '🔓'} **${c.species}** — max ${c.cap}`).join('\n'),
        )],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const species = i.options.getString('species', true).trim();

  if (action === 'clear') {
    const removed = ctx.db.removeSpeciesCap(species);
    await i.reply({
      embeds: [removed
        ? embed(COLORS.good, 'Cap removed', `**${species}** is uncapped again.`)
        : embed(COLORS.quiet, 'Nothing to remove', `**${species}** had no cap. ` +
            'Names are case sensitive — check `/admin species list`.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const max = i.options.getInteger('max', true);
  ctx.db.setSpeciesCap(species, max);

  await i.reply({
    embeds: [embed(COLORS.good, 'Cap set',
      `**${species}** is capped at **${max}** online.\n\n` +
      '⚠️ This **announces**, it does not enforce. Nothing in Evrima lets the ' +
      'server refuse a spawn, so a locked species is a rule staff and players ' +
      'act on — the bot tells everyone, in Discord and in game, the moment it ' +
      'fills up or frees up.\n\n' +
      'The name must match exactly as the game reports it — `/population` ' +
      'shows the spellings in use.')],
    flags: MessageFlags.Ephemeral,
  });
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
  if (group === 'status') return handleStatusPanel(ctx, i, action);

  if (group === 'give') return handleGive(ctx, i);
  if (group === 'species') return handleSpecies(ctx, i, action);

  if (group === 'teleport') {
    if (action === 'delay') {
      const seconds = i.options.getInteger('seconds', true);
      ctx.db.setSetting('teleport_delay_seconds', String(seconds));
      await i.reply({
        embeds: [embed(COLORS.good, 'Travel delay set',
          `Players arrive **${seconds} seconds** after their friend accepts.\n\n` +
          'The wait is what stops travelling being an instant escape from a fight.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const minutes = i.options.getInteger('minutes', true);
    ctx.db.setSetting('teleport_cooldown_minutes', String(minutes));
    await i.reply({
      embeds: [embed(COLORS.good, 'Travel cooldown set',
        minutes === 0
          ? 'There is now **no limit** on how often players can travel.'
          : `Players must wait **${minutes} minutes** between travels.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (group === 'slay') {
    const minutes = i.options.getInteger('minutes', true);
    ctx.db.setSetting('slay_cooldown_minutes', String(minutes));
    await i.reply({
      embeds: [embed(COLORS.good, 'Slay cooldown set',
        minutes === 0
          ? 'There is now **no limit** on how often players can slay.'
          : `Players must wait **${minutes} minutes** between slays.\n\n` +
            'Storing is unaffected — that is limited by slots instead.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (group === 'panel') {
    const channel = i.options.getChannel('channel', true);
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    setHubChannel(ctx, channel.id);
    try {
      await postOrEdit(ctx.db, i.client, channel.id, HUB_MESSAGE_KEY,
        [buildHubEmbed()], hubRows());
      await i.editReply({
        embeds: [embed(COLORS.good, 'Panel is live',
          `It is in <#${channel.id}>.\n\nThe buttons keep working after a restart, ` +
          'so this message can stay pinned indefinitely.')],
      });
    } catch (err) {
      await i.editReply({
        embeds: [embed(COLORS.bad, 'Could not post there',
          `${describeError(err)}\n\nCheck the bot can **View Channel**, ` +
          '**Send Messages** and **Embed Links** there.')],
      });
    }
    return;
  }
  if (group === 'restarts') return handleRestarts(ctx, i, action);
  if (group === 'points') return handleAdminPoints(ctx, i, action);

  if (group === 'killfeed') {
    const channel = action === 'off' ? null : i.options.getChannel('channel', true);
    setKillfeedChannel(ctx, channel?.id ?? null);
    await i.reply({
      embeds: [embed(COLORS.good, channel ? 'Kill feed on' : 'Kill feed off',
        channel
          ? `Kills will be posted in <#${channel.id}> as they happen.\n\n` +
            'Deaths with no attacker appear too, marked as such — only direct ' +
            'attacks can be credited to anyone.'
          : 'Kills are still recorded, they are just not posted.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (group === 'game') return handleGameAdmin(ctx, i, action);

  // Discord registers commands against the application, while the handlers ship
  // with the running process — so a subcommand can exist in the client before
  // the bot restarts to pick it up. Falling through to another handler produced
  // a baffling "required option steamid not found"; say what actually happened.
  await i.reply({
    embeds: [embed(COLORS.warn, 'That command is newer than the bot',
      `\`/admin ${group}\` has been registered with Discord, but this bot is still ` +
      'running an older build.\n\n**Restart the bot** and it will work.')],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleStatusPanel(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'off') {
    setStatusChannel(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.good, 'Status panel stopped',
        'The message stays where it is; it just stops updating.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = i.options.getChannel('channel', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  setStatusChannel(ctx, channel.id);

  try {
    const online = await ctx.rcon.players().then((p) => p.length).catch(() => null);
    await refreshStatusPanel(ctx, i.client, online);
    await i.editReply({
      embeds: [embed(COLORS.good, 'Status panel is live',
        `It is in <#${channel.id}> and updates every minute.`)],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post there',
        `${describeError(err)}\n\nCheck the bot can **View Channel**, ` +
        '**Send Messages** and **Embed Links** there.')],
    });
  }
}

/**
 * Restarts land on fixed clock times, so the reply always states the next one
 * rather than "in six hours" — the whole point is that players can learn them.
 */
async function handleRestarts(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'announce') {
    const channel = i.options.getChannel('channel', true);
    const role = i.options.getRole('role');
    setRestartAnnounce(ctx, channel.id, role?.id ?? null);
    await i.reply({
      embeds: [embed(COLORS.good, 'Warnings set up',
        `Restart warnings go to <#${channel.id}>` +
        (role ? `, pinging ${role}` : ', with no role ping') +
        `.\n\nIn game: **${WARNINGS.join(', ')}** minutes before.\n` +
        'Discord: 60, 15 and 5 — but the role is only pinged **once**, on the ' +
        'first one. The later notices post without buzzing anybody again.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'every') {
    const hours = i.options.getInteger('hours', true);
    setRestartInterval(ctx, hours);
  } else if (action === 'on' || action === 'off') {
    setRestartsEnabled(ctx, action === 'on');
  }

  const settings = restartSettings(ctx);
  const next = nextRestart(new Date(), settings.intervalHours);
  const stamp = `<t:${Math.floor(next.getTime() / 1000)}:F>`;
  const relative = `<t:${Math.floor(next.getTime() / 1000)}:R>`;

  // Slots are anchored to midnight, so an interval that does not divide 24
  // leaves a short gap before midnight. Better said than discovered.
  const uneven = 24 % settings.intervalHours !== 0
    ? ` ⚠️ ${settings.intervalHours}h does not divide into 24, so the last gap before ` +
      'midnight is shorter. Use 1, 2, 3, 4, 6, 8, 12 or 24 for an even spread.'
    : '';

  const lines = [
    settings.enabled ? '**On**' : '**Off**',
    `Every **${settings.intervalHours}h**, on the clock — so the times are the same every day.${uneven}`,
    settings.enabled ? `Next: ${stamp} (${relative})` : '',
    settings.channelId
      ? `Warnings in <#${settings.channelId}>${settings.roleId ? ` pinging <@&${settings.roleId}>` : ''}`
      : '⚠️ No warning channel set — run `/admin restarts announce`',
    ctx.panel
      ? 'The panel performs the restart.'
      : '⚠️ No control panel configured, so the bot can warn and save but **cannot restart**. ' +
        'The host must do it at those times.',
  ].filter(Boolean);

  await i.reply({
    embeds: [embed(settings.enabled ? COLORS.good : COLORS.quiet, 'Scheduled restarts',
      lines.join('\n\n'))],
    flags: MessageFlags.Ephemeral,
  });
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

/**
 * Suggestions for the gift command. Both lists come from the server, so they
 * cannot drift out of date the way a hardcoded list would.
 */
export async function handleAutocomplete(
  ctx: Ctx,
  i: AutocompleteInteraction,
): Promise<void> {
  const focused = i.options.getFocused(true);

  const choices = focused.name === 'species'
    ? suggest(await speciesList(ctx), focused.value).map((name) => ({ name, value: name }))
    : mutationChoices(mutationList(ctx), focused.value);

  await i.respond(choices).catch(() => undefined);
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
