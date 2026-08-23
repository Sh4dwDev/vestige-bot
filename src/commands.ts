import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbedField,
  type AutocompleteInteraction,
  type Client,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type Message,
  type ModalSubmitInteraction,
} from 'discord.js';

import { AdminStore } from './admins.js';
import { ARCHIVE_CAP, SERVER, SIGNATURE } from './brand.js';
import { toPlainAscii, type ModBridge, type PlayerRow } from './bridge.js';
import type { Config } from './config.js';
import type { Database } from './db.js';
import {
  buildCommandsEmbed, buildStorageGuideEmbed, referenceKeys, rememberGuideChannel,
} from './guides.js';
import { refreshPopulationPanel, setPopulationChannel } from './livepanel.js';
import {
  knownSpecies, mutationList, parsePlayables, speciesList, suggest,
} from './catalog.js';
import { isRemoved, mutationChoices } from './mutations.js';
import { setRestartAlertRole } from './alertrole.js';
import {
  backfillEarlyRole, earlyMinutes, earlyRole, holders, setEarlyMinutes, setEarlyRole,
} from './earlymember.js';
import { setJoinRole } from './joinrole.js';
import {
  buildCatalogue,
  buildReceipt,
  mutationPrice,
  setPending,
  setSpeciesPrice,
  setTierPrice,
  takePending,
  elderStacks,
  sellable,
  setMaxShopTier,
  totalPrice,
} from './shop.js';
import { forgetPainted } from './skinsync.js';
import {
  buildShopPanel,
  setShopPanelChannel,
  shopPanelRows,
  SHOP_PANEL_MESSAGE_KEY,
} from './shoppanel.js';
import {
  applyLookIndexes,
  BUILT_IN,
  encodeColours,
  captureBaseline,
  patternLetter,
  PATTERN_CHOICES,
  hexToInt,
  hexToLinear,
  linearToHex,
  PARTS,
  PRESETS,
  presetLook,
  restoreBaseline,
} from './skins.js';
import {
  MAX_TIER, multiplierFor, setMultiplier, setTier, TIER_LABEL, tierOf,
} from './tiers.js';
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
  describeWindow,
  display,
  ratePerHour,
  setLinkBonus,
  setRatePerHour,
  setWeekendBonus,
  setWeekendWindow,
  weekendActive,
  weekendBonus,
  weekendWindow,
} from './points.js';
import type { Panel } from './pterodactyl.js';
import {
  nextRestart,
  restartNow,
  restartSettings,
  setRestartAnnounce,
  setRestartInterval,
  setRestartsEnabled,
  WARNINGS,
} from './restarts.js';
import {
  cleanupSettings,
  clearAI,
  nextCleanup,
  setCleanupAI,
  setCleanupEnabled,
  setCleanupHours,
  wipeNow,
} from './cleanup.js';
import {
  backupConfig,
  lastBackup,
  listSnapshots,
  markBackup,
  restoreSnapshot,
  runBackup,
} from './backup.js';
import { baseImage, DEFAULT_PATHS, sniffFormat, SUPPORTED, toPixel } from './heatimage.js';
import {
  applyReading, clearReadings, landmarkById, LANDMARKS, storedReadings,
} from './calibrate.js';
import {
  ANCHORS,
  boundsAreManual,
  buildHeatmapEmbed,
  effectiveBounds,
  HEATMAP_MESSAGE_KEY,
  heatmapMinutes,
  pointsFrom,
  resetBounds,
  resolveMapImage,
  saveBounds,
  setHeatmapChannel,
  setHeatmapImage,
  setHeatmapMinutes,
  setManualBounds,
  storedBounds,
  widen,
} from './heatmap.js';
import { applyCaps, planCaps, type PlannedCap } from './capplan.js';
import { postPeak, REFRESH_MINUTES, setPeaksChannel } from './peaks.js';
import {
  buildWardrobePanel,
  setWardrobeChannel,
  WARDROBE_MESSAGE_KEY,
  wardrobeRows,
} from './wardrobe.js';
import {
  MAX_PARENTS,
  nestingSettings,
  setNestingCondition,
  setNestingEnabled,
  setNestingPoints,
  setNestingRadius,
} from './nesting.js';
import {
  buildMarketPanel,
  MARKET_MESSAGE_KEY,
  marketRows,
  refreshMarket,
  setListingsChannel,
  setMarketChannel,
  setMarketFee,
} from './market.js';
import { buildPrimeDebugEmbed, buildPrimeEmbed } from './prime.js';
import { activeTryout, startTryout } from './tryout.js';
import {
  activeHunt,
  buildHuntEmbed,
  huntAnnounce,
  huntChannel,
  saveHunt,
  setHuntChannel,
  type Hunt,
} from './hunt.js';
import {
  activeContest,
  buildContestEmbed,
  contestAnnounce,
  contestChannel,
  hud,
  inside,
  saveContest,
  setContestChannel,
  type Contest,
} from './contest.js';
import {
  buildReferralEmbed,
  referralMinutes,
  referralReward,
  referralWeeklyCap,
  referralWelcome,
  setReferralAmounts,
  setReferralsEnabled,
} from './referrals.js';
import {
  enforcementEnabled,
  enforcementFault,
  restoreAllPlayables,
  setEnforcement,
  syncPlayables,
} from './enforce.js';
import { handleInGame, handleModeration } from './moderation.js';
import {
  buildFounderPanel,
  founderLimit,
  FOUNDER_MESSAGE_KEY,
  founderRows,
  setFounderChannel,
  setFounderLimit,
  skinById,
} from './founders.js';
import {
  activeBounties,
  bountyLines,
  bountySettings,
  setBountiesEnabled,
  setBountyBase,
} from './bounties.js';
import {
  eventSettings,
  eventsFor,
  minPlayersForRare,
  setMinPlayersForRare,
  setCullBonus,
  setEventsEnabled,
  setRareBonus,
} from './events.js';
import { setSkinExpiryHours } from './skinsync.js';
import { setSpeciesChannel } from './species.js';
import { refreshStatusPanel, setStatusChannel } from './status.js';
import { buildPopulationEmbed, tally } from './population.js';
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

