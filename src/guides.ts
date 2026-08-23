import { EmbedBuilder, type Client } from 'discord.js';

import { ARCHIVE_CAP, SERVER, SIGNATURE } from './brand.js';
import { MAX_SLOTS } from './bridge.js';
import type { Ctx } from './commands.js';
import { postOrEdit } from './pinned.js';

/**
 * The two reference embeds that live permanently in a channel: how storage
 * works, and what Vesta can do.
 *
 * Both are written to be read by someone who has never used the bot, in the
 * order they will need it — verify, then store, then get it back. The awkward
 * parts (your dinosaur dies; you must be fully grown) are stated early rather
 * than buried, because finding them out by surprise costs someone a dinosaur.
 *
 * **Buttons first, commands second.** Everything here is reachable from the
 * panel, and that is how most people will actually use it — a guide that opens
 * with slash commands describes a bot nobody is running any more. The commands
 * still work and are still listed, because they are faster once you know them.
 *
 * The vault count comes from `MAX_SLOTS` rather than the word "three", so it
 * cannot quietly disagree with the panel that enforces it.
 */

const ACCENT = 0x5865f2;

/**
 * Small numbers as words, because "You get 3 vaults" reads like a system
 * message and "three vaults" reads like a sentence. Falls back to the digit,
 * so raising the cap can never produce "You get eleven vaults" by accident.
 */
function spell(n: number): string {
  return ['zero', 'one', 'two', 'three', 'four', 'five'][n] ?? String(n);
}

export function buildStorageGuideEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`🏛️  The ${SERVER} Archive`)
    .setDescription(
      `${ARCHIVE_CAP} holds your dinosaurs while you are away. Put one in, come ` +
      'back another day, and it returns exactly as you left it — growth, ' +
      'condition, mutations and all.\n\n' +
      `**You get ${spell(MAX_SLOTS)} vaults.** Nothing else about your dinosaur is changed.\n` +
      `💡 It all runs from the **${SERVER} Panel** — the buttons below do the same ` +
      'as the commands, so you never have to remember one.',
    )
    .addFields(
      {
        name: '1️⃣  Verify your account — once, ever',
        value:
          'Press **✅ Verify** on the panel, paste your **Steam64 ID** into the ' +
          'box, then type the code it gives you in **game chat** while you are ' +
          'in game.\n' +
          'Typing it in game is what proves the account is yours. `/link` opens ' +
          'the same box.',
      },
      {
        name: '2️⃣  Store a dinosaur',
        value:
          'Press **🏛️ Archive**, then **Store**, and give it a name you will ' +
          'recognise.\n' +
          '⚠️ **Your dinosaur dies when you store it.** That is how it leaves the ' +
          'world — it is the mechanism, not a bug. It is shrunk first, so nobody ' +
          'gets a free meal from the body.',
      },
      {
        name: '3️⃣  Get it back',
        value:
          'Press **🏛️ Archive**, pick a vault, press **Release**.\n' +
          'You must be playing the **same species** — spawn as one, then release. ' +
          'Your new dinosaur becomes the one you stored.',
      },
      {
        name: '📏  The rules',
        value:
          '• Only **fully grown** dinosaurs can be stored\n' +
          `• **${spell(MAX_SLOTS)} vaults** per player\n` +
          '• Releasing **empties** that vault\n' +
          '• Same species to release\n' +
          '• Dinosaurs bought in the shop land in a vault too, so keep one free\n' +
          '• Unlinking keeps everything — it is yours again when you verify again',
      },
      {
        name: '❓  If something goes wrong',
        value:
          'The panel tells you why. The usual answers are *not fully grown*, ' +
          '*every vault full*, *not verified yet*, or *the server is restarting* ' +
          '— wait and try again. Nothing is destroyed by a failed store: if it ' +
          'cannot be saved, it is not killed.',
      },
    )
    .setFooter({ text: SIGNATURE });
}

/**
 * Commands a **player** can use.
 *
 * Staff commands are deliberately absent: this embed is pinned in a public
 * channel, and advertising `/admin` to everyone invites people to try it and
 * then ask why it was refused. Staff already know what they have.
 */
/**
 * Never shown in the player-facing command panel.
 *
 * `/setup` is here for the same reason as `/admin`: it only exists because
 * Discord caps a command at 25 subcommand groups and /admin outgrew it, so it
 * is staff-only despite the friendlier name.
 */
export const STAFF_COMMANDS = new Set(['admin', 'setup']);

