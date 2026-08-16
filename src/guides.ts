import { EmbedBuilder } from 'discord.js';

import { ARCHIVE_CAP, SERVER, SIGNATURE } from './brand.js';

/**
 * The two reference embeds that live permanently in a channel: how storage
 * works, and what Vesta can do.
 *
 * Both are written to be read by someone who has never used the bot, in the
 * order they will need it — link, then store, then get it back. The awkward
 * parts (your dinosaur dies; you must be fully grown) are stated early rather
 * than buried, because finding them out by surprise costs someone a dinosaur.
 */

const ACCENT = 0x5865f2;

export function buildStorageGuideEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle(`🏛️  The ${SERVER} Archive`)
    .setDescription(
      `${ARCHIVE_CAP} holds your dinosaurs while you are away. Put one in, come ` +
      'back another day, and it returns exactly as you left it — growth, ' +
      'condition, mutations and all.\n\n' +
      '**You get three vaults.** Nothing else about your dinosaur is changed.',
    )
    .addFields(
      {
        name: '1️⃣  Link your account — once, ever',
        value:
          'Run `/link` with your Steam64 ID while you are **in game**, then type ' +
          'the code it gives you in **game chat**.\n' +
          'Typing it in game is what proves the account is yours.',
      },
      {
        name: '2️⃣  Store a dinosaur',
        value:
          'Run `/storage`, press **Store**, and give it a name you will recognise.\n' +
          '⚠️ **Your dinosaur dies when you store it.** That is how it leaves the ' +
          'world — it is the mechanism, not a bug. It is shrunk first, so nobody ' +
          'gets a free meal from the body.',
      },
      {
        name: '3️⃣  Get it back',
        value:
          'Run `/storage`, pick a vault, press **Release**.\n' +
          'You must be playing the **same species** — spawn as one, then release. ' +
          'Your new dinosaur becomes the one you stored.',
      },
      {
        name: '📏  The rules',
        value:
          '• Only **fully grown** dinosaurs can be stored\n' +
          '• **Three vaults** per player\n' +
          '• Releasing **empties** that vault\n' +
          '• Same species to release\n' +
          '• Unlinking keeps everything — it is yours again when you link back',
      },
      {
        name: '❓  If something goes wrong',
        value:
          'The panel tells you why. The usual answers are *not fully grown*, ' +
          '*all three vaults full*, or *the server is restarting* — wait and try ' +
          'again. Nothing is destroyed by a failed store: if it cannot be saved, ' +
          'it is not killed.',
      },
    )
    .setFooter({ text: SIGNATURE });
}

/**
 * Every command a player can use. Staff commands are listed too, but marked —
 * hiding them entirely just produces questions about what the buttons do.
 */
export function buildCommandsEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(ACCENT)
    .setTitle('📖  Vesta’s commands')
    .setDescription(
      `Everything ${SERVER} answers to. All replies are private — only you see them.`,
    )
    .addFields(
      {
        name: '🏛️  `/storage`',
        value:
          'Open your archive. Store, release, rename and discard, all from buttons.\n' +
          'Updates itself while it is open, so it never shows you a stale vault.',
      },
      {
        name: '🔗  `/link`',
        value: 'Connect your Steam account. Needed once, before anything else works.',
      },
      {
        name: '🚪  `/unlink`',
        value: 'Disconnect. Anything stored stays yours and returns if you link again.',
      },
      {
        name: '💀  `/slay`',
        value:
          'Kill your own dinosaur. Nothing is kept — use `/storage` if you want it back later.\n' +
          'It only ever targets **you**.',
      },
      {
        name: '🦕  `/population`',
        value:
          `What is roaming ${SERVER} right now: species, adults, gender split and ` +
          'prime. Names nobody.',
      },
      {
        name: '💬  In game',
        value:
          '`!discord` — Vesta sends you the invite link\n' +
          '`!link CODE` — finishes linking your account',
      },
      {
        name: '🛡️  Staff only',
        value:
          '`/admin game` — grant or revoke in-game admin\n' +
          '`/admin bot` — who may use `/admin`\n' +
          '`/admin population` · `/admin guide` · `/admin commands` — place these panels',
      },
    )
    .setFooter({ text: SIGNATURE });
}