export async function announceLinked(discordId: string, bonus = 0): Promise<boolean> {
  const interaction = linkReplies.get(discordId);
  linkReplies.delete(discordId);
  if (!interaction) return false;

  try {
    await interaction.editReply({
      embeds: [embed(COLORS.good, 'Recognised',
        `${ARCHIVE_CAP} knows you now.\n\n` +
        (bonus > 0
          ? `🪙 **+${display(bonus).toLocaleString()} points** for linking.\n\n`
          : '') +
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
    // Optional: with no argument this opens a form instead, which is a far
    // better place to paste seventeen digits than a slash command box.
    .addStringOption((o) =>
      o.setName('steamid').setDescription('Leave blank to get a form').setRequired(false)
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
    .setName('prime')
    .setDescription('What you still need for Prime'),

  new SlashCommandBuilder()
    .setName('points')
    .setDescription('Points you have earned by playing')
    .addSubcommand((s) => s.setName('balance').setDescription('How many points you have'))
    .addSubcommand((s) => s.setName('top').setDescription('Who has the most')),

  new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Buy a grown dinosaur with your points')
    .addSubcommand((s) => s.setName('browse').setDescription('What is for sale, and what it costs'))
    .addSubcommand((s) =>
      s.setName('buy').setDescription('Buy a grown dinosaur')
        .addStringOption((o) =>
          o.setName('species').setDescription('What to buy')
            .setAutocomplete(true).setRequired(true))
        .addStringOption((o) =>
          o.setName('mutation1').setDescription('Optional mutation').setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('mutation2').setDescription('Optional mutation').setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('mutation3').setDescription('Optional mutation').setAutocomplete(true))
        .addStringOption((o) =>
          o.setName('mutation4').setDescription('Optional mutation').setAutocomplete(true))
        .addBooleanOption((o) =>
          o.setName('prime').setDescription('Born Prime. Costs extra'))),

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
      g.setName('shop').setDescription('Shop prices and logging')
        .addSubcommand((s) =>
          s.setName('price').setDescription('Set one species’ price')
            .addStringOption((o) =>
              o.setName('species').setDescription('Species').setAutocomplete(true).setRequired(true))
            .addIntegerOption((o) =>
              o.setName('points').setDescription('What it costs')
                .setMinValue(0).setMaxValue(1_000_000).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('tierprice').setDescription('Set the price for a whole tier')
            .addIntegerOption((o) =>
              o.setName('tier').setDescription('1 to 4')
                .setMinValue(1).setMaxValue(4).setRequired(true))
            .addIntegerOption((o) =>
              o.setName('points').setDescription('What that tier costs')
                .setMinValue(0).setMaxValue(1_000_000).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('mutationprice').setDescription('What each mutation adds')
            .addIntegerOption((o) =>
              o.setName('points').setDescription('0 makes mutations free')
                .setMinValue(0).setMaxValue(100_000).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('maxtier').setDescription('Highest tier the shop will sell')
            .addIntegerOption((o) =>
              o.setName('tier').setDescription('3 keeps apexes off the shelf')
                .setMinValue(1).setMaxValue(MAX_TIER).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('log').setDescription('Post every purchase to a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where purchases are logged')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((s) => s.setName('recent').setDescription('The last purchases'))
        .addSubcommand((s) =>
          s.setName('panel').setDescription('Put the shop panel in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where the shop panel lives')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('skin').setDescription('Recolour a player’s dinosaur')
        .addSubcommand((s) =>
          s.setName('set').setDescription('Set one part’s colour')
            .addUserOption((o) => o.setName('user').setDescription('Whose dinosaur').setRequired(true))
            .addStringOption((o) =>
              o.setName('part').setDescription('Which part')
                .addChoices(...PARTS.map((p) => ({ name: p.label, value: p.field })))
                .setRequired(true))
            .addStringOption((o) =>
              o.setName('colour').setDescription('A preset, or any hex like #8C3B1E')
                .setAutocomplete(true).setRequired(true))
            .addStringOption((o) =>
              o.setName('part2').setDescription('Another part')
                .addChoices(...PARTS.map((p) => ({ name: p.label, value: p.field }))))
            .addStringOption((o) =>
              o.setName('colour2').setDescription('Its colour').setAutocomplete(true))
            .addStringOption((o) =>
              o.setName('part3').setDescription('Another part')
                .addChoices(...PARTS.map((p) => ({ name: p.label, value: p.field }))))
            .addStringOption((o) =>
              o.setName('colour3').setDescription('Its colour').setAutocomplete(true))
            .addStringOption((o) =>
              o.setName('part4').setDescription('Another part')
                .addChoices(...PARTS.map((p) => ({ name: p.label, value: p.field }))))
            .addStringOption((o) =>
              o.setName('colour4').setDescription('Its colour').setAutocomplete(true)))
        .addSubcommand((s) =>
          s.setName('expiry').setDescription('How long a look survives without being worn')
            .addIntegerOption((o) =>
              o.setName('hours').setDescription('Default 6')
                .setMinValue(1).setMaxValue(720).setRequired(true)))
        .addSubcommand((s) => s.setName('palette').setDescription('Show the preset colours'))
        .addSubcommand((s) =>
          s.setName('pattern').setDescription('Change the pattern (A, B, C…)')
            .addUserOption((o) => o.setName('user').setDescription('Whose dinosaur').setRequired(true))
            .addStringOption((o) =>
              o.setName('pattern').setDescription('Which pattern')
                .addChoices(...Array.from({ length: PATTERN_CHOICES }, (_, n) => ({
                  name: `Pattern ${patternLetter(n)}`,
                  value: String(n),
                })))
                .setRequired(true)))
        .addSubcommand((s) =>
          s.setName('save').setDescription('Save a player’s current colours as a preset')
            .addUserOption((o) => o.setName('user').setDescription('Whose look to save').setRequired(true))
            .addStringOption((o) => o.setName('name').setDescription('Preset name').setRequired(true)))
        .addSubcommand((s) =>
          s.setName('apply').setDescription('Apply a saved preset, all parts at once')
            .addUserOption((o) => o.setName('user').setDescription('Whose dinosaur').setRequired(true))
            .addStringOption((o) =>
              o.setName('preset').setDescription('Saved preset')
                .setAutocomplete(true).setRequired(true)))
        .addSubcommand((s) => s.setName('presets').setDescription('List saved presets'))
        .addSubcommand((s) =>
          s.setName('grant').setDescription('Give a player a skin they keep')
            .addUserOption((o) =>
              o.setName('user').setDescription('Who gets it').setRequired(true))
            .addStringOption((o) =>
              o.setName('preset').setDescription('Which saved preset')
                .setAutocomplete(true).setRequired(true))
            .addStringOption((o) =>
              o.setName('reason').setDescription('Shown to them, e.g. "Winter event"')))
        .addSubcommand((s) =>
          s.setName('revoke').setDescription('Take a skin back off a player')
            .addUserOption((o) =>
              o.setName('user').setDescription('Who loses it').setRequired(true))
            .addStringOption((o) =>
              o.setName('preset').setDescription('Which one')
                .setAutocomplete(true).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('owned').setDescription('What a player owns')
            .addUserOption((o) =>
              o.setName('user').setDescription('Whose skins').setRequired(true)))
        .addSubcommand((s) =>
          s.setName('reset').setDescription('Stop keeping a player’s colours')
            .addUserOption((o) => o.setName('user').setDescription('Whose colours').setRequired(true)))
        .addSubcommand((s) =>
          s.setName('forget').setDescription('Delete a saved preset')
            .addStringOption((o) =>
              o.setName('preset').setDescription('Saved preset')
                .setAutocomplete(true).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('tier').setDescription('Species tiers, which drive points')
        .addSubcommand((s) =>
          s.setName('set').setDescription('Put a species in a tier')
            .addStringOption((o) =>
              o.setName('species').setDescription('Species').setAutocomplete(true).setRequired(true))
            .addIntegerOption((o) =>
              o.setName('tier').setDescription('1 to 4')
                .setMinValue(1).setMaxValue(4).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('multiplier').setDescription('How much a tier earns and its kills are worth')
            .addIntegerOption((o) =>
              o.setName('tier').setDescription('1 to 4')
                .setMinValue(1).setMaxValue(4).setRequired(true))
            .addNumberOption((o) =>
              o.setName('multiplier').setDescription('e.g. 2 for double')
                .setMinValue(0).setMaxValue(20).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('killpoints').setDescription('Base points for a kill, before tier scaling')
            .addIntegerOption((o) =>
              o.setName('points').setDescription('Default 50')
                .setMinValue(0).setMaxValue(100_000).setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('Show every species and its tier')),
    )
    .addSubcommandGroup((g) =>
      g.setName('cleanup').setDescription('How quickly the world tidies itself')
        .addSubcommand((s) =>
          s.setName('corpses').setDescription('How fast corpses rot away')
            .addNumberOption((o) =>
              o.setName('multiplier').setDescription('1 is default, 2 is twice as fast')
                .setMinValue(0.1).setMaxValue(20).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('every').setDescription('Clear corpses automatically on a schedule')
            .addIntegerOption((o) =>
              o.setName('hours').setDescription('e.g. 3 — corpses are cleared this often')
                .setMinValue(1).setMaxValue(24).setRequired(true)))
        .addSubcommand((s) => s.setName('now').setDescription('Clean up right now'))
        .addSubcommand((s) =>
          s.setName('ai').setDescription('Whether cleanup also clears AI')
            .addBooleanOption((o) =>
              o.setName('on').setDescription('Toggle AI off and back on each cycle')
                .setRequired(true)))
        .addSubcommand((s) => s.setName('off').setDescription('Stop cleaning up automatically'))
        .addSubcommand((s) => s.setName('status').setDescription('What cleanup is configured')),
    )
    .addSubcommandGroup((g) =>
      g.setName('bounties').setDescription('Bounties on overpopulated species')
        .addSubcommand((c) => c.setName('on').setDescription('Post bounties automatically'))
        .addSubcommand((c) => c.setName('off').setDescription('Stop posting bounties'))
        .addSubcommand((c) =>
          c.setName('reward').setDescription('Points per claim, before the tier multiplier')
            .addIntegerOption((o) =>
              o.setName('points').setDescription('Default 150')
                .setMinValue(1).setMaxValue(10_000).setRequired(true)))
        .addSubcommand((c) => c.setName('status').setDescription('What is on offer now'))
        .addSubcommand((c) => c.setName('clear').setDescription('Take every bounty down')),
    )
    .addSubcommandGroup((g) =>
      g.setName('events').setDescription('Population events')
        .addSubcommand((c) =>
          c.setName('on').setDescription('Run cull and endangered events'))
        .addSubcommand((c) => c.setName('off').setDescription('Stop running events'))
        .addSubcommand((c) =>
          c.setName('bonus').setDescription('How much an event multiplies points')
            .addNumberOption((o) =>
              o.setName('cull').setDescription('Killing an over-cap species, default 2')
                .setMinValue(1).setMaxValue(10))
            .addNumberOption((o) =>
              o.setName('endangered').setDescription('Playing a rare species, default 2')
                .setMinValue(1).setMaxValue(10)))
        .addSubcommand((c) =>
          c.setName('minplayers')
            .setDescription('How busy the server must be for endangered to count')
            .addIntegerOption((o) =>
              o.setName('players').setDescription('Default 10')
                .setMinValue(0).setMaxValue(100).setRequired(true)))
        .addSubcommand((c) => c.setName('status').setDescription('What is running now')),
    )
    .addSubcommandGroup((g) =>
      g.setName('mod').setDescription('Moderation')
        .addSubcommand((c) =>
          c.setName('kick').setDescription('Remove someone from the server')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Shown to them on screen')))
        .addSubcommand((c) =>
          c.setName('ban').setDescription('Ban a Steam account from the game server')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Why'))
            .addIntegerOption((o) =>
              o.setName('hours').setDescription('0 or blank is permanent')
                .setMinValue(0).setMaxValue(8760)))
        .addSubcommand((c) =>
          c.setName('whitelist').setDescription('Whitelist on, off, or add and remove people')
            .addStringOption((o) =>
              o.setName('mode').setDescription('What to do').setRequired(true)
                .addChoices(
                  { name: 'add a player', value: 'add' },
                  { name: 'remove a player', value: 'remove' },
                  { name: 'toggle the whitelist itself', value: 'toggle' }))
            .addUserOption((o) => o.setName('user').setDescription('Who, for add and remove')))
        .addSubcommand((c) =>
          c.setName('globalchat').setDescription('Turn global chat on or off'))
        .addSubcommand((c) =>
          c.setName('say').setDescription('Announce something to everyone in game')
            .addStringOption((o) =>
              o.setName('message').setDescription('Shown in chat as <RCON>').setRequired(true)))
        .addSubcommand((c) =>
          c.setName('tell').setDescription('Put a notice on one player screen')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
            .addStringOption((o) =>
              o.setName('message').setDescription('What to show them').setRequired(true)))
        .addSubcommand((c) =>
          c.setName('log').setDescription('Where kicks and bans are recorded')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Staff channel')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('ingame').setDescription('Hands-on help for players')
        .addSubcommand((c) =>
          c.setName('heal').setDescription('Full health, food, water and stamina')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
        .addSubcommand((c) =>
          c.setName('bring').setDescription('Teleport a player to you')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true)))
        .addSubcommand((c) =>
          c.setName('goto').setDescription('Teleport yourself to a player')
            .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))),
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
          s.setName('preset')
            .setDescription('Apply a balanced cap for every species, scaled to your slots'))
        .addSubcommand((s) =>
          s.setName('enforce')
            .setDescription('Actually block spawning a full species, not just announce it')
            .addBooleanOption((o) =>
              o.setName('on').setDescription('Remove full species from the spawn menu')
                .setRequired(true)))
        .addSubcommand((s) =>
          s.setName('tryout').setDescription('Spawn a hidden species yourself, without offering it')
            .addStringOption((o) =>
              o.setName('species')
                .setDescription('Exactly as the game names it')
                .setRequired(true)))
        .addSubcommand((s) =>
          s.setName('unlock').setDescription('Put a species in the spawn menu by name')
            .addStringOption((o) =>
              o.setName('species')
                .setDescription('Exactly as the game names it, e.g. Carnotaurus')
                .setRequired(true)))
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
          s.setName('status').setDescription('Show the restart schedule'))
        .addSubcommand((s) =>
          s.setName('now').setDescription('Restart the server now — the fix for stuck AI')
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('Warning first. 0 restarts immediately')
                .setMinValue(0).setMaxValue(30))),
    )
    .addSubcommandGroup((g) =>
      g.setName('hunt').setDescription('One player is the target')
        .addSubcommand((c) =>
          c.setName('start').setDescription('Put a price on somebody')
            .addUserOption((o) =>
              o.setName('target').setDescription('Who is being hunted').setRequired(true))
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('How long they must survive. Default 20')
                .setMinValue(2).setMaxValue(240))
            .addIntegerOption((o) =>
              o.setName('reward').setDescription('Points for the kill. Default 1500')
                .setMinValue(0).setMaxValue(100_000))
            .addIntegerOption((o) =>
              o.setName('reveal').setDescription('Minutes between position calls. Default 3')
                .setMinValue(1).setMaxValue(60))
            .addStringOption((o) =>
              o.setName('skin').setDescription('A skin the killer also keeps')
                .setAutocomplete(true)))
        .addSubcommand((c) => c.setName('status').setDescription('How the hunt is going'))
        .addSubcommand((c) => c.setName('stop').setDescription('Call it off, paying nobody'))
        .addSubcommand((c) =>
          c.setName('channel').setDescription('Where hunt results are posted')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it announces')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('nest').setDescription('Put a nest in the world')
        .addSubcommand((c) =>
          c.setName('place').setDescription('Spawn one where you are standing')
            .addStringOption((o) =>
              o.setName('type').setDescription('Which nest. Default a large mound')
                .addChoices(
                  { name: 'Mound (large)', value: 'BP_Nest_Mound_Large_H_C' },
                  { name: 'Mound (small)', value: 'BP_Nest_Mound_Small_H_C' },
                  { name: 'Burrow', value: 'BP_Nest_Burrow_H_C' },
                  { name: 'Tree', value: 'BP_Nest_Tree_H_C' },
                )))
        .addSubcommand((c) =>
          c.setName('classes').setDescription(
            'Write every nest class this build exposes to the mod log')))
    .addSubcommandGroup((g) =>
      g.setName('contest').setDescription('A place worth fighting over')
        .addSubcommand((c) =>
          c.setName('start').setDescription('Start one where you are standing')
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('How long it must be held. Default 5')
                .setMinValue(1).setMaxValue(120))
            .addIntegerOption((o) =>
              o.setName('reward').setDescription('Points for the winner. Default 750')
                .setMinValue(0).setMaxValue(100_000))
            .addIntegerOption((o) =>
              o.setName('radius').setDescription('How close counts, in HUD units. Default 30')
                .setMinValue(5).setMaxValue(500))
            .addStringOption((o) =>
              o.setName('name').setDescription('What to call it'))
            .addStringOption((o) =>
              o.setName('skin').setDescription('A skin the winner also keeps')
                .setAutocomplete(true))
            .addBooleanOption((o) =>
              o.setName('shared').setDescription(
                'Everybody on it wins together, instead of a fight. Default off')))
        .addSubcommand((c) => c.setName('status').setDescription('How the current one is going'))
        .addSubcommand((c) => c.setName('stop').setDescription('Call it off, paying nobody'))
        .addSubcommand((c) =>
          c.setName('channel').setDescription('Where results are posted')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it announces')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))),
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
          s.setName('weekend').setDescription('Extra points per hour at the weekend')
            .addIntegerOption((o) =>
              o.setName('perhour').setDescription('Added flat, not multiplied. 0 turns it off')
                .setMinValue(0).setMaxValue(10_000).setRequired(true))
            .addIntegerOption((o) =>
              o.setName('startday').setDescription('0 Sun to 6 Sat. Default 5, Friday')
                .setMinValue(0).setMaxValue(6))
            .addIntegerOption((o) =>
              o.setName('starthour').setDescription('Norwegian time. Default 18')
                .setMinValue(0).setMaxValue(23))
            .addIntegerOption((o) =>
              o.setName('endday').setDescription('0 Sun to 6 Sat. Default 1, Monday')
                .setMinValue(0).setMaxValue(6))
            .addIntegerOption((o) =>
              o.setName('endhour').setDescription('Norwegian time. Default 6')
                .setMinValue(0).setMaxValue(23)))
        .addSubcommand((s) =>
          s.setName('linkbonus').setDescription('One-off points for linking an account')
            .addIntegerOption((o) =>
              o.setName('points').setDescription('0 turns it off')
                .setMinValue(0).setMaxValue(100_000).setRequired(true)))
        .addSubcommand((s) =>
          s.setName('rate').setDescription('Points earned per hour played')
            .addNumberOption((o) =>
              o.setName('per_hour').setDescription('Points per hour')
                .setMinValue(0).setMaxValue(10_000).setRequired(true))),
    ),
  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('One-time configuration: panels, channels and integrations')
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
      g.setName('joinrole').setDescription('Role given to new members')
        .addSubcommand((s) =>
          s.setName('set').setDescription('Give this role to everyone who joins')
            .addRoleOption((o) =>
              o.setName('role').setDescription('The role to give').setRequired(true)))
        .addSubcommand((s) => s.setName('off').setDescription('Stop giving a role on join')),
    )
    .addSubcommandGroup((g) =>
      g.setName('restartrole').setDescription('The role pinged before restarts')
        .addSubcommand((s) =>
          s.setName('set').setDescription('Which role the panel button hands out')
            .addRoleOption((o) =>
              o.setName('role').setDescription('The role to give').setRequired(true)))
        .addSubcommand((s) => s.setName('off').setDescription('Turn the button off')),
    )
    .addSubcommandGroup((g) =>
      g.setName('founders').setDescription('Early Member skins and role')
        .addSubcommand((c) =>
          c.setName('role').setDescription('The role that unlocks the skins')
            .addRoleOption((o) =>
              o.setName('role').setDescription('Given automatically until the cap is hit')
                .setRequired(true)))
        .addSubcommand((c) =>
          c.setName('backfill')
            .setDescription('Give the role to everyone who has already played enough'))
        .addSubcommand((c) =>
          c.setName('playtime').setDescription('How long they must play to earn the role')
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('Default 60. 0 gives it to anyone linked')
                .setMinValue(0).setMaxValue(10_000).setRequired(true)))
        .addSubcommand((c) =>
          c.setName('panel').setDescription('Post the founder skin panel in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where the panel goes')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((c) =>
          c.setName('limit').setDescription('How many people can claim one')
            .addIntegerOption((o) =>
              o.setName('count').setDescription('Default 50')
                .setMinValue(0).setMaxValue(1000).setRequired(true)))
        .addSubcommand((c) => c.setName('list').setDescription('Who has claimed one'))
        .addSubcommand((c) =>
          c.setName('release').setDescription('Free someone up to claim again')
            .addUserOption((o) =>
              o.setName('user').setDescription('Whose claim to release').setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('heatmap').setDescription('Where everyone is, as a panel')
        .addSubcommand((c) =>
          c.setName('panel').setDescription('Put the heatmap in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it lives')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((c) =>
          c.setName('every').setDescription('How often it refreshes')
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('Default 5')
                .setMinValue(1).setMaxValue(120).setRequired(true)))
        .addSubcommand((c) =>
          c.setName('image').setDescription('The map picture the heat is drawn on')
            .addStringOption((o) =>
              o.setName('url').setDescription('Link or file path. Blank uses data/map.png on the host')))
        .addSubcommand((c) =>
          c.setName('bounds').setDescription('Line the picture up with the world')
            .addNumberOption((o) =>
              o.setName('lat_min').setDescription('Lat at the BOTTOM edge').setRequired(true))
            .addNumberOption((o) =>
              o.setName('lat_max').setDescription('Lat at the TOP edge').setRequired(true))
            .addNumberOption((o) =>
              o.setName('long_min').setDescription('Long at the LEFT edge').setRequired(true))
            .addNumberOption((o) =>
              o.setName('long_max').setDescription('Long at the RIGHT edge').setRequired(true)))
        .addSubcommand((c) =>
          c.setName('calibrate')
            .setDescription('Stand on a landmark in game, then run this')
            .addStringOption((o) =>
              o.setName('landmark').setDescription('Where you are standing')
                .setRequired(true)
                .addChoices(...LANDMARKS.map((l) => ({ name: l.label, value: l.id })))))
        .addSubcommand((c) =>
          c.setName('check')
            .setDescription('What the map is using, and where it puts everyone'))
        .addSubcommand((c) =>
          c.setName('recalibrate')
            .setDescription('Forget the learned map bounds and start again'))
        .addSubcommand((c) => c.setName('off').setDescription('Take the panel down')),
    )
    .addSubcommandGroup((g) =>
      g.setName('prime').setDescription('The raw prime condition flags')
        .addSubcommand((c) =>
          c.setName('read').setDescription('Every flag for a player, with their vitals')
            .addUserOption((o) =>
              o.setName('player').setDescription('Defaults to you'))),
    )
    .addSubcommandGroup((g) =>
      g.setName('referrals').setDescription('Points for bringing players who stay')
        .addSubcommand((c) =>
          c.setName('on').setDescription('Start crediting people for invites'))
        .addSubcommand((c) =>
          c.setName('off').setDescription('Stop crediting invites'))
        .addSubcommand((c) => c.setName('status').setDescription('Settings and totals'))
        .addSubcommand((c) =>
          c.setName('set').setDescription('What a referral is worth')
            .addIntegerOption((o) =>
              o.setName('reward').setDescription('Points to the inviter')
                .setMinValue(0).setMaxValue(100_000))
            .addIntegerOption((o) =>
              o.setName('welcome').setDescription('Points to the person invited')
                .setMinValue(0).setMaxValue(100_000))
            .addIntegerOption((o) =>
              o.setName('minutes').setDescription('Playtime before it pays. Default 60')
                .setMinValue(1).setMaxValue(10_000))
            .addIntegerOption((o) =>
              o.setName('weekly').setDescription('Most one person can be paid a week. 0 is no cap')
                .setMinValue(0).setMaxValue(100))),
    )
    .addSubcommandGroup((g) =>
      g.setName('nesting').setDescription('Points for hatching a nest')
        .addSubcommand((c) => c.setName('on').setDescription('Pay parents when a nest hatches'))
        .addSubcommand((c) => c.setName('off').setDescription('Stop paying for nests'))
        .addSubcommand((c) =>
          c.setName('reward').setDescription('Points each parent gets')
            .addIntegerOption((o) =>
              o.setName('points').setDescription('Default 400')
                .setMinValue(0).setMaxValue(100_000).setRequired(true)))
        .addSubcommand((c) =>
          c.setName('radius').setDescription('How close a parent must be, in HUD units')
            .addIntegerOption((o) =>
              o.setName('hud').setDescription('Default 20')
                .setMinValue(1).setMaxValue(200).setRequired(true)))
        .addSubcommand((c) =>
          c.setName('condition').setDescription('Which prime flag means "get nested in"')
            .addIntegerOption((o) =>
              o.setName('index').setDescription('Default 2. Change if it pays wrongly')
                .setMinValue(1).setMaxValue(10).setRequired(true)))
        .addSubcommand((c) => c.setName('status').setDescription('How nesting is set up')),
    )
    .addSubcommandGroup((g) =>
      g.setName('market').setDescription('Players buying and selling dinosaurs')
        .addSubcommand((c) =>
          c.setName('panel').setDescription('Put the market panel in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where the Sell and Browse buttons live')
                .addChannelTypes(ChannelType.GuildText).setRequired(true))
            .addChannelOption((o) =>
              o.setName('listings').setDescription(
                'Where each listing is posted. Defaults to the same channel')
                .addChannelTypes(ChannelType.GuildText)))
        .addSubcommand((c) =>
          c.setName('listings').setDescription('Move listings to a channel of their own')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where each listing is posted')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((c) => c.setName('off').setDescription('Close the market'))
        .addSubcommand((c) =>
          c.setName('refresh').setDescription(
            'Repost any listing that lost its message, and redraw the rest'))
        .addSubcommand((c) =>
          c.setName('fee').setDescription("The server's cut of each sale")
            .addIntegerOption((o) =>
              o.setName('percent').setDescription('0 takes nothing, which is the default')
                .setMinValue(0).setMaxValue(50).setRequired(true))),
    )
    .addSubcommandGroup((g) =>
      g.setName('wardrobe').setDescription('The panel where players wear their skins')
        .addSubcommand((c) =>
          c.setName('panel').setDescription('Put the skins panel in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where it lives')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((c) => c.setName('off').setDescription('Take the panel down')),
    )
    .addSubcommandGroup((g) =>
      g.setName('peaks').setDescription('How busy the server has been')
        .addSubcommand((c) =>
          c.setName('channel').setDescription('Put both peak panels in a channel')
            .addChannelOption((o) =>
              o.setName('channel').setDescription('Where they live')
                .addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((c) => c.setName('off').setDescription('Stop updating them')),
    )
    .addSubcommandGroup((g) =>
      g.setName('backup').setDescription('Database backups')
        .addSubcommand((c) => c.setName('now').setDescription('Take a snapshot right now'))
        .addSubcommand((c) => c.setName('status').setDescription('When the last one ran'))
        .addSubcommand((c) => c.setName('list').setDescription('Every snapshot held'))
        .addSubcommand((c) =>
          c.setName('restore').setDescription('Replace the live database with a snapshot')
            .addStringOption((o) =>
              o.setName('snapshot').setDescription('Which one, from /admin backup list')
                .setRequired(true))
            .addStringOption((o) =>
              o.setName('confirm').setDescription('Type REPLACE to confirm')
                .setRequired(true))),
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
    ),
].map((b) => b.toJSON());

export async function handleCommand(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  switch (i.commandName) {
    case 'link': return handleLink(ctx, i);
    case 'unlink': return handleUnlink(ctx, i);
    case 'slay': return handleSlay(ctx, i);
    case 'storage': return handleStorage(ctx, i);
    case 'population': return handlePopulation(ctx, i);
    case 'prime': return handlePrime(ctx, i);
    case 'points': return handlePoints(ctx, i);
    case 'kills': return handleKills(ctx, i);
    case 'teleport': return handleTeleport(ctx, i);
    case 'shop': return handleShop(ctx, i);
    // Same handler and the same permission gate: /setup exists only because
    // Discord allows 25 subcommand groups per command and /admin outgrew it.
    case 'admin':
    case 'setup': return handleAdmin(ctx, i);
    default:
      await i.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
  }
}

// ---------------------------------------------------------------- linking --

export const LINK_MODAL_ID = 'lk:steam';
const LINK_FIELD_ID = 'lk:steamid';

/** The form. Seventeen digits is a lot to type into a slash command box. */
export function buildLinkModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(LINK_MODAL_ID)
    .setTitle('Steam ID')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId(LINK_FIELD_ID)
          .setLabel('Add your Steam ID')
          .setPlaceholder('17 digits')
          .setStyle(TextInputStyle.Short)
          .setMinLength(17)
          .setMaxLength(17)
          .setRequired(true),
      ),
    );
}

async function handleLink(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const steamId = i.options.getString('steamid')?.trim();

  // No argument means show the form. A modal has to be the FIRST response to an
  // interaction, so this cannot defer first.
  if (!steamId) {
    await i.showModal(buildLinkModal());
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await beginLink(ctx, i, i.user.id, steamId);
}

/** Returns true when this submission was the link form. */
export async function handleLinkModal(
  ctx: Ctx,
  i: ModalSubmitInteraction,
): Promise<boolean> {
  if (i.customId !== LINK_MODAL_ID) return false;

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await beginLink(ctx, i, i.user.id, i.fields.getTextInputValue(LINK_FIELD_ID));
  return true;
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
    embeds: [buildBalanceEmbed(balance, minutes, ratePerHour(ctx), {
      bonus: weekendBonus(ctx), active: weekendActive(ctx), window: weekendWindow(ctx),
    })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleAdminPoints(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'weekend') {
    const perHour = i.options.getInteger('perhour', true);
    setWeekendBonus(ctx, perHour);

    const current = weekendWindow(ctx);
    const window = {
      startDay: i.options.getInteger('startday') ?? current.startDay,
      startHour: i.options.getInteger('starthour') ?? current.startHour,
      endDay: i.options.getInteger('endday') ?? current.endDay,
      endHour: i.options.getInteger('endhour') ?? current.endHour,
    };
    setWeekendWindow(ctx, window);

    await i.reply({
      embeds: [embed(COLORS.good, perHour > 0 ? 'Weekend bonus set' : 'Weekend bonus off',
        perHour === 0
          ? 'Weekends now pay the same as any other day.'
          : `**+${perHour} points an hour** during ${describeWindow(window)}.\n\n` +
            'Added on top rather than multiplied, so it does not scale with tier ' +
            '— everybody gets the same for turning up, which helps the lower ' +
            'tiers most in proportion.\n\n' +
            `Right now it is **${weekendActive(ctx) ? 'on' : 'off'}**.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'linkbonus') {
    const points = i.options.getInteger('points', true);
    setLinkBonus(ctx, points);
    await i.reply({
      embeds: [embed(COLORS.good, 'Link bonus set',
        points === 0
          ? 'Linking no longer pays anything.'
          : `Linking now pays **${display(points).toLocaleString()}** once.

` +
            'Paid against the Steam account rather than the Discord one, so ' +
            'unlinking and linking again does not pay twice. Anyone who linked ' +
            'before this was set is not paid retroactively.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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
/**
 * How a player is named in anything the whole channel reads.
 *
 * The in-game name first, and no mention. Mentions ping: a busy night pinged
 * everybody who died, which is a notification for something the person already
 * knows and a stream of red dots for everyone else. The killfeed reports what
 * happened on the island, so the island's name for somebody is the right one —
 * and it works for people who never linked, where a slice of Steam ID told
 * nobody anything.
 *
 * Falls back to a Discord mention, which the killfeed sends with mentions
 * suppressed so it renders as a name without notifying anybody, and to a short
 * Steam ID only when nothing at all is known.
 */
export function steamNamer(ctx: Ctx): (steamId: string) => string {
  return (steamId) => {
    const inGame = ctx.db.gameName(steamId);
    if (inGame) return inGame;

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

// ------------------------------------------------------------------- shop --

async function handleShop(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const link = ctx.db.linkFor(i.user.id);

  if (i.options.getSubcommand() === 'browse') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const balance = link ? ctx.db.pointsFor(link.steamId).balance : 0;
    await i.editReply({
      embeds: [buildCatalogue(ctx, await speciesList(ctx), balance)],
    });
    return;
  }

  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        'Points and storage are held against your Steam account, so `/link` first.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const species = i.options.getString('species', true).trim();
  const { mutations, duplicate } = readMutations(i);

  if (duplicate) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'That mutation is picked twice',
        `You chose **${duplicate}** more than once. Each slot has to be a ` +
        'different mutation.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const known = await speciesList(ctx);
  if (known.length > 0 && !known.includes(species)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'No such species',
        `${SERVER} has no **${species}**. Pick from the suggestions.`)],
    });
    return;
  }

  // Refused here, not merely hidden from the catalogue. A species left out of a
  // list but still accepted by name is not a rule, and the names are public.
  if (!sellable(ctx, species)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Not for sale',
        `**${species}** is an apex, and apexes are not sold. Growing one is ` +
        'most of the point of playing it.\n\nEverything below apex is in ' +
        '`/shop browse`.')],
    });
    return;
  }

  const wantsPrime = i.options.getBoolean('prime') ?? false;
  const price = totalPrice(ctx, species, mutations, wantsPrime);
  const balance = ctx.db.pointsFor(link.steamId).balance;

  if (balance < price) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Not enough points',
        `A ${species}${mutations.length ? ` with ${mutations.length} mutation(s)` : ''} ` +
        `costs **${display(price).toLocaleString()}**, and you have ` +
        `**${display(balance).toLocaleString()}**.\n\nYou earn by playing — higher ` +
        'tiers earn faster, and kills pay too.')],
    });
    return;
  }

  setPending(i.user.id, {
    species, mutations, price, at: Date.now(), ...(wantsPrime ? { prime: true } : {}),
  });

  await i.editReply({
    embeds: [embed(COLORS.info, 'Confirm your purchase',
      `**${species}**, fully grown` +
      (mutations.length ? `\nMutations: ${mutations.join(', ')}` : '') +
      `\n\nCost **${display(price).toLocaleString()}** · you have ` +
      `**${display(balance).toLocaleString()}**\n\n` +
      'It goes into your archive and uses one vault. Collect it by spawning a ' +
      `${species} and pressing **Release**.\n\n_Purchases are not refundable._`)],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('shop:buy').setLabel('Buy it')
        .setEmoji('🛒').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('shop:cancel').setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    )],
  });
}

/**
 * Completes a purchase.
 *
 * Order matters: the dinosaur is written **before** the points are taken. If
 * that order were reversed, a failed delivery would leave someone charged with
 * nothing to show for it. This way the worst case is a free dinosaur, which is
 * the right direction to fail in.
 */
export async function completePurchase(
  ctx: Ctx,
  interaction: ButtonInteraction,
): Promise<void> {
  const purchase = takePending(interaction.user.id);
  if (!purchase) {
    await interaction.update({
      embeds: [embed(COLORS.quiet, 'Expired',
        'That offer timed out or was already used. Run `/shop buy` again.')],
      components: [],
    });
    return;
  }

  const link = ctx.db.linkFor(interaction.user.id);
  if (!link) {
    await interaction.update({
      embeds: [embed(COLORS.warn, 'Not linked', 'Run `/link` first.')],
      components: [],
    });
    return;
  }

  await interaction.update({
    embeds: [embed(COLORS.quiet, 'Buying…', 'Putting it in your archive.')],
    components: [],
  });

  // Re-read the balance: points may have been spent since the offer was made.
  const balance = ctx.db.pointsFor(link.steamId).balance;
  if (balance < purchase.price) {
    await interaction.editReply({
      embeds: [embed(COLORS.warn, 'Not enough points',
        'Your balance changed. Nothing was bought.')],
    });
    return;
  }

  try {
    // A free slot name, so the purchase does not collide with something they
    // already have stored.
    const listed = await ctx.mod.run('list', link.steamId, {}, { quiet: true });
    const taken = new Set(((listed.data ?? []) as Array<{ slot: string }>).map((s) => s.slot));
    let slot = purchase.species;
    for (let n = 2; taken.has(slot); n += 1) slot = `${purchase.species}${n}`;

    const result = await ctx.mod.run('give', link.steamId, {
      slot,
      species: purchase.species,
      growth: 1,
      female: false,
      mutations: purchase.mutations,
      // Elder always. It cannot be earned on a bought dinosaur — the prime
      // conditions close at 75% growth and a purchase arrives at 100% — so
      // withholding it sells something permanently worse than a grown one.
      elderStacks: elderStacks(ctx),
      ...(purchase.prime ? { prime: true } : {}),
      by: 'the shop',
    });

    if (!result.ok) {
      await interaction.editReply({
        embeds: [embed(COLORS.bad, 'Could not deliver it',
          `${result.msg}\n\n**You have not been charged.**`)],
      });
      return;
    }

    ctx.db.addPoints(link.steamId, -purchase.price);

    // On screen as well as in Discord: someone shopping on their phone mid-game
    // should not have to alt-tab to find out it landed.
    await ctx.mod.notify(link.steamId, `${purchase.species} delivered to your archive`);

    ctx.db.recordPurchase({
      discordId: interaction.user.id,
      steamId: link.steamId,
      species: purchase.species,
      mutations: purchase.mutations,
      price: purchase.price,
      slot,
    });

    const left = ctx.db.pointsFor(link.steamId).balance;
    await interaction.editReply({
      embeds: [buildReceipt(purchase.species, purchase.mutations, purchase.price, left, slot)],
    });

    await postShopLog(ctx, interaction, purchase, slot);
  } catch (err) {
    await interaction.editReply({
      embeds: [embed(COLORS.bad, 'Something went wrong',
        `${describeError(err)}\n\n**You have not been charged.**`)],
    });
  }
}

async function postShopLog(
  ctx: Ctx,
  interaction: ButtonInteraction,
  purchase: { species: string; mutations: string[]; price: number },
  slot: string,
): Promise<void> {
  const channelId = ctx.db.getSetting('shop_log_channel');
  if (!channelId) return;

  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !('send' in channel)) return;

  await channel.send({
    embeds: [embed(COLORS.info, '🛒  Purchase',
      `${interaction.user} bought a **${purchase.species}** for ` +
      `**${display(purchase.price).toLocaleString()}** as \`${slot}\`` +
      (purchase.mutations.length ? `\nMutations: ${purchase.mutations.join(', ')}` : ''))],
  }).catch(() => undefined);
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

  // Checked here as well as in the mod, so the refusal names both species
  // before anyone waits out a countdown for nothing.
  const spawned = await ctx.mod.players().catch(() => []);
  const mySpecies = spawned.find((p) => p.steam === mine.steamId)?.species;
  const theirSpecies = spawned.find((p) => p.steam === theirs.steamId)?.species;

  if (mySpecies && theirSpecies && mySpecies !== theirSpecies) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Different species',
        `You are playing a **${mySpecies}** and they are playing a **${theirSpecies}**.\n\n` +
        'You can only travel to your own species.')],
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
  // Short on purpose: the game renders these over an ANNOUNCEMENT label and a
  // long line runs straight through it.
  await ctx.rcon
    .directMessage(theirs.steamId, `${i.user.tag}: !accept to allow teleport`)
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
      `**${delaySeconds(ctx)} seconds** after they do.\n\n` +
      '⚠️ **Do not move** during the countdown, or it cancels. You must both be ' +
      'the same species, and **they must be at full health** — travel is not a ' +
      'way to join a fight that has already started.')],
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

  const { mutations, duplicate } = readMutations(i);
  if (duplicate) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'That mutation is picked twice',
        `**${duplicate}** appears more than once. Each slot has to be different.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

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

    // If they happen to be online, tell them on screen. A gift they never
    // noticed sits in the archive unclaimed.
    if (result.ok) await ctx.mod.notify(link.steamId, `A ${species} was added to your archive`);

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

// ------------------------------------------------------------- shop admin --

async function handleShopAdmin(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'recent') {
    const rows = ctx.db.recentPurchases(15);
    await i.reply({
      embeds: [embed(COLORS.info, 'Recent purchases',
        rows.length
          ? rows.map((r) =>
              `<@${r.discordId}> — **${r.species}** for ${display(r.price).toLocaleString()}` +
              (r.mutations ? ` (${r.mutations})` : '') +
              ` · <t:${Math.floor(new Date(r.at).getTime() / 1000)}:R>`).join('\n')
          : 'Nothing has been bought yet.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'panel') {
    const channel = i.options.getChannel('channel', true);
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    setShopPanelChannel(ctx, channel.id);

    try {
      await postOrEdit(ctx.db, i.client, channel.id, SHOP_PANEL_MESSAGE_KEY,
        [buildShopPanel(ctx)], shopPanelRows());
      await i.editReply({
        embeds: [embed(COLORS.good, 'Shop panel is live',
          `It is in <#${channel.id}>.\n\nThe buttons keep working after a restart, ` +
          'so it can stay pinned.')],
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

  if (action === 'log') {
    const channel = i.options.getChannel('channel', true);
    ctx.db.setSetting('shop_log_channel', channel.id);
    await i.reply({
      embeds: [embed(COLORS.good, 'Purchase log set',
        `Every purchase will be posted in <#${channel.id}>.\n\n` +
        'They are recorded either way — this just makes them visible.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'maxtier') {
    const tier = i.options.getInteger('tier', true);
    setMaxShopTier(ctx, tier);
    const excluded = Object.entries(TIER_LABEL)
      .filter(([t]) => Number(t) > tier)
      .map(([, label]) => label);

    await i.reply({
      embeds: [embed(COLORS.good, 'Shop limit set',
        `The shop sells up to **${TIER_LABEL[tier]}**.\n\n` +
        (excluded.length > 0
          ? `${excluded.join(', ')} cannot be bought — the catalogue says so, ` +
            'and buying one by name is refused rather than quietly hidden.'
          : 'Everything is for sale, apexes included.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'mutationprice') {
    const points = i.options.getInteger('points', true);
    ctx.db.setSetting('shop_mutation_price', String(points));
    await i.reply({
      embeds: [embed(COLORS.good, 'Mutation price set',
        points === 0
          ? 'Mutations are now **free** with a purchase.'
          : `Each mutation adds **${points}** to the price.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const points = i.options.getInteger('points', true);

  if (action === 'tierprice') {
    const tier = i.options.getInteger('tier', true);
    setTierPrice(ctx, tier, points);
    await i.reply({
      embeds: [embed(COLORS.good, 'Tier price set',
        `Everything in **${TIER_LABEL[tier]}** now costs **${points}**, unless it has ` +
        'its own price.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const species = i.options.getString('species', true).trim();
  setSpeciesPrice(ctx, species, points);
  await i.reply({
    embeds: [embed(COLORS.good, 'Price set',
      `**${species}** now costs **${points}**` +
      `${mutationPrice(ctx) > 0 ? `, plus ${mutationPrice(ctx)} per mutation` : ''}.`)],
    flags: MessageFlags.Ephemeral,
  });
}

// ------------------------------------------------------------------ skins --

async function handleSkin(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'palette') {
    await i.reply({
      embeds: [embed(COLORS.info, '🎨  Preset colours',
        PRESETS.map((p) => `\`${p.hex}\`  ${p.name}`).join('\n') +
        '\n\nAny hex works too — these are just a starting point.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'expiry') {
    const hours = i.options.getInteger('hours', true);
    setSkinExpiryHours(ctx, hours);
    await i.reply({
      embeds: [embed(COLORS.good, 'Skin expiry set',
        `A look is forgotten after **${hours} hours** without being worn.\n\n` +
        'The clock runs from the last time it was actually painted onto a live ' +
        'dinosaur, so one being played never expires under its owner. It is the ' +
        'line between keeping a dinosaur looking right and a colour following ' +
        'somebody onto every animal of that species for weeks.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'presets') {
    const saved = ctx.db.presetNames();
    const swatch = (colours: Record<string, string>): string =>
      colours['BodyColor'] ? `\`${colours['BodyColor']}\` ` : '';

    await i.reply({
      embeds: [embed(COLORS.info, 'Skins',
        '**Ready made**\n' +
        // Sorted: two dozen is enough that insertion order stops being findable.
        Object.entries(BUILT_IN)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, look]) =>
            `${swatch(look.colours)}**${name}**` +
            (look.pattern === undefined ? '' : ` · pattern ${patternLetter(look.pattern)}`))
          .join('\n') +
        '\n\n**Saved here**\n' +
        (saved.length
          ? saved.map((n) => `• **${n}**`).join('\n')
          : '_None yet. Colour a dinosaur, then `/admin skin save` it._') +
        '\n\nSaving over a ready-made name replaces it.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'forget') {
    const name = i.options.getString('preset', true);
    await i.reply({
      embeds: [ctx.db.removePreset(name)
        ? embed(COLORS.good, 'Preset deleted', `**${name}** is gone.`)
        : embed(COLORS.quiet, 'No such preset', `There is no preset called **${name}**.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const user = i.options.getUser('user', true);
  const link = ctx.db.linkFor(user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Not linked',
        `${user} has not linked a Steam account, so there is no dinosaur to find.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'pattern') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const spawned = await ctx.mod.players().catch(() => []);
    const species = spawned.find((p) => p.steam === link.steamId)?.species;
    if (!species) {
      await i.editReply({
        embeds: [embed(COLORS.warn, 'They are not spawned in',
          `${user} needs to be playing a dinosaur.`)],
      });
      return;
    }

    const index = Number.parseInt(i.options.getString('pattern', true), 10);

    try {
      const result = await ctx.mod.run('pattern', link.steamId, { index });
      if (!result.ok) {
        await i.editReply({ embeds: [embed(COLORS.bad, 'Could not do that', result.msg)] });
        return;
      }

      ctx.db.setPattern(link.steamId, species, index);

      await i.editReply({
        embeds: [embed(COLORS.good, `Pattern ${patternLetter(index)}`,
          `${user}'s **${species}** is on pattern **${patternLetter(index)}**.\n\n` +
          'How many patterns a species has varies, and the game does not say. If ' +
          'nothing changed, that species has no pattern ' +
          `${patternLetter(index)} — try a lower letter. **Their colours are ` +
          'untouched either way**, because the pattern is sent on its own.')],
      });
    } catch (err) {
      await i.editReply({
        embeds: [embed(COLORS.bad, 'Something went wrong', describeError(err))],
      });
    }
    return;
  }

  if (action === 'grant' || action === 'revoke') {
    const name = i.options.getString('preset', true).trim();
    if (!presetLook(ctx, name)) {
      await i.reply({
        embeds: [embed(COLORS.warn, 'No such preset',
          `There is no saved preset called **${name}**. ` +
          '`/admin skin presets` lists them.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'grant') {
      const reason = i.options.getString('reason')?.trim() ?? '';
      const fresh = ctx.db.grantSkin(link.steamId, name, reason);
      await i.reply({
        embeds: [embed(fresh ? COLORS.good : COLORS.quiet,
          fresh ? 'Skin granted' : 'They already had it',
          fresh
            ? `${user} owns **${name}** now, for good. It shows up on the skins ` +
              'panel and they can wear it on anything.'
            : `${user} already owns **${name}**. Nothing changed.`)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const had = ctx.db.revokeSkin(link.steamId, name);
    await i.reply({
      embeds: [embed(had ? COLORS.good : COLORS.quiet,
        had ? 'Skin taken back' : 'They did not own it',
        had
          ? `${user} no longer owns **${name}**.

If they are wearing it right ` +
            'now it stays on until they change or die - taking the entitlement ' +
            'away does not repaint them.'
          : `${user} does not own **${name}**.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'owned') {
    const owned = ctx.db.ownedSkins(link.steamId);
    await i.reply({
      embeds: [embed(COLORS.info, `Skins ${user} owns`,
        owned.length === 0
          ? 'None yet. `/admin skin grant` gives one.'
          : owned.map((o) =>
            `• **${o.preset}**${o.source ? ` — ${o.source}` : ''}` +
            (presetLook(ctx, o.preset) ? '' : ' _(preset deleted)_')).join('\n'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'reset') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const cleared = ctx.db.clearSkin(link.steamId);
    forgetPainted(link.steamId);

    // Forgetting alone left the colours on the live dinosaur until it died or
    // they relogged, which is not what "reset" means to anybody. If the
    // original was recorded, it goes back on now.
    const playing = (await ctx.mod.players().catch(() => []))
      .find((p) => p.steam === link.steamId)?.species;
    const restored = playing
      ? await restoreBaseline(ctx, link.steamId, playing)
      : 'no-baseline';

    await i.editReply({
      embeds: [embed(restored === 'restored' ? COLORS.good : COLORS.quiet,
        restored === 'restored' ? 'Colours reset' : 'Colours forgotten',
        (cleared > 0
          ? `Cleared ${cleared} saved look${cleared === 1 ? '' : 's'} for ${user}.`
          : `${user} had no colours saved.`) +
        (restored === 'restored'
          ? `\n\nTheir live **${playing}** is back to the colours it hatched ` +
            'with, straight away.'
          : !playing
            ? '\n\nThey are not on a dinosaur, so nothing could be repainted. ' +
              'What they are wearing next time they spawn is their own again.'
            : '\n\nNo original colours were recorded for that dinosaur, so ' +
              'there was nothing to put back. What they have now stays until ' +
              'they relog or die.'))],
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  // Colours belong to the dinosaur they are playing, not to them, so we need to
  // know what that is. It also means they have to be spawned.
  const spawned = await ctx.mod.players().catch(() => []);
  const species = spawned.find((p) => p.steam === link.steamId)?.species;
  if (!species) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'They are not spawned in',
        `${user} needs to be playing a dinosaur — colours are saved per species, ` +
        'so there is nothing to attach them to yet.')],
    });
    return;
  }

  try {
    if (action === 'save') {
      const name = i.options.getString('name', true).trim();
      const read = await ctx.mod.run('skinget', link.steamId);
      if (!read.ok) {
        await i.editReply({ embeds: [embed(COLORS.bad, 'Could not read their colours', read.msg)] });
        return;
      }

      // Stored as sRGB hex so a preset stays readable and editable, rather
      // than a wall of linear floats.
      const live = (read.data ?? {}) as unknown as Record<string, [number, number, number]>;
      const colours: Record<string, string> = {};
      for (const [field, rgb] of Object.entries(live)) {
        if (Array.isArray(rgb) && rgb.length === 3) {
          colours[field] = linearToHex(rgb[0], rgb[1], rgb[2]);
        }
      }

      // The pattern travels with the colours: it decides which parts each one
      // lands on, so a preset without it only half-describes the look.
      const livePattern = (live as unknown as Record<string, unknown>)['PatternIndex'];
      const pattern = typeof livePattern === 'number' ? livePattern : undefined;

      ctx.db.savePreset(name, pattern === undefined ? { colours } : { colours, pattern }, i.user.tag);
      await i.editReply({
        embeds: [embed(COLORS.good, 'Preset saved',
          `**${name}** captured from ${user}, ${Object.keys(colours).length} colours` +
          (pattern === undefined ? '' : ` on pattern **${patternLetter(pattern)}**`) + '.\n\n' +
          Object.entries(colours).map(([f, hex]) =>
            `\`${hex}\`  ${PARTS.find((p) => p.field === f)?.label ?? f}`).join('\n'))],
      });
      return;
    }

    // Both apply and set end up here: a map of field to hex, written in one go.
    let colours: Record<string, string> = {};
    let pattern: number | undefined;
    let title = '🎨  Colours applied';

    if (action === 'apply') {
      const name = i.options.getString('preset', true);
      // A saved preset of the same name wins, so a ready-made one can be
      // overridden without editing code.
      const stored = ctx.db.preset(name) ?? BUILT_IN[name] ?? null;
      if (!stored) {
        await i.editReply({
          embeds: [embed(COLORS.warn, 'No such preset',
            `There is no preset called **${name}**. See \`/admin skin presets\`.`)],
        });
        return;
      }
      colours = stored.colours;
      pattern = stored.pattern;
      title = `🎨  ${name} applied`;
    } else {
      for (const n of ['', '2', '3', '4']) {
        const field = i.options.getString(`part${n}`, n === '');
        const raw = i.options.getString(`colour${n}`, n === '');
        if (!field || !raw) continue;

        // Presets are offered by name; anything else has to be a hex code.
        const hex = PRESETS.find((p) => p.name.toLowerCase() === raw.toLowerCase())?.hex ?? raw;
        if (!hexToLinear(hex)) {
          await i.editReply({
            embeds: [embed(COLORS.warn, 'That is not a colour',
              `\`${raw}\` is not a hex code. Try \`#8C3B1E\`, or pick from ` +
              '`/admin skin palette`.')],
          });
          return;
        }
        colours[field] = hex;
      }
    }

    // Pattern first and on its own: out of range it makes the client abort the
    // rebuild, which would take the colours with it if they shared a write.
    //
    // And the result has to be READ. Patterns are validated per species, so the
    // server refuses an index that species does not have — and because the
    // refusal aborts the rebuild, the colours silently do not land either. This
    // used to be fire-and-forget, which reported a confident success for a
    // dinosaur that had not changed at all.
    if (pattern !== undefined) {
      const applied = await ctx.mod
        .run('pattern', link.steamId, { index: pattern })
        .catch((err: unknown) => ({ ok: false, msg: describeError(err) }));

      if (!applied.ok) {
        await i.editReply({
          embeds: [embed(COLORS.warn, 'That pattern does not exist for this species',
            `${applied.msg}\n\n**Nothing was changed.** Patterns are per species — ` +
            `**${species}** does not have **${patternLetter(pattern)}**. Try an ` +
            'earlier letter, or leave the pattern off to only set colours.')],
        });
        return;
      }
      ctx.db.setPattern(link.steamId, species, pattern);
    }

    // Recorded before the first paint, so a later reset has something to put
    // back. Never overwritten, so painting twice does not make the first paint
    // look like the dinosaur's own colours.
    await captureBaseline(ctx, link.steamId, species);

    // Same reason as the pattern above: the variation is part of the look, and
    // leaving it is what made skins land on only half the animal.
    await applyLookIndexes(ctx, link.steamId, {});

    const result = await ctx.mod.run('skinmany', link.steamId, {
      colors: encodeColours(colours),
    });

    if (!result.ok) {
      await i.editReply({ embeds: [embed(COLORS.bad, 'Could not do that', result.msg)] });
      return;
    }

    // Recorded so it survives relogs, respawns and restarts — the engine drops
    // colours on all three, so the bot repaints from this.
    ctx.db.setSkin(link.steamId, species, colours);
    forgetPainted(link.steamId);

    const first = Object.values(colours)[0] ?? '#57F287';
    await i.editReply({
      embeds: [new EmbedBuilder()
        .setColor(hexToInt(first) ?? COLORS.good)
        .setTitle(title)
        .setDescription(
          `On ${user}'s **${species}**` +
          (pattern === undefined ? ':\n' : `, pattern **${patternLetter(pattern)}**:\n`) +
          Object.entries(colours).map(([f, hex]) =>
            `\`${hex.toUpperCase()}\`  ${PARTS.find((p) => p.field === f)?.label ?? f}`).join('\n') +
          `\n\nRemembered for their **${species}** specifically — other species keep ` +
          'their own looks. The engine drops colours on relog, respawn and restart, ' +
          'so the bot repaints them within a minute of each.')
        .setFooter({ text: SIGNATURE })
        .setTimestamp()],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Something went wrong', describeError(err))],
    });
  }
}

// ------------------------------------------------------------------ tiers --

async function handleTiers(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'list') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const species = await speciesList(ctx);
    const byTier = new Map<number, string[]>();
    for (const name of species) {
      const tier = tierOf(ctx, name);
      byTier.set(tier, [...(byTier.get(tier) ?? []), name]);
    }

    const lines = [4, 3, 2, 1].map((tier) =>
      `**${TIER_LABEL[tier]}** ·  ×${multiplierFor(ctx, tier)} points\n` +
      (byTier.get(tier)?.join(', ') || '_nothing_'));

    await i.editReply({
      embeds: [embed(COLORS.info, 'Species tiers',
        `${lines.join('\n\n')}\n\nA kill is worth the **victim's** tier, with a bonus ` +
        'for killing something above you.')],
    });
    return;
  }

  if (action === 'killpoints') {
    const points = i.options.getInteger('points', true);
    ctx.db.setSetting('kill_points', String(points));
    await i.reply({
      embeds: [embed(COLORS.good, 'Kill value set',
        `A kill is now worth **${points}** points before tier scaling — so a tier 4 ` +
        `victim pays ${Math.round(points * multiplierFor(ctx, 4))}.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'multiplier') {
    const tier = i.options.getInteger('tier', true);
    const multiplier = i.options.getNumber('multiplier', true);
    setMultiplier(ctx, tier, multiplier);
    await i.reply({
      embeds: [embed(COLORS.good, 'Multiplier set',
        `**${TIER_LABEL[tier]}** now earns **×${multiplier}** points, and its kills ` +
        'are worth that much more.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const species = i.options.getString('species', true).trim();
  const tier = i.options.getInteger('tier', true);
  setTier(ctx, species, tier);

  await i.reply({
    embeds: [embed(COLORS.good, 'Tier set',
      `**${species}** is now **${TIER_LABEL[tier]}** — ×${multiplierFor(ctx, tier)} points ` +
      'while playing it, and worth that much more to kill.')],
    flags: MessageFlags.Ephemeral,
  });
}

// ---------------------------------------------------------------- cleanup --

/**
 * There is no safe way to sweep the world from Lua — destroying actors crashes
 * the server when gameplay already removed one. So cleanup is what the server
 * can do for itself: rot corpses faster, clear them wholesale over RCON, and
 * restart.
 */
async function handleCleanup(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  const restarts = restartSettings(ctx);

  if (action === 'status') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    let live: string | null = null;
    try {
      live = AdminStore.readKey(await ctx.admins.readIni(), 'CorpseDecayMultiplier');
    } catch {
      // Config unreadable; the desired value is still worth showing.
    }

    const wanted = ctx.db.managedGameSettings()
      .find((s) => s.key === 'CorpseDecayMultiplier')?.value;
    const cleanup = cleanupSettings(ctx);
    const next = nextCleanup(new Date(), cleanup.hours);

    await i.editReply({
      embeds: [embed(COLORS.info, 'Cleanup',
        '**Scheduled cleanup** — ' +
        (cleanup.enabled
          ? `every ${cleanup.hours}h, next <t:${Math.floor(next.getTime() / 1000)}:R>` +
            `\nClears corpses${cleanup.clearAI ? ' and AI' : ' only — AI clearing is off'}. ` +
            'A cycle landing on a restart is skipped.'
          : 'off. `/admin cleanup every 3` turns it on.') +
        `\n\n**Corpse decay** — currently \`${live ?? 'unknown'}\`` +
        (wanted && wanted !== live ? `, set to \`${wanted}\` at the next restart` : '') +
        '\n\n**Restarts** — ' +
        (restarts.enabled
          ? `every ${restarts.intervalHours}h. Still the only way to clear stuck AI, ` +
            'which corpse clearing does not touch.'
          : '**off**. `/admin restarts on` — a restart is the only way to clear stuck ' +
            'AI, which corpse clearing does not touch.'))],
    });
    return;
  }

  if (action === 'off') {
    setCleanupEnabled(ctx, false);
    await i.reply({
      embeds: [embed(COLORS.good, 'Automatic cleanup off',
        'Corpses will no longer be cleared on a schedule. Decay rate and restarts ' +
        'are unaffected.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'ai') {
    const on = i.options.getBoolean('on', true);
    setCleanupAI(ctx, on);
    await i.reply({
      embeds: [embed(COLORS.good, on ? 'AI clearing on' : 'AI clearing off',
        on
          ? 'Each cleanup switches AI off and straight back on, which clears out ' +
            'anything stuck. Corpses are wiped either way.'
          : 'Cleanup will only wipe corpses. Stuck AI then needs a restart.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'now') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const settings = cleanupSettings(ctx);
    const wiped = await wipeNow(ctx, () => {});
    const ai = settings.clearAI ? await clearAI(ctx, () => {}) : null;

    const AI_LINE: Record<string, string> = {
      cleared: '✅ AI cleared',
      disabled: '➖ AI spawns are off on this server, so there was nothing to clear',
      failed: '❌ AI — the server did not answer',
      inverted: '⚠️ AI — the toggle went one way and not back. Run this again.',
    };

    const lines = [
      wiped ? '✅ Corpses cleared' : '❌ Corpses — the server did not answer',
      ai === null ? '➖ AI clearing is switched off' : AI_LINE[ai] ?? '',
    ];

    await i.editReply({
      embeds: [embed(wiped ? COLORS.good : COLORS.bad, 'Cleanup run', lines.join('\n'))],
    });
    return;
  }

  if (action === 'every') {
    const hours = i.options.getInteger('hours', true);
    setCleanupHours(ctx, hours);
    setCleanupEnabled(ctx, true);

    const next = nextCleanup(new Date(), hours);
    const uneven = 24 % hours !== 0
      ? `\n\n⚠️ ${hours}h does not divide into 24, so the last gap before midnight is ` +
        'shorter. Use 1, 2, 3, 4, 6, 8, 12 or 24 for an even spread.'
      : '';

    await i.reply({
      embeds: [embed(COLORS.good, 'Automatic cleanup on',
        `Corpses will be cleared **every ${hours} hours**, on the clock — so the times ` +
        'are the same every day, between restarts.\n\n' +
        `Next: <t:${Math.floor(next.getTime() / 1000)}:F> (<t:${Math.floor(next.getTime() / 1000)}:R>)\n\n` +
        'Players get a one minute warning in game first, since a body someone is ' +
        'eating is about to disappear.' + uneven)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const multiplier = i.options.getNumber('multiplier', true);
  ctx.db.setManagedGameSetting('CorpseDecayMultiplier', String(multiplier));

  await i.reply({
    embeds: [embed(COLORS.good, 'Corpse decay set',
      `Corpses will rot **${multiplier}×** as fast as default.\n\n` +
      'Written to Game.ini during the next restart — the server rewrites that ' +
      'file when it stops, so the bot applies it while the server is down.' +
      (restarts.enabled
        ? ''
        : '\n\n⚠️ Scheduled restarts are off, so nothing will apply it. ' +
          'Turn them on with `/admin restarts on`.'))],
    flags: MessageFlags.Ephemeral,
  });
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
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const caps = ctx.db.speciesCaps();

    // A cap whose name the server never reports can never match a live count,
    // so it silently does nothing — usually a mis-typed one sitting next to the
    // real row. Flag it rather than listing it as though it worked.
    const known = await knownSpecies(ctx);
    const real = new Set(known);
    const stale = known.length > 0 ? caps.filter((c) => !real.has(c.species)) : [];

    const line = (c: { species: string; cap: number; locked: boolean }): string =>
      real.has(c.species) || known.length === 0
        ? `${c.locked ? '🔒' : '🔓'} **${c.species}** — max ${c.cap}`
        : `⚠️ \`${c.species}\` — max ${c.cap} · not a species this server has`;

    await i.editReply({
      embeds: [embed(COLORS.info, 'Species caps',
        (caps.length === 0
          ? 'No caps set. Use `/admin species cap` to add one, or ' +
            '`/admin species preset` for a whole balanced table at once.'
          : caps.map(line).join('\n')) +
        (stale.length > 0
          ? `\n\n⚠️ **${stale.length} of these do nothing.** The server never ` +
            'reports those spellings, so they can never match a player. Clear ' +
            `them: \`/admin species clear species:${stale[0]?.species}\``
          : ''))],
    });
    return;
  }

  if (action === 'preset') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const slots = ctx.admins.maxPlayers ?? 100;
    const planned = planCaps(ctx, slots, await speciesList(ctx));
    applyCaps(ctx, planned);

    // Grouped by tier, because the shape of the table is the point: apexes
    // scarce, the bottom tier generous enough that there is always a spawn.
    const byTier = new Map<number, PlannedCap[]>();
    for (const entry of planned) {
      const bucket = byTier.get(entry.tier) ?? [];
      bucket.push(entry);
      byTier.set(entry.tier, bucket);
    }

    const lines = [...byTier.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([tier, entries]) =>
        `**${TIER_LABEL[tier] ?? `Tier ${tier}`}**\n` +
        entries.map((e) => `${e.species} — **${e.cap}**`).join(' · '));

    const total = planned.reduce((sum, e) => sum + e.cap, 0);

    await i.editReply({
      embeds: [embed(COLORS.good, `Caps set for ${slots} slots`,
        `${lines.join('\n\n')}\n\n` +
        `The caps add up to **${total}** across **${slots}** slots, so they are not ` +
        'a queue — only the popular picks ever fill. Move any of them with ' +
        '`/admin species cap`.\n\n' +
        '⚠️ These still **announce** rather than block. Enforcement needs the ' +
        'spawn menu wired up.')],
    });
    return;
  }

  if (action === 'enforce') {
    const on = i.options.getBoolean('on', true);
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    setEnforcement(ctx, on);

    if (!on) {
      // Leaving a species removed with nothing left to restore it would be a
      // silent permanent ban, so switching off always puts everything back.
      try {
        const restored = await restoreAllPlayables(ctx, await speciesList(ctx), () => {});
        await i.editReply({
          embeds: [embed(COLORS.good, 'Enforcement off',
            'Caps announce again rather than blocking.' +
            (restored.length > 0
              ? `\n\nPut back in the spawn menu: **${restored.join('**, **')}**.`
              : ''))],
        });
      } catch (err) {
        await i.editReply({
          embeds: [embed(COLORS.bad, 'Enforcement off, but the menu is unchanged',
            `${describeError(err)}\n\n⚠️ Any species locked right now is still ` +
            'missing from the spawn menu. Run this again once the server answers.')],
        });
      }
      return;
    }

    try {
      const result = await syncPlayables(ctx, await speciesList(ctx), () => {});
      await i.editReply({
        embeds: [result.verified
          ? embed(COLORS.good, 'Enforcement on',
            'A species at its cap is now removed from the spawn menu, and comes ' +
            'back when someone stops playing it.\n\n' +
            (result.remove.length > 0
              ? `Removed now: **${result.remove.join('**, **')}**.\n\n`
              : '') +
            'It is reconciled on every population poll, so a bot or server restart ' +
            'cannot leave a species stuck.')
          : embed(COLORS.bad, 'This server did not accept it',
            `${enforcementFault(ctx) ?? 'the write did not take'}.\n\n` +
            'Enforcement has switched itself back off — the caps still announce. ' +
            'Nothing is stuck: the spawn menu is unchanged.')],
      });
    } catch (err) {
      setEnforcement(ctx, false);
      await i.editReply({
        embeds: [embed(COLORS.bad, 'Could not reach the server',
          `${describeError(err)}\n\nEnforcement is off. Try again when it is up.`)],
      });
    }
    return;
  }

  const typed = i.options.getString('species', true).trim();

  if (action === 'tryout') {
    const name = i.options.getString('species', true).trim();
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const link = ctx.db.linkFor(i.user.id);
    if (!link) {
      await i.editReply({
        embeds: [embed(COLORS.warn, 'Link your account first',
          'The window closes when you are seen playing it, so the bot needs to '
          + 'know which character is yours.')],
      });
      return;
    }

    if (activeTryout(ctx)) {
      await i.editReply({
        embeds: [embed(COLORS.warn, 'One at a time',
          'A tryout is already open. Wait for it to close, or spawn what it '
          + 'offered.')],
      });
      return;
    }

    try {
      await ctx.rcon.addPlayable(name);
    } catch (err) {
      await i.editReply({
        embeds: [embed(COLORS.bad, 'The server refused it',
          `${describeError(err)}

The spelling has to match the game exactly.`)],
      });
      return;
    }

    const listed = parsePlayables(await ctx.rcon.playables().catch(() => ''));
    if (!listed.some((sp: string) => sp.toLowerCase() === name.toLowerCase())) {
      await i.editReply({
        embeds: [embed(COLORS.warn, 'Not in the menu',
          `The server took **${name}** without complaining, but it is not there `
          + 'afterwards — so that class does not exist in this build under that '
          + 'name. Nothing was left open.')],
      });
      return;
    }

    // Never recorded in the roster: that is what enforcement re-adds from, so
    // remembering it here would have the cap system put it back a minute later.
    const tryout = startTryout(ctx, name, link.steamId);

    await i.editReply({
      embeds: [embed(COLORS.good, `${name} is spawnable — for you, now`,
        '**Go and spawn it.** The moment you are seen playing it, it comes back '
        + 'off the menu.\n\n'
        + `If you do not, it closes on its own <t:${Math.floor(tryout.until / 1000)}:R>.\n\n`
        + '⚠️ It is in **everybody’s** menu until then — the window is short, '
        + 'not private. And a live dinosaur cannot be transformed, so this is '
        + 'the only way in: the game decides species at the spawn screen and the '
        + 'mod cannot drive that.')],
    });
    return;
  }

  if (action === 'unlock') {
    const name = i.options.getString('species', true).trim();
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    // Typed, not picked. This is the one place a name is taken on trust: it
    // exists to reach species the server has never listed, so validating it
    // against the list would defeat the entire point.
    try {
      await ctx.rcon.addPlayable(name);
    } catch (err) {
      await i.editReply({
        embeds: [embed(COLORS.bad, 'The server refused it',
          `${describeError(err)}

Most likely that is not a class this build ` +
          'has. The spelling must match the game exactly.')],
      });
      return;
    }

    // Read back rather than trusted: addplayable reports success for a name the
    // game then quietly ignores, and a menu that did not change is the only
    // honest evidence either way.
    const listed = parsePlayables(await ctx.rcon.playables().catch(() => ''));
    const there = listed.some((sp: string) => sp.toLowerCase() === name.toLowerCase());
    if (there) ctx.db.rememberSpecies([name]);

    await i.editReply({
      embeds: [embed(there ? COLORS.good : COLORS.warn,
        there ? 'In the spawn menu' : 'Accepted, but not in the menu',
        there
          ? `**${name}** is spawnable now. It survives a bot restart, and the ` +
            'cap system will treat it like any other species.\n\n' +
            'Unreleased species can be missing animations or crash on spawn — ' +
            'that is the game, not the bot.'
          : `The server took **${name}** without complaining, but it is not in ` +
            'the menu afterwards. That usually means the class does not exist ' +
            'in this build under that name.')],
    });
    return;
  }

  if (action === 'clear') {
    // Case-insensitive, deliberately: the row being cleared is often a
    // mis-typed one, and refusing to remove it because the case is wrong is
    // exactly how it got stuck there.
    const removed = ctx.db.removeSpeciesCap(typed);
    await i.reply({
      embeds: [removed
        ? embed(COLORS.good, 'Cap removed', `**${typed}** is uncapped again.`)
        : embed(COLORS.quiet, 'Nothing to remove', `**${typed}** had no cap. ` +
            'Check `/admin species list`.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  // Store the spelling the SERVER uses, not the one that was typed.
  //
  // The caps table is keyed by name and SQLite compares keys case-sensitively,
  // so `tyrannosaurus` and `Tyrannosaurus` were two separate rows. Live counts
  // only ever arrive under the server's spelling, so the mis-cased row could
  // never match a player and would never lock — a cap that silently does
  // nothing. Observed live: both spellings sitting in `/admin species list`.
  // The roster, not the live menu: a species capped to zero is absent from the
  // menu by design, so asking the menu whether it exists refuses to let anybody
  // raise the cap that removed it.
  const known = await knownSpecies(ctx);
  const species = known.find((s) => s.toLowerCase() === typed.toLowerCase());

  if (!species && known.length > 0) {
    const near = known.filter((s) => s.toLowerCase().startsWith(typed.slice(0, 3).toLowerCase()));
    await i.editReply({
      embeds: [embed(COLORS.warn, 'No such species',
        `This server does not have a **${typed}**.` +
        (near.length > 0 ? `\n\nDid you mean: **${near.join('**, **')}**?` : '') +
        '\n\nThe species option autocompletes from what the server actually ' +
        'reports — picking from the list avoids this.')],
    });
    return;
  }

  const max = i.options.getInteger('max', true);
  ctx.db.setSpeciesCap(species ?? typed, max);

  const stored = species ?? typed;
  await i.editReply({
    embeds: [embed(COLORS.good, 'Cap set',
      `**${stored}** is capped at **${max}** online.` +
      (species && species !== typed
        ? `\n\nStored as **${species}**, which is how the server spells it.`
        : '') +
      '\n\n' +
      (enforcementEnabled(ctx)
        ? 'Enforcement is on, so hitting the cap takes it out of the spawn menu.'
        : 'This **announces** rather than blocking — staff and players act on it. ' +
          '`/admin species enforce on` makes it a real wall.'))],
  });
}


// ---------------------------------------------------------------- prime --

/** Shared by both commands: everything needed to read somebody's flags. */
async function readPrime(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  discordId: string,
): Promise<{ state: import('./bridge.js').PrimeState } | { error: EmbedBuilder }> {
  const link = ctx.db.linkFor(discordId);
  if (!link) {
    return {
      error: embed(COLORS.warn, 'Not linked',
        discordId === i.user.id
          ? 'Prime is read off your live dinosaur, so the bot needs to know which '
            + 'account is yours. Press **Verify** on the panel.'
          : 'That person has not linked a Steam account.'),
    };
  }

  try {
    return { state: await ctx.mod.prime(link.steamId) };
  } catch (err) {
    return {
      error: embed(COLORS.warn, 'Could not read it',
        `${describeError(err)}

This reads the dinosaur you are playing right `
        + 'now, so you have to be in game.'),
    };
  }
}

async function handlePrime(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const read = await readPrime(ctx, i, i.user.id);

  await i.editReply({
    embeds: ['error' in read ? read.error : buildPrimeEmbed(read.state, ctx)],
  });
}

async function handlePrimeDebug(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void> {
  const user = i.options.getUser('player') ?? i.user;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const read = await readPrime(ctx, i, user.id);

  await i.editReply({
    embeds: ['error' in read
      ? read.error
      : buildPrimeDebugEmbed(read.state, `<@${user.id}>`)],
  });
}



// ----------------------------------------------------------------- hunt --

async function handleHunt(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'channel') {
    const channel = i.options.getChannel('channel', true);
    setHuntChannel(ctx, channel.id);
    await i.reply({
      embeds: [embed(COLORS.good, 'Hunt channel set',
        `Results go to <#${channel.id}>. The target, their position and the `
        + 'outcome are all announced in game as well.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'stop') {
    const running = activeHunt(ctx);
    saveHunt(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.good, running ? 'Hunt called off' : 'Nothing running',
        running
          ? `The hunt for **${running.targetName}** is over and nobody was paid. `
            + 'Nothing is announced in game, so tell them yourself if people are '
            + 'still looking.'
          : 'There was no hunt to stop.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'status') {
    const running = activeHunt(ctx);
    await i.reply({
      embeds: [running
        ? buildHuntEmbed(running, 'running')
        : embed(COLORS.quiet, 'Nothing running',
          'Use `/admin hunt start` and pick somebody willing.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const target = i.options.getUser('target', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  if (activeHunt(ctx)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'One at a time',
        'A hunt is already running. `/admin hunt stop` ends it first.')],
    });
    return;
  }

  const link = ctx.db.linkFor(target.id);
  if (!link) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'They are not linked',
        `${target} has no Steam account linked, so the bot cannot tell where `
        + 'they are or who killed them.')],
    });
    return;
  }

  const skin = i.options.getString('skin')?.trim();
  if (skin && !presetLook(ctx, skin)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'No such skin',
        `There is no preset called **${skin}**.`)],
    });
    return;
  }

  const minutes = i.options.getInteger('minutes') ?? 20;
  const revealMinutes = i.options.getInteger('reveal') ?? 3;
  const now = Date.now();

  // Named in the opening call as well as the position ones. Best effort: a
  // target on the spawn screen has nothing to report, and the first position
  // call fills it in.
  const species = (await ctx.mod.players().catch(() => [] as PlayerRow[]))
    .find((p) => p.steam === link.steamId)?.species;

  const hunt: Hunt = {
    targetSteam: link.steamId,
    ...(species ? { targetSpecies: species } : {}),
    // The in-game name if the bot has seen one, since a Discord handle means
    // nothing to somebody reading server chat.
    targetName: ctx.db.gameName(link.steamId) ?? target.username,
    reward: i.options.getInteger('reward') ?? 1500,
    ...(skin ? { skin } : {}),
    endsAt: now + (minutes * 60_000),
    revealEveryMs: revealMinutes * 60_000,
    // Counted from the start, so the first call-out is one interval in rather
    // than immediately - the target deserves a head start.
    lastRevealAt: now,
    startedAt: now,
  };

  saveHunt(ctx, hunt);
  await ctx.rcon.announce(toPlainAscii(huntAnnounce(hunt))).catch(() => undefined);

  const channelId = huntChannel(ctx);
  if (channelId) {
    const channel = await i.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && 'send' in channel) {
      await channel.send({ embeds: [buildHuntEmbed(hunt, 'running')] }).catch(() => undefined);
    }
  }

  await i.editReply({
    embeds: [embed(COLORS.good, 'Hunt started',
      `**${hunt.targetName}** is the target for **${minutes} minutes**, worth `
      + `**${hunt.reward}** points` + (skin ? ` and the **${skin}** skin` : '') + '.\n\n'
      + `Their position is called out every **${revealMinutes} minutes**, starting `
      + 'one interval from now.\n\n'
      + '⚠️ It has to be a **player kill**. Bleeding out from a fight counts — '
      + 'whoever last wounded them is paid — but drowning, starving or being '
      + 'taken by wildlife leaves nobody to credit, and that is a survival.')],
  });
}

// -------------------------------------------------------------- contest --

async function handleContest(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'channel') {
    const channel = i.options.getChannel('channel', true);
    setContestChannel(ctx, channel.id);
    await i.reply({
      embeds: [embed(COLORS.good, 'Contest channel set',
        `Results are posted in <#${channel.id}>. The start and the win are also `
        + 'announced in game, which is where people actually are.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'stop') {
    const running = activeContest(ctx);
    saveContest(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.good, running ? 'Contest called off' : 'Nothing running',
        running
          ? `**${running.name}** is over and nobody was paid. Anyone standing on `
            + 'it keeps nothing, so say something in game if people were trying.'
          : 'There was no contest to stop.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'status') {
    const running = activeContest(ctx);
    if (!running) {
      await i.reply({
        embeds: [embed(COLORS.quiet, 'Nothing running',
          'Stand somewhere good and use `/admin contest start`.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const players = await ctx.mod.players().catch(() => [] as PlayerRow[]);
    const holders = players.filter((p) => p.steam && inside(running, p))
      .map((p) => p.steam as string);

    await i.editReply({
      embeds: [buildContestEmbed(running, steamNamer(ctx),
        { holders, contested: holders.length > 1 })],
    });
    return;
  }

  // Starting. The location is wherever the admin is standing, which beats
  // typing coordinates: you can see what is there, and whether it is somewhere
  // worth fighting over.
  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        'The contest starts where you are standing, so the bot needs to know '
        + 'which character is yours.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  if (activeContest(ctx)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'One at a time',
        'A contest is already running. `/admin contest stop` ends it first — two '
        + 'at once would split everybody and neither would be fought over.')],
    });
    return;
  }

  const me = (await ctx.mod.players().catch(() => [] as PlayerRow[]))
    .find((p) => p.steam === link.steamId);

  if (!me || me.x === undefined || me.y === undefined) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Cannot see where you are',
        'Join the server, stand where you want it, and run this again.')],
    });
    return;
  }

  const skin = i.options.getString('skin')?.trim();
  if (skin && !presetLook(ctx, skin)) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'No such skin',
        `There is no preset called **${skin}**. Make one with \`/admin skin save\` `
        + 'first, or leave it out and pay points only.')],
    });
    return;
  }

  const minutes = i.options.getInteger('minutes') ?? 5;
  const shared = i.options.getBoolean('shared') ?? false;
  const contest: Contest = {
    x: me.x,
    ...(shared ? { shared: true } : {}),
    y: me.y,
    // Typed in HUD units, stored in world units, like every other distance here.
    radius: (i.options.getInteger('radius') ?? 30) * 1000,
    holdMs: minutes * 60_000,
    reward: i.options.getInteger('reward') ?? 750,
    ...(skin ? { skin } : {}),
    name: i.options.getString('name')?.trim() || 'The Contested Ground',
    startedAt: Date.now(),
    progress: {},
  };

  saveContest(ctx, contest);

  // In game first: that is where the people who can act on it are.
  await ctx.rcon.announce(toPlainAscii(contestAnnounce(contest))).catch(() => undefined);

  const channelId = contestChannel(ctx);
  if (channelId) {
    const channel = await i.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased() && 'send' in channel) {
      await channel.send({ embeds: [buildContestEmbed(contest, steamNamer(ctx))] })
        .catch(() => undefined);
    }
  }

  await i.editReply({
    embeds: [embed(COLORS.good, 'Contest started',
      `**${contest.name}** at Lat **${hud(contest.y)}**, Long **${hud(contest.x)}**.\n\n`
      + `Hold it **${minutes} minutes** to win **${contest.reward}** points`
      + (skin ? ` and the **${skin}** skin` : '') + '.\n\n'
      + 'Two or more players inside and nobody gains. Announced in game already.')],
  });
}

// ----------------------------------------------------------------- nest --

/**
 * Nests are ordinary world actors with their mesh baked into the blueprint, so
 * unlike AI they are safe to spawn — see the long note in the mod. Nothing here
 * removes one: destroying an actor from Lua crashes the server even when the
 * pointer looks live, so the world cleans them up on its own schedule.
 */
async function handleNest(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.reply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        'The nest goes where you are standing, so the bot needs to know which '
        + 'character is yours.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  // The class path is not documented and differs between builds. This asks the
  // mod to write what it can actually see, which beats another round of guesses.
  if (action === 'classes') {
    const listed = await ctx.mod.run('nest', link.steamId, { class: 'list' })
      .catch((err: unknown) => ({ ok: false, msg: String(err) }));
    await i.editReply({
      embeds: [embed(listed.ok ? COLORS.good : COLORS.bad,
        listed.ok ? 'Written to the mod log' : 'Could not list them',
        `${listed.msg}\n\nRead them with \`pnpm log\` — lines starting `
        + '`nest class:`.')],
    });
    return;
  }

  const type = i.options.getString('type') ?? 'BP_Nest_Mound_Large_H_C';

  const result = await ctx.mod.run('nest', link.steamId, { class: type })
    .catch((err: unknown) => ({ ok: false, msg: String(err) }));

  if (!result.ok) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'No nest', result.msg)],
    });
    return;
  }

  await i.editReply({
    embeds: [embed(COLORS.good, 'Nest placed',
      `A **${type.replace(/^BP_Nest_|_H_C$/g, '').replace(/_/g, ' ')}** is now `
      + 'where you were standing.\n\n'
      + 'It cannot be removed from here — destroying an actor from the mod '
      + 'crashes the server, so the world clears it up in its own time.')],
  });
}

// ------------------------------------------------------------ referrals --

async function handleReferrals(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'on' || action === 'off') {
    const on = action === 'on';
    setReferralsEnabled(ctx, on);

    // Checked when switching on rather than left for the first join to
    // discover: without it nobody can ever be credited, and it fails silently.
    const me = i.guild?.members.me;
    const canRead = me?.permissions.has(PermissionFlagsBits.ManageGuild) ?? false;

    await i.reply({
      embeds: [on
        ? embed(canRead ? COLORS.good : COLORS.warn, 'Referrals on',
          `**${display(referralReward(ctx)).toLocaleString()}** points to the ` +
          'inviter once the person they invited links **and** plays ' +
          `**${referralMinutes(ctx)} minutes**, plus ` +
          `**${display(referralWelcome(ctx)).toLocaleString()}** to the newcomer.` +
          (canRead
            ? '\n\nJoining alone pays nothing, so inviting strangers who never ' +
              'log in earns nothing either.'
            : '\n\n⚠️ The bot cannot read invites without **Manage Server**, so ' +
              'nobody can be credited. Grant it in Server Settings → Roles.'))
        : embed(COLORS.good, 'Referrals off',
          'Invites are no longer credited. Anything already earned is kept, and ' +
          'referrals recorded but not yet paid stay pending in case you turn ' +
          'this back on.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'set') {
    const reward = i.options.getInteger('reward');
    const welcome = i.options.getInteger('welcome');
    const minutes = i.options.getInteger('minutes');
    const weekly = i.options.getInteger('weekly');

    if (reward === null && welcome === null && minutes === null && weekly === null) {
      await i.reply({
        embeds: [embed(COLORS.warn, 'Nothing to change',
          'Give at least one of `reward`, `welcome`, `minutes` or `weekly`.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    setReferralAmounts(ctx, {
      ...(reward !== null ? { reward } : {}),
      ...(welcome !== null ? { welcome } : {}),
      ...(minutes !== null ? { minutes } : {}),
      ...(weekly !== null ? { weekly } : {}),
    });

    await i.reply({
      embeds: [embed(COLORS.good, 'Referrals updated',
        `• Inviter gets **${display(referralReward(ctx)).toLocaleString()}**\n` +
        `• Newcomer gets **${display(referralWelcome(ctx)).toLocaleString()}**\n` +
        `• After **${referralMinutes(ctx)} minutes** played\n` +
        `• At most **${referralWeeklyCap(ctx)}** paid per person per week` +
        (referralWeeklyCap(ctx) === 0 ? ' _(no cap)_' : '') +
        '\n\nThese apply from now on; anything already paid stands.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.reply({
    embeds: [buildReferralEmbed(ctx, ctx.db.referralCounts(), ctx.db.referralLeaderboard(5))],
    flags: MessageFlags.Ephemeral,
  });
}


// -------------------------------------------------------------- nesting --

async function handleNesting(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'on' || action === 'off') {
    setNestingEnabled(ctx, action === 'on');
    const s = nestingSettings(ctx);
    await i.reply({
      embeds: [embed(COLORS.good, action === 'on' ? 'Nesting pays' : 'Nesting off',
        action === 'on'
          ? `Every adult of the same species within **${s.radius}** of a new `
            + `hatchling gets **${s.parentPoints}** points, up to **${MAX_PARENTS}** `
            + 'of them.\n\n'
            + 'The hatchling is confirmed by its prime flags, so somebody who '
            + 'merely spawned in as a juvenile never triggers it. Who the parents '
            + 'were is worked out from where people are standing, because the '
            + 'game does not expose parentage — so it can occasionally pay '
            + 'somebody who was only passing through.'
          : 'Nests no longer pay.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'reward') {
    const points = i.options.getInteger('points', true);
    setNestingPoints(ctx, points);
    await i.reply({
      embeds: [embed(COLORS.good, 'Nest reward set',
        `Each parent now gets **${points}** points, up to **${MAX_PARENTS}** per nest.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'radius') {
    const hud = i.options.getInteger('hud', true);
    setNestingRadius(ctx, hud);
    await i.reply({
      embeds: [embed(COLORS.good, 'Nest radius set',
        `A parent must be within **${hud}** of the hatchling.

`
        + 'Smaller is stricter: it is the only thing separating a parent from '
        + 'somebody who happened to be nearby on the same species.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'condition') {
    const index = i.options.getInteger('index', true);
    setNestingCondition(ctx, index);
    await i.reply({
      embeds: [embed(COLORS.good, 'Condition set',
        `Flag **${index}** now means "get nested in".

`
        + 'This is a setting because the condition table was worked out from '
        + 'ordering rather than watched one at a time. If nests pay when they '
        + 'should not, or never pay, this is the number to move.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const s = nestingSettings(ctx);
  await i.reply({
    embeds: [embed(s.enabled ? COLORS.good : COLORS.quiet, 'Nesting',
      `${s.enabled ? '✅ Paying' : '⛔ Off'}

`
      + `🏆 **${s.parentPoints}** points per parent, up to **${MAX_PARENTS}**
`
      + `📍 Within **${s.radius}** HUD units
`
      + `🥚 Hatchling growth at or below **${Math.round(s.growth * 100)}%**
`
      + `🧬 Prime flag **${s.condition}**`)],
    flags: MessageFlags.Ephemeral,
  });
}

// --------------------------------------------------------------- market --

async function handleMarketPanel(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'listings') {
    const channel = i.options.getChannel('channel', true);
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    const forgotten = setListingsChannel(ctx, channel.id);
    const done = await refreshMarket(ctx, i.client);

    await i.editReply({
      embeds: [embed(COLORS.good, 'Listings moved',
        `Each listing now gets its own message in <#${channel.id}>, and the panel `
        + 'stays where it is.\n\n'
        + `**${done.posted}** open listing${done.posted === 1 ? '' : 's'} reposted there.`
        + (forgotten > done.posted
          ? '\n\nThe old messages are still in the previous channel. They are stale '
            + 'now — delete them when convenient; nothing breaks if you leave them.'
          : ''))],
    });
    return;
  }

  if (action === 'refresh') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const done = await refreshMarket(ctx, i.client);

    await i.editReply({
      embeds: [done.missing
        ? embed(COLORS.warn, 'No market channel',
          'Set one with `/admin market panel` first.')
        : embed(COLORS.good, 'Market redrawn',
          `**${done.posted}** listing${done.posted === 1 ? '' : 's'} reposted and `
          + `**${done.redrawn}** redrawn.`
          + (done.posted > 0
            ? '\n\nEach one has its own message, so it carries its own Buy button '
              + 'and can be struck through the moment it sells.'
            : ''))],
    });
    return;
  }

  if (action === 'fee') {
    const percent = i.options.getInteger('percent', true);
    setMarketFee(ctx, percent);
    await i.reply({
      embeds: [embed(COLORS.good, percent > 0 ? 'Cut set' : 'No cut',
        percent > 0
          ? `The server keeps **${percent}%** of every sale from now on. It is `
            + 'stated on each listing, so sellers see it before they price '
            + 'anything.\n\nListings made before now are unaffected — the cut is '
            + 'worked out when a sale completes.'
          : 'Sellers now keep the whole price.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'off') {
    setMarketChannel(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.warn, 'Market closed',
        'The panel stops working. **Open listings stay in escrow** — the '
        + 'dinosaurs are not lost, but nobody can buy or take one down until '
        + 'the market is open again.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = i.options.getChannel('channel', true);
  const listings = i.options.getChannel('listings');
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  setMarketChannel(ctx, channel.id);
  // Set before the panel is drawn: the panel names the listings channel when it
  // is a different one, so the order decides whether that line is right.
  if (listings) setListingsChannel(ctx, listings.id);

  try {
    await postOrEdit(ctx.db, i.client, channel.id, MARKET_MESSAGE_KEY,
      [buildMarketPanel(ctx)], marketRows());
    if (listings) await refreshMarket(ctx, i.client);

    await i.editReply({
      embeds: [embed(COLORS.good, 'Market open',
        `The panel is in <#${channel.id}>, and each listing gets its own message in `
        + `<#${listings?.id ?? channel.id}>.`
        + '\n\nA listed dinosaur leaves the seller\'s archive until it sells or '
        + 'is taken down, so nobody can sell the same one twice.')],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post it', describeError(err))],
    });
  }
}

// ------------------------------------------------------------- wardrobe --

async function handleWardrobePanel(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'off') {
    setWardrobeChannel(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.good, 'Skins panel off',
        'The message stays where it is; it just does nothing now. Skins people ' +
        'own are untouched.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = i.options.getChannel('channel', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  setWardrobeChannel(ctx, channel.id);

  try {
    await postOrEdit(ctx.db, i.client, channel.id, WARDROBE_MESSAGE_KEY,
      [buildWardrobePanel()], wardrobeRows());
    await i.editReply({
      embeds: [embed(COLORS.good, 'Skins panel posted',
        `It is in <#${channel.id}>.

Players see only what they own. Grant ` +
        'skins with `/admin skin grant`, which hands out a saved preset — so ' +
        'build the look first with `/admin skin save`.')],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post there',
        `${describeError(err)}

Check the bot can **View Channel**, ` +
        '**Send Messages** and **Embed Links** there.')],
    });
  }
}

// ---------------------------------------------------------------- peaks --

async function handlePeaks(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'off') {
    setPeaksChannel(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.good, 'Peak panels stopped',
        'They stop updating. The messages stay where they are — delete them ' +
        'yourself if you want them gone.\n\nReadings keep being recorded either ' +
        'way, so turning them back on shows the history rather than starting ' +
        'again from nothing.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = i.options.getChannel('channel', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  setPeaksChannel(ctx, channel.id);

  const now = new Date();
  const dayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  const weekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

  try {
    await postPeak(ctx, i.client, channel.id, 'day', dayAgo, 24, now);
    await postPeak(ctx, i.client, channel.id, 'week', weekAgo, 7, now);

    const readings = ctx.db.countsSince(weekAgo).length;
    await i.editReply({
      embeds: [embed(COLORS.good, 'Peak panels posted',
        `Both are in <#${channel.id}>, refreshing every **${REFRESH_MINUTES} ` +
        'minutes**.\n\n' +
        (readings === 0
          ? 'There is no history yet — recording only started with this build, ' +
            'so both will say so until the bot has watched for a few hours.'
          : `Built from **${readings}** readings so far.`))],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post there',
        `${describeError(err)}\n\nCheck the bot can **View Channel**, ` +
        '**Send Messages** and **Embed Links** there.')],
    });
  }
}

// -------------------------------------------------------------- heatmap --

/**
 * Reads where the admin is standing right now and treats it as a fixed point
 * on the map picture.
 *
 * Two of these settle the whole map. It replaces guessing the extent of the
 * world, which is what put a lone player in the bottom-left corner and printed
 * coordinates that matched nothing on anybody's screen.
 */
async function handleCalibrate(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
): Promise<void> {
  const id = i.options.getString('landmark', true);
  const mark = landmarkById(id);
  if (!mark) {
    await i.reply({
      embeds: [embed(COLORS.bad, 'Unknown landmark', 'Pick one from the list.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const link = ctx.db.linkFor(i.user.id);
  if (!link) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Link your account first',
        'The bot reads the position of your live dinosaur, so it needs to know ' +
        'which account is yours.')],
    });
    return;
  }

  const players = await ctx.mod.players().catch(() => [] as PlayerRow[]);
  const me = players.find((p) => p.steam === link.steamId);

  if (!me || me.x === undefined || me.y === undefined) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Cannot see where you are',
        me
          ? 'You are online, but the mod did not report a position. Give it a ' +
            'few seconds and try again.'
          : 'You do not look like you are in game right now. Join the server, ' +
            `${mark.hint.charAt(0).toLowerCase()}${mark.hint.slice(1)} then run this again.`)],
    });
    return;
  }

  const { bounds, exact, needed } = applyReading(ctx, { id, x: me.x, y: me.y });
  const hud = (v: number) => Math.round(v / 1000);

  if (!bounds) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not use that reading',
        `You read as Lat **${hud(me.y)}**, Long **${hud(me.x)}**, but that ` +
        'settled nothing. Run `/setup heatmap recalibrate` and start again.')],
    });
    return;
  }

  // Where this reading lands on the picture, so standing in the wrong place is
  // obvious now rather than after wondering why everybody draws in the sea.
  const drawn = `\n\n*Everything is now placed as though you were standing at ` +
    `${Math.round((mark.fx ?? 0.5) * 100)}% across and ` +
    `${Math.round((mark.fy ?? 0.5) * 100)}% down the map picture. If that is ` +
    'not where you actually were, run this again from the right spot.*';

  if (!exact) {
    await i.editReply({
      embeds: [embed(COLORS.good, `Pinned: ${mark.label}`,
        `You read as Lat **${hud(me.y)}**, Long **${hud(me.x)}**.\n\n` +
        `**${mark.label} will now draw in the right place** from the next ` +
        'refresh. How wide the picture is remains a guess, though, so places ' +
        'far from here are still off.' + drawn + '\n\nOne more reading measures ' +
        'it properly. ' +
        'A coastal tip only settles the axis it sits on — standing at the ' +
        'northern point says everything about how far north the picture reaches ' +
        'and nothing about east to west.\n\n**Next, any of:**\n' +
        needed.map((l) => `• **${l.label}** — ${l.hint}`).join('\n'))],
    });
    return;
  }

  await i.editReply({
    embeds: [embed(COLORS.good, 'Map lined up',
      `Recorded **${mark.label}** at Lat **${hud(me.y)}**, Long **${hud(me.x)}**.\n\n` +
      'Both directions are now measured rather than assumed. The picture ' +
      'covers:\n' +
      `• Lat **${hud(bounds.minY)}** to **${hud(bounds.maxY)}** (bottom to top)\n` +
      `• Long **${hud(bounds.minX)}** to **${hud(bounds.maxX)}** (left to right)\n\n` +
      'Dots land in the right place from the next refresh, and the panel will ' +
      'no longer drift these to follow where people walk.\n\n' +
      'Calibrating more landmarks tightens it — every reading is averaged in.')],
  });
}

/**
 * What the panel is actually working from.
 *
 * Written after a long round of guessing at state that could not be read: the
 * bot runs on a host, its database is not to hand, and "the dot went the wrong
 * way" is not enough to tell a bad calibration from a bad mapping. This turns
 * that into one command.
 */
async function handleHeatmapCheck(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const stored = storedBounds(ctx);
  const manual = boundsAreManual(ctx);
  const readings = storedReadings(ctx);
  const inUse = effectiveBounds(ctx, stored);
  const hud = (v: number) => Math.round(v / 1000);

  const players = await ctx.mod.players().catch(() => [] as PlayerRow[]);
  const points = pointsFrom(players);

  const where = points.length === 0
    ? '_Nobody is in game, so there is nothing to place._'
    : points.map((p) => {
      const { px, py } = toPixel(p, inUse, 1000);
      return `• Lat \`${hud(p.y)}\` Long \`${hud(p.x)}\` → **${(px / 10).toFixed(0)}%** ` +
        `across, **${(py / 10).toFixed(0)}%** down`;
    }).join('\n');

  // Self-test. Both anchors are places somebody stood and read the HUD, so each
  // must draw exactly where it sits in the picture. A mismatch means the running
  // build is not the one that solved the map — a deploy that did not take. That
  // is invisible in a screenshot, and guessing at it from one wasted hours.
  // Tested against the bounds the panel actually draws with, not the built-in
  // ones. Checking DEFAULT_BOUNDS was useless: it reported healthy while the
  // panel drew from inverted stored bounds, which is precisely the fault it
  // existed to catch.
  const offBy = (a: typeof ANCHORS[number]): number => {
    const { px, py } = toPixel({ x: a.x, y: a.y }, inUse, 1000);
    return Math.max(Math.abs((px / 1000) - a.fx), Math.abs((py / 1000) - a.fy));
  };

  const selfTest = ANCHORS.map((a) => {
    const { px, py } = toPixel({ x: a.x, y: a.y }, inUse, 1000);
    return `${offBy(a) < 0.01 ? '✅' : '❌'} **${a.label}** draws at ` +
      `${(px / 10).toFixed(0)}% across, ${(py / 10).toFixed(0)}% down — ` +
      `should be ${(a.fx * 100).toFixed(0)}%, ${(a.fy * 100).toFixed(0)}%`;
  }).join('\n');

  const healthy = ANCHORS.every((a) => offBy(a) < 0.01);

  await i.editReply({
    embeds: [embed(healthy ? COLORS.good : COLORS.bad, 'Heatmap check',
      `**Does this build draw the map correctly?**\n${selfTest}\n` +
      (healthy ? '' :
        '\n⚠️ **This bot is not running the build that solved the map.** Its own '
        + 'landmarks do not land on themselves, so nothing below is worth '
        + 'reading. Pull the latest commit and restart.\n') +
      `\n**Bounds in use** ${manual ? '(calibrated)' : '(built in — nothing calibrated)'}\n` +
      `• Lat \`${hud(inUse.minY)}\` to \`${hud(inUse.maxY)}\`\n` +
      `• Long \`${hud(inUse.minX)}\` to \`${hud(inUse.maxX)}\`\n\n` +
      `**Landmark readings held:** ${readings.length}` +
      (readings.length > 0
        ? `\n${readings.map((r) => {
          const mark = landmarkById(r.id);
          return `• ${mark?.label ?? r.id} — recorded at Lat \`${hud(r.y)}\` ` +
            `Long \`${hud(r.x)}\``;
        }).join('\n')}`
        : '') +
      `\n\n**Where that puts people right now**\n${where}\n\n` +
      'Compare those percentages with where you actually are on the picture. ' +
      'If they are wrong, `/setup heatmap recalibrate` drops everything above ' +
      'and goes back to the default.')],
  });
}

async function handleHeatmap(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'calibrate') {
    await handleCalibrate(ctx, i);
    return;
  }

  if (action === 'check') {
    await handleHeatmapCheck(ctx, i);
    return;
  }

  if (action === 'every') {
    const minutes = i.options.getInteger('minutes', true);
    setHeatmapMinutes(ctx, minutes);
    await i.reply({
      embeds: [embed(COLORS.good, 'Heatmap interval set',
        `It refreshes every **${minutes} minutes**.\n\n` +
        'It edits one pinned message rather than posting a new one, so a short ' +
        'interval clutters nothing - it only spends Discord rate limit.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'off') {
    setHeatmapChannel(ctx, null);
    await i.reply({
      embeds: [embed(COLORS.good, 'Heatmap off',
        'It will stop refreshing. The last message stays where it is - delete ' +
        'it yourself if you want it gone.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'image') {
    const url = i.options.getString('url')?.trim() ?? '';
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    setHeatmapImage(ctx, url);

    if (!url) {
      // Blank does not mean "no picture" — it means "look in the usual place",
      // which is the whole point of being able to just drop a file in.
      const found = await resolveMapImage(ctx);
      await i.editReply({
        embeds: [found
          ? embed(COLORS.good, 'Map picture found',
            `It reads fine — **${sniffFormat(found)}**, ${Math.round(found.length / 1024)} KB. ` +
            'Replace the file whenever you like; the bot notices and picks the ' +
            'new one up.')
          : embed(COLORS.warn, 'No map picture the bot can read',
            'Nothing configured, and nothing at ' +
            DEFAULT_PATHS.map((f) => `\`${f}\``).join(', ') + '.\n\n' +
            'Upload one there in the PebbleHost file manager and it is picked ' +
            'up automatically. The heat is drawn on a plain grid until then.\n\n' +
            `Readable formats are **${SUPPORTED.join('**, **')}**. A picture saved ` +
            'from a browser is often a **WebP** even when it is named `.png`, ' +
            'and that is read by its bytes rather than its name — so re-save it ' +
            'as a real PNG if it looks right but will not load.')],
      });
      return;
    }

    // Fetched now rather than at the next refresh, so a bad link is somebody
    // else's problem for ten seconds instead of a panel that quietly stops.
    const data = await baseImage(url);
    await i.editReply({
      embeds: [data
        ? embed(COLORS.good, 'Map picture set',
          'The heat will be drawn over it from the next refresh.\n\n' +
          'Line it up with `/setup heatmap bounds` — until then the dots are ' +
          'placed from bounds the bot learned by watching, which will not match ' +
          'a real map.')
        : embed(COLORS.bad, 'Could not use that image',
          'That is neither a file on the host nor an image the bot could ' +
          'download.\n\nA link has to be **direct** to a PNG or JPEG rather ' +
          'than a page containing one. A path is relative to where the bot ' +
          `runs, which is why \`${DEFAULT_PATHS[0]}\` is the easy answer.`)],
    });
    return;
  }

  if (action === 'bounds') {
    const latMin = i.options.getNumber('lat_min', true);
    const latMax = i.options.getNumber('lat_max', true);
    const longMin = i.options.getNumber('long_min', true);
    const longMax = i.options.getNumber('long_max', true);

    if (latMin === latMax || longMin === longMax) {
      await i.reply({
        embeds: [embed(COLORS.warn, 'Those edges are the same',
          'Opposite edges of a map cannot share a coordinate — everything would ' +
          'land on one line.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    setManualBounds(ctx, latMin, latMax, longMin, longMax);
    await i.reply({
      embeds: [embed(COLORS.good, 'Bounds pinned',
        `Bottom **${latMin}** to top **${latMax}** Lat, left **${longMin}** to ` +
        `right **${longMax}** Long.\n\n` +
        'The bot will stop widening them by itself, so the dots stay lined up ' +
        'with the picture. Read the corner values off any interactive Isle map ' +
        'in the same Lat/Long your HUD shows.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'recalibrate') {
    const had = storedBounds(ctx);
    const readings = storedReadings(ctx).length;
    resetBounds(ctx);
    // The landmark readings have to go too. Leaving them meant "start again"
    // silently rebuilt the same wrong bounds from the same wrong readings the
    // next time anybody calibrated.
    clearReadings(ctx);
    await i.reply({
      embeds: [embed(COLORS.good, 'Bounds forgotten',
        (had
          ? `Was Lat \`${(had.minY / 1000).toFixed(0)}\` to \`${(had.maxY / 1000).toFixed(0)}\`, ` +
            `Long \`${(had.minX / 1000).toFixed(0)}\` to \`${(had.maxX / 1000).toFixed(0)}\`.\n\n`
          : 'Nothing had been learned yet.\n\n') +
        (readings > 0
          ? `**${readings} landmark reading${readings === 1 ? '' : 's'} cleared** as well, ` +
            'so calibrating starts from nothing.\n\n'
          : '') +
        'The panel learns the map from where people actually go, and only ever ' +
        'widens. Reset it if something once put a player somewhere impossible ' +
        'and stretched the grid.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = i.options.getChannel('channel', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  setHeatmapChannel(ctx, channel.id);

  try {
    const points = pointsFrom(await ctx.mod.players().catch(() => []));
    const bounds = widen(storedBounds(ctx), points);
    if (bounds) saveBounds(ctx, bounds);

    await postOrEdit(ctx.db, i.client, channel.id, HEATMAP_MESSAGE_KEY,
      [buildHeatmapEmbed(points, bounds, { minutes: heatmapMinutes(ctx) })]);

    await i.editReply({
      embeds: [embed(COLORS.good, 'Heatmap is live',
        `It is in <#${channel.id}>, refreshing every **${heatmapMinutes(ctx)} minutes**.\n\n` +
        (bounds
          ? 'It learns the shape of the map from where people go, so it will ' +
            'look rough tonight and settle over a few busy evenings.'
          : 'Nobody is on right now, so it has nothing to learn from yet. It ' +
            'will fill in once people are playing.'))],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post there',
        `${describeError(err)}\n\nCheck the bot can **View Channel**, ` +
        '**Send Messages** and **Embed Links** there.')],
    });
  }
}

// --------------------------------------------------------------- backup --

async function handleBackup(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = backupConfig(ctx.config);
  if (!cfg) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'No backup database configured',
        'Set `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD` and `MYSQL_DATABASE` ' +
        'in the environment, from the database PebbleHost gives you.\n\n' +
        'Until then everything the bot knows lives in one file on the game ' +
        'host, with no copy anywhere.')],
    });
    return;
  }

  try {
    if (action === 'now') {
      const result = await runBackup(ctx, cfg);
      markBackup(ctx, result.takenAt);
      await i.editReply({
        embeds: [embed(COLORS.good, 'Snapshot taken',
          `**${result.rows}** rows across **${result.tables}** tables.\n\n` +
          `<t:${Math.floor(result.takenAt / 1000)}:F>`)],
      });
      return;
    }

    if (action === 'list') {
      const snapshots = await listSnapshots(cfg);
      await i.editReply({
        embeds: [embed(COLORS.info, 'Snapshots',
          snapshots.length === 0
            ? 'None yet. `/admin backup now` takes one.'
            : snapshots.map((snap) =>
              `\`${snap.takenAt}\` — <t:${Math.floor(snap.takenAt / 1000)}:R> · ` +
              `${snap.rows} rows, ${snap.tables} tables`).join('\n') +
              '\n\nThe code in backticks is what `/admin backup restore` wants.')],
      });
      return;
    }

    if (action === 'restore') {
      const snapshot = Number.parseInt(i.options.getString('snapshot', true).trim(), 10);
      const confirm = i.options.getString('confirm', true).trim();

      if (confirm !== 'REPLACE') {
        await i.editReply({
          embeds: [embed(COLORS.warn, 'Not confirmed',
            'This **replaces every table** with the snapshot, and anything that ' +
            'happened since is lost — points earned, links made, purchases.\n\n' +
            'Type `REPLACE` in the confirm option if that is what you want.')],
        });
        return;
      }

      const result = await restoreSnapshot(ctx, cfg, snapshot);
      await i.editReply({
        embeds: [embed(COLORS.good, 'Restored',
          `**${result.rows}** rows across **${result.tables}** tables, from ` +
          `<t:${Math.floor(snapshot / 1000)}:F>.\n\n` +
          '⚠️ Restart the bot. Anything it was holding in memory is now out of ' +
          'step with what is on disk.')],
      });
      return;
    }

    const last = lastBackup(ctx);
    const snapshots = await listSnapshots(cfg);
    await i.editReply({
      embeds: [embed(COLORS.info, 'Backups',
        `Backing up to \`${cfg.database}\` on \`${cfg.host}\`.\n\n` +
        (last === 0
          ? '**Never run.** `/admin backup now` takes the first one.'
          : `Last snapshot <t:${Math.floor(last / 1000)}:R>.`) +
        `\n\n**${snapshots.length}** held, newest first. One is taken daily, and ` +
        'the oldest are dropped once there are more than fourteen.')],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Backup failed', `${describeError(err)}\n\n` +
        'Check the MySQL details, and that PebbleHost allows connections from ' +
        'the bot.')],
    });
  }
}

// ------------------------------------------------------------- bounties --

async function handleBounties(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'on' || action === 'off') {
    setBountiesEnabled(ctx, action === 'on');
    const settings = bountySettings(ctx);
    await i.reply({
      embeds: [action === 'on'
        ? embed(COLORS.good, 'Bounties on',
          'A species over its cap now gets a bounty posted on it automatically: ' +
          `**${settings.base}** points a kill, scaled by tier, with a limited ` +
          'number of payouts.\n\n' +
          'They show on the population panel, are announced in game, and come ' +
          'down when the population drops or the payouts run out.\n\n' +
          'Never posted on an endangered species — paying for kills on the last ' +
          'few of something would finish them off.')
        : embed(COLORS.good, 'Bounties off',
          'Nothing new will be posted. Anything already on the board stays until ' +
          'it is claimed — use `/admin bounties clear` to take it down now.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'reward') {
    const points = i.options.getInteger('points', true);
    setBountyBase(ctx, points);
    await i.reply({
      embeds: [embed(COLORS.good, 'Bounty reward set',
        `**${points}** points a kill, before the tier multiplier — so an apex is ` +
        'worth roughly twice a tier 1.\n\n' +
        'Only affects bounties posted from now on.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'clear') {
    const had = activeBounties(ctx).length;
    ctx.db.setSetting('bounties_active', '[]');
    await i.reply({
      embeds: [embed(COLORS.good, 'Board cleared',
        had === 0 ? 'There were none up.' : `Took down **${had}**.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const settings = bountySettings(ctx);
  const live = activeBounties(ctx);
  await i.reply({
    embeds: [embed(COLORS.info, '💰  Bounties',
      (settings.enabled ? '**On.**' : '**Off.**') +
      ` Base reward ${settings.base} points a kill.\n\n` +
      (live.length === 0
        ? 'Nothing on the board. One goes up when a species passes its cap.'
        : bountyLines(live)) +
      (ctx.db.speciesCaps().length === 0
        ? '\n\n⚠️ No species caps are set, so nothing can ever trigger.'
        : ''))],
    flags: MessageFlags.Ephemeral,
  });
}

// ------------------------------------------------------------- founders --

async function handleFounders(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'role') {
    const role = i.options.getRole('role', true);
    setEarlyRole(ctx, role.id);

    const me = i.guild?.members.me;
    const problems: string[] = [];
    if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      problems.push('the bot does not have **Manage Roles**');
    }
    if (me && 'comparePositionTo' in role && me.roles.highest.comparePositionTo(role) <= 0) {
      problems.push(`the bot's own role sits **below** ${role}, so it cannot hand it out`);
    }

    const held = i.guild ? holders(i.guild, role.id) : 0;
    await i.reply({
      embeds: [problems.length
        ? embed(COLORS.warn, 'Set, but it will not work yet',
            `New members are meant to get ${role}, but ${problems.join(', and ')}.`)
        : embed(COLORS.good, 'Early Member role set',
            `${role} is given automatically to anyone who joins, until ` +
            `**${founderLimit(ctx)}** people hold it. **${held}** do now.\n\n` +
            'Anyone with it can wear all three skins, and can change between ' +
            'them freely. Take the role away and they lose them.\n\n' +
            'Run `/setup founders backfill` to give it to people who are ' +
            'already here.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'backfill') {
    if (!i.guild) return;
    if (!earlyRole(ctx)) {
      await i.reply({
        embeds: [embed(COLORS.warn, 'No role chosen',
          'Pick one with `/setup founders role` first.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Fetching every member and adding roles one at a time is slow enough to
    // blow the three second interaction window on any real server.
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await backfillEarlyRole(ctx, i.guild, founderLimit(ctx), () => undefined);

    await i.editReply({
      embeds: [embed(COLORS.good, 'Backfill done',
        `**${result.given}** given the role, **${result.already}** already had it.` +
        (result.skipped > 0 ? ` **${result.skipped}** could not be given it.` : '') +
        (result.unqualified > 0
          ? ` **${result.unqualified}** have not played **${earlyMinutes(ctx)} minutes** yet.`
          : '') +
        '\n\nMost played first, and nobody who already had it lost it. From now ' +
        'on the role is given the moment somebody reaches the time while ' +
        'playing, so the remaining seats go first-come-first-served.' +
        (result.full ? `\n\n⚠️ The cap of **${founderLimit(ctx)}** is now full.` : ''))],
    });
    return;
  }

  if (action === 'playtime') {
    const minutes = i.options.getInteger('minutes', true);
    setEarlyMinutes(ctx, minutes);
    await i.reply({
      embeds: [embed(COLORS.good, 'Playtime set',
        minutes > 0
          ? `Early Member now takes **${minutes} minutes** on the server.\n\n` +
            'Counted from the same playtime the points system already tracks, so ' +
            'there is no second clock to disagree with the first. Nobody who ' +
            'already has the role loses it.'
          : 'Early Member is now given to anyone linked, with no playtime needed.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'limit') {
    const count = i.options.getInteger('count', true);
    setFounderLimit(ctx, count);
    await i.reply({
      embeds: [embed(COLORS.good, 'Founder limit set',
        `The first **${count}** people can claim a founder skin. ` +
        `**${ctx.db.founderCount()}** already have.\n\n` +
        'Lowering it below the number already claimed takes nothing away — ' +
        'it just means nobody new can claim.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'list') {
    const claimed = ctx.db.founders(25);
    await i.reply({
      embeds: [embed(COLORS.info, 'Founders',
        `**${ctx.db.founderCount()}** of ${founderLimit(ctx)} claimed.\n\n` +
        (claimed.length === 0
          ? 'Nobody yet.'
          : claimed.map((f, n) =>
            `${n + 1}. <@${f.discordId}> — **${skinById(f.skin)?.name ?? f.skin}**`).join('\n')) +
        (ctx.db.founderCount() > claimed.length
          ? `\n\n…and ${ctx.db.founderCount() - claimed.length} more.`
          : ''))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'release') {
    const user = i.options.getUser('user', true);
    const freed = ctx.db.releaseFounder(user.id);
    await i.reply({
      embeds: [freed
        ? embed(COLORS.good, 'Claim released',
          `${user} can claim again, and a slot has opened up.`)
        : embed(COLORS.quiet, 'Nothing to release', `${user} has not claimed one.`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channel = i.options.getChannel('channel', true);
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  setFounderChannel(ctx, channel.id);

  try {
    await postOrEdit(ctx.db, i.client, channel.id, FOUNDER_MESSAGE_KEY,
      [buildFounderPanel(ctx)], founderRows(ctx));
    await i.editReply({
      embeds: [embed(COLORS.good, 'Founder panel is live',
        `It is in <#${channel.id}>.\n\n` +
        `**${founderLimit(ctx) - ctx.db.founderCount()}** claims left. The buttons ` +
        'keep working after a restart, so it can stay pinned.')],
    });
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not post there',
        `${describeError(err)}\n\nCheck the bot can **View Channel**, ` +
        '**Send Messages** and **Embed Links** there.')],
    });
  }
}

// --------------------------------------------------------------- events --

async function handleEvents(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'on' || action === 'off') {
    setEventsEnabled(ctx, action === 'on');
    const settings = eventSettings(ctx);
    await i.reply({
      embeds: [action === 'on'
        ? embed(COLORS.good, 'Population events on',
          'The island now reacts to its own imbalance:\n\n' +
          `🩸 **Cull** — a species at or over its cap pays **${settings.cullBonus}x** ` +
          'to whoever kills one.\n' +
          `🛡️ **Endangered** — a species down to its last few pays **${settings.rareBonus}x** ` +
          'to whoever is playing one and staying alive.\n\n' +
          'Both are announced in game and in the species channel. Only species ' +
          'with a cap take part — without one there is no notion of too many.')
        : embed(COLORS.good, 'Population events off',
          'Points go back to tier rates alone. Anything running has stopped.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'minplayers') {
    const players = i.options.getInteger('players', true);
    setMinPlayersForRare(ctx, players);
    await i.reply({
      embeds: [embed(COLORS.good, 'Endangered threshold set',
        `A species only counts as endangered once **${players}** people are on ` +
        'the server.\n\n' +
        'On a quiet server every species is technically down to its last few, so ' +
        'without this the person playing alone was permanently endangered. ' +
        'Scarcity only means something when there is a population to be scarce ' +
        'within.\n\nCull events are unaffected: being over a cap already ' +
        'implies the players are there.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (action === 'bonus') {
    const cull = i.options.getNumber('cull');
    const rare = i.options.getNumber('endangered');

    if (cull === null && rare === null) {
      await i.reply({
        embeds: [embed(COLORS.warn, 'Nothing to change',
          'Give a `cull` multiplier, an `endangered` one, or both.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (cull !== null) setCullBonus(ctx, cull);
    if (rare !== null) setRareBonus(ctx, rare);
    const settings = eventSettings(ctx);

    await i.reply({
      embeds: [embed(COLORS.good, 'Event bonuses set',
        `🩸 Cull kills pay **${settings.cullBonus}x**\n` +
        `🛡️ Endangered play pays **${settings.rareBonus}x**\n\n` +
        'These multiply on top of tier, so an apex in a cull event is already ' +
        'worth a great deal.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // status
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const settings = eventSettings(ctx);
  const caps = ctx.db.speciesCaps();

  let live: string;
  try {
    const counts = new Map<string, number>();
    for (const row of tally(await ctx.mod.players())) counts.set(row.species, row.online);
    const online = (await ctx.mod.players()).filter((p) => p.steam).length;
    const running = eventsFor(caps, counts, online, minPlayersForRare(ctx));
    live = running.length === 0
      ? 'Nothing running right now.'
      : running.map((e) => e.kind === 'cull'
        ? `🩸 **${e.species}** — ${e.count}/${e.cap}, kills pay ${settings.cullBonus}x`
        : `🛡️ **${e.species}** — only ${e.count} left, playing pays ${settings.rareBonus}x`)
        .join('\n');
  } catch (err) {
    live = `Could not read the server: ${describeError(err)}`;
  }

  await i.editReply({
    embeds: [embed(COLORS.info, 'Population events',
      (settings.enabled ? '**On.**' : '**Off.**') +
      ` Cull pays ${settings.cullBonus}x, endangered pays ${settings.rareBonus}x.\n\n` +
      live +
      (caps.length === 0
        ? '\n\n⚠️ No species caps are set, so nothing can ever trigger. ' +
          '`/admin species preset` sets a whole table.'
        : ''))],
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
  if (group === 'shop') return handleShopAdmin(ctx, i, action);

  if (group === 'joinrole') {
    if (action === 'off') {
      setJoinRole(ctx, null);
      await i.reply({
        embeds: [embed(COLORS.good, 'Join role off',
          'New members will not be given a role. Anyone who already has it keeps it.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = i.options.getRole('role', true);
    setJoinRole(ctx, role.id);

    // Checked now rather than discovered when somebody joins at 2am.
    const me = i.guild?.members.me;
    const problems: string[] = [];
    if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      problems.push('the bot does not have **Manage Roles**');
    }
    if (me && 'comparePositionTo' in role && me.roles.highest.comparePositionTo(role) <= 0) {
      problems.push(`the bot's own role sits **below** ${role}, so it cannot hand it out`);
    }

    await i.reply({
      embeds: [problems.length
        ? embed(COLORS.warn, 'Set, but it will not work yet',
            `New members are meant to get ${role}, but ${problems.join(', and ')}.\n\n` +
            'Fix that in Server Settings → Roles and it starts working immediately.')
        : embed(COLORS.good, 'Join role set',
            `Everyone who joins now gets ${role}.\n\n` +
            'Bots are skipped — they get their roles from their own integration.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (group === 'restartrole') {
    if (action === 'off') {
      setRestartAlertRole(ctx, null);
      await i.reply({
        embeds: [embed(COLORS.good, 'Restart alerts off',
          'The button now tells people it is not set up. Anyone already holding '
          + 'the role keeps it — this only stops the button handing it out.')],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const role = i.options.getRole('role', true);
    setRestartAlertRole(ctx, role.id);

    // Checked now rather than discovered by the first player who presses it.
    const me = i.guild?.members.me;
    const problems: string[] = [];
    if (me && !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      problems.push('the bot does not have **Manage Roles**');
    }
    if (me && 'comparePositionTo' in role && me.roles.highest.comparePositionTo(role) <= 0) {
      problems.push(`the bot's own role sits **below** ${role}, so it cannot hand it out`);
    }

    await i.reply({
      embeds: [problems.length
        ? embed(COLORS.warn, 'Set, but it will not work yet',
            `The button is meant to hand out ${role}, but ${problems.join(', and ')}.

`
            + 'Fix that in Server Settings → Roles and it starts working immediately.')
        : embed(COLORS.good, 'Restart alert role set',
            `**🔔 Restart alerts** on the panel now gives and takes ${role}.

`
            + 'One button does both, so press it again to opt out. Mention the '
            + 'role in your restart warnings for it to reach anybody.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (group === 'skin') return handleSkin(ctx, i, action);
  if (group === 'tier') return handleTiers(ctx, i, action);
  if (group === 'cleanup') return handleCleanup(ctx, i, action);
  if (group === 'species') return handleSpecies(ctx, i, action);
  if (group === 'mod') return handleModeration(ctx, i, action);
  if (group === 'ingame') return handleInGame(ctx, i, action);
  if (group === 'founders') return handleFounders(ctx, i, action);
  if (group === 'events') return handleEvents(ctx, i, action);
  if (group === 'bounties') return handleBounties(ctx, i, action);
  if (group === 'backup') return handleBackup(ctx, i, action);
  if (group === 'hunt') return handleHunt(ctx, i, action);
  if (group === 'contest') return handleContest(ctx, i, action);
  if (group === 'nest') return handleNest(ctx, i, action);
  if (group === 'prime') return handlePrimeDebug(ctx, i);
  if (group === 'referrals') return handleReferrals(ctx, i, action);
  if (group === 'wardrobe') return handleWardrobePanel(ctx, i, action);
  if (group === 'market') return handleMarketPanel(ctx, i, action);
  if (group === 'nesting') return handleNesting(ctx, i, action);
  if (group === 'peaks') return handlePeaks(ctx, i, action);
  if (group === 'heatmap') return handleHeatmap(ctx, i, action);

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

  if (action === 'now') {
    const minutes = i.options.getInteger('minutes') ?? 2;
    await i.deferReply({ flags: MessageFlags.Ephemeral });

    if (!ctx.panel) {
      await i.editReply({
        embeds: [embed(COLORS.warn, 'No control panel',
          'The bot cannot restart the server without one. Set `PANEL_URL`, ' +
          '`PANEL_API_KEY` and `PANEL_SERVER_ID`.')],
      });
      return;
    }

    await i.editReply({
      embeds: [embed(COLORS.good, minutes > 0 ? 'Restart scheduled' : 'Restarting now',
        minutes > 0
          ? `${SERVER} restarts in **${minutes} minute${minutes === 1 ? '' : 's'}**. ` +
            'Players have been told in game, and again at one minute.\n\n' +
            'The world is saved first.'
          : `${SERVER} is being saved and restarted right now.`)],
    });

    // Not awaited: the countdown outlives the interaction token.
    void restartNow(ctx, minutes, (m) => console.log(`${new Date().toISOString()} ${m}`))
      .catch(() => undefined);
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
  const { message: key, label } = referenceKeys(which);

  try {
    await postOrEdit(ctx.db, i.client, channel.id, key, [panel]);
    // Remembering where it went is what lets a restart re-render it, so the
    // wording no longer has to be re-posted by hand after every change.
    rememberGuideChannel(ctx, which, channel.id);
    await i.editReply({
      embeds: [embed(COLORS.good, `${label} posted`,
        `It is in <#${channel.id}>.\n\n` +
        'It is rewritten whenever the bot restarts, so it stays accurate on its ' +
        'own. Run this again only to move it.')],
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

  let choices: Array<{ name: string; value: string }>;

  if (focused.name === 'species') {
    // Staff manage species that are deliberately absent from the live menu — a
    // cap of zero removes one — so they get the remembered roster. Everybody
    // else gets what can be spawned right now, since offering a buyer a locked
    // species sells them something they could not then release.
    const staff = i.commandName === 'admin' || i.commandName === 'setup';
    const names = staff ? await knownSpecies(ctx) : await speciesList(ctx);

    choices = suggest(names, focused.value).map((name) => ({ name, value: name }));
  } else if (focused.name === 'preset' || focused.name === 'skin') {
    const typed = focused.value.trim().toLowerCase();

    // Revoking is the one case where the whole catalogue is the wrong list:
    // it can only take back something they already have, so offering every
    // preset invites picking one that was never granted and getting told so.
    const revoking = i.options.getSubcommand(false) === 'revoke';
    // getUser is not available on an autocomplete interaction — the option
    // arrives as the raw snowflake, which is all the lookup needs anyway.
    const subject = revoking ? i.options.get('user')?.value : undefined;
    const link = typeof subject === 'string' ? ctx.db.linkFor(subject) : null;

    if (revoking) {
      const owned = link
        ? ctx.db.ownedSkins(link.steamId)
          .map((o) => o.preset)
          .filter((n) => !typed || n.toLowerCase().includes(typed))
        : [];

      await i.respond(owned.slice(0, 25).map((n) => ({ name: n, value: n })));
      return;
    }

    const saved = new Set(ctx.db.presetNames());

    // Saved first — an admin's own work is what they are usually reaching for —
    // then the built-ins **sorted**. In insertion order everything added after
    // the first two dozen fell past Discord's 25-choice cap and was invisible
    // unless you already knew its name.
    const all = [
      ...[...saved].sort((a, b) => a.localeCompare(b)),
      ...Object.keys(BUILT_IN).filter((n) => !saved.has(n)).sort((a, b) => a.localeCompare(b)),
    ];

    const matches = all.filter((n) => !typed || n.toLowerCase().includes(typed));

    choices = matches
      .slice(0, 25)
      .map((n) => ({ name: saved.has(n) ? n : `${n} · ready made`, value: n }));

    // Say so rather than silently truncating, so nobody concludes a look is
    // missing when it is only further down the alphabet.
    if (matches.length > 25) {
      choices[24] = {
        name: `…and ${matches.length - 24} more — keep typing to narrow it down`,
        value: matches[24] ?? '',
      };
    }
  } else if (focused.name.startsWith('colour')) {
    const typed = focused.value.trim().toLowerCase();
    choices = PRESETS
      .filter((p) => !typed || p.name.toLowerCase().includes(typed) || p.hex.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((p) => ({ name: `${p.name} · ${p.hex}`, value: p.name }));
  } else {
    // Whatever is already picked in the other mutation slots is dropped from
    // the suggestions, so the same one cannot be chosen twice by accident.
    const chosen = new Set(
      [1, 2, 3, 4]
        .map((n) => `mutation${n}`)
        .filter((name) => name !== focused.name)
        .map((name) => i.options.getString(name)?.trim().toLowerCase())
        .filter((v): v is string => Boolean(v)),
    );

    const available = mutationList(ctx).filter((m) => !chosen.has(m.toLowerCase()));
    choices = mutationChoices(available, focused.value);
  }

  await i.respond(choices).catch(() => undefined);
}

/**
 * The mutation slots, deduplicated.
 *
 * The picker already hides what is taken, but the field accepts free text, so
 * the same one can still be typed twice. Returns the repeat rather than
 * silently dropping it: quietly changing what someone asked for is worse when
 * there is a price attached.
 */
export function readMutations(
  i: ChatInputCommandInteraction,
): { mutations: string[]; duplicate: string | null } {
  const mutations: string[] = [];
  const seen = new Set<string>();

  for (const n of [1, 2, 3, 4]) {
    const value = i.options.getString(`mutation${n}`)?.trim();
    if (!value) continue;

    const key = value.toLowerCase();
    if (seen.has(key)) return { mutations, duplicate: value };

    seen.add(key);
    mutations.push(value);
  }

  return { mutations, duplicate: null };
}

export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