export function buildCommandsEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('📖  Vesta’s commands')
    .setDescription(
      `Everything ${SERVER} answers to. All replies are private — only you see ` +
      'them.\n\n' +
      `💡 **You do not need any of these.** The ${SERVER} Panel and the shop ` +
      'panel reach the same things with buttons. Commands are just quicker once ' +
      'you know them.',
    )
    .addFields(
      {
        name: '🦕  The panel',
        value:
          '**Archive** — store, release, rename, discard\n' +
          '**In-game actions** — archive, travel to a friend, slay\n' +
          '**Stats** — population, points, kills\n' +
          '**Verify** — link your Steam account',
      },
      {
        name: '🏛️  `/storage`',
        value:
          'Open your archive. Store, release, rename and discard, all from buttons.\n' +
          'Updates itself while it is open, so it never shows you a stale vault.',
      },
      {
        name: '🔗  `/link`',
        value:
          'Connect your Steam account — opens a box to paste your Steam64 ID into.\n' +
          'Needed once, before anything that touches your dinosaur works. The ' +
          '**Verify** button does the same thing.',
      },
      {
        name: '🚪  `/unlink`',
        value: 'Disconnect. Anything stored stays yours and returns if you link again.',
      },
      {
        name: '💀  `/slay`',
        value:
          'Kill your own dinosaur. Nothing is kept — use `/storage` if you want it back later.\n' +
          'It only ever targets **you**, and there is a wait between slays so it ' +
          'cannot be used to reroll your spawn.',
      },
      {
        name: '🎽  Your skins',
        value:
          'Skins you win at events are yours for good. The skins panel lets you '
          + 'wear any of them, swap whenever you like, and reset back to your '
          + 'dinosaur’s own colours without relogging.',
      },
      {
        name: '👑  `/prime`',
        value:
          'What you still need before your dinosaur can go Prime, read off the '
          + 'one you are playing right now.\n'
          + 'You need **5 of the 10** conditions — **4** on a small species — and '
          + 'every one of them before **75% growth**.',
      },
      {
        name: '🦕  `/population`',
        value:
          `What is roaming ${SERVER} right now: species, adults, gender split and ` +
          'prime. Names nobody.',
      },
      {
        name: '🧭  `/teleport`',
        value:
          'Ask a friend if you can travel to them. They must agree — with a button ' +
          'or by typing `!accept` in game — and you arrive a short while after, not ' +
          'instantly. There is a wait between travels.',
      },
      {
        name: '🛒  `/shop`',
        value:
          '`/shop browse` for what is for sale, `/shop buy` to spend your points — ' +
          'or use the shop panel, which has the same three buttons.\n' +
          'You get a **fully grown** dinosaur in your archive — collect it by ' +
          'spawning that species and pressing **Release**. Uses a vault, and ' +
          'purchases are not refundable.\n' +
          '🚫 **Apexes are not sold.** Grow those yourself.',
      },
      {
        name: '🪙  `/points`',
        value:
          '`/points balance` for what you have earned, `/points top` for the ' +
          'leaderboard.\n' +
          'Higher tiers earn faster, and kills pay too. Spend them in `/shop`.',
      },
      {
        name: '💰  Bounties',
        value:
          'When a species outgrows the island, a bounty is posted on it — points ' +
          'per kill, for as many payouts as are on offer.\n' +
          'Nothing to sign up for: kill the species while it is posted and you ' +
          'are paid.',
      },
      {
        name: '⚔️  `/kills`',
        value:
          '`/kills top` for the deadliest players, `/kills me` for your own record.\n' +
          'Only direct attacks count — bleeding out, starving and AI show as ' +
          'deaths with nobody credited.',
      },
      {
        name: '💬  In game',
        value:
          '`!discord` — Vesta sends you the invite link\n' +
          '`!link CODE` — finishes linking your account\n' +
          '`!accept` — lets a friend travel to you',
      },
    )
    .setFooter({ text: SIGNATURE });
}

/**
 * Which channel each reference embed lives in.
 *
 * Only the message id was kept before, which was enough to edit one but not to
 * find one — so the embeds could only ever be refreshed by an admin re-running
 * the command. Nobody does that after shipping a feature, and both drifted:
 * the command list was still telling players there was nothing to spend points
 * on months after the shop opened.
 */
const PANELS = {
  guide: { channel: 'guide_channel', message: 'guide_message', label: 'Storage guide' },
  commands: { channel: 'commands_channel', message: 'commands_message', label: 'Command list' },
} as const;

export type ReferencePanel = keyof typeof PANELS;

export const referenceKeys = (which: ReferencePanel): typeof PANELS[ReferencePanel] =>
  PANELS[which];

export function rememberGuideChannel(
  ctx: Ctx,
  which: ReferencePanel,
  channelId: string,
): void {
  ctx.db.setSetting(PANELS[which].channel, channelId);
}

const buildFor = (which: ReferencePanel): EmbedBuilder =>
  (which === 'guide' ? buildStorageGuideEmbed() : buildCommandsEmbed());

/**
 * Re-renders both reference embeds wherever they already are.
 *
 * Run at startup, so shipping a change to the wording is enough to update what
 * players actually read. These are static text with no live data, so redrawing
 * them costs two edits per restart and removes the whole class of "the guide
 * says something that stopped being true".
 *
 * A panel nobody has placed yet is skipped rather than posted somewhere
 * arbitrary.
 */
export async function refreshGuides(
  ctx: Ctx,
  client: Client,
  log: (message: string) => void,
): Promise<void> {
  for (const which of Object.keys(PANELS) as ReferencePanel[]) {
    const { channel, message, label } = PANELS[which];
    const channelId = ctx.db.getSetting(channel);
    if (!channelId) continue;

    try {
      await postOrEdit(ctx.db, client, channelId, message, [buildFor(which)]);
      log(`${label} refreshed`);
    } catch (err) {
      // Worth saying out loud but never worth failing startup over: the channel
      // may have been deleted, and the bot has a server to run either way.
      log(`${label} could not be refreshed: ${
        err instanceof Error ? err.message : String(err)}`);
    }
  }
}
