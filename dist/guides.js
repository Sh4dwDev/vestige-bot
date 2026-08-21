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
export function buildStorageGuideEmbed() {
    return new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle(`🏛️  The ${SERVER} Archive`)
        .setDescription(`${ARCHIVE_CAP} holds your dinosaurs while you are away. Put one in, come ` +
        'back another day, and it returns exactly as you left it — growth, ' +
        'condition, mutations and all.\n\n' +
        '**You get three vaults.** Nothing else about your dinosaur is changed.')
        .addFields({
        name: '1️⃣  Link your account — once, ever',
        value: 'Run `/link` with your Steam64 ID while you are **in game**, then type ' +
            'the code it gives you in **game chat**.\n' +
            'Typing it in game is what proves the account is yours.',
    }, {
        name: '2️⃣  Store a dinosaur',
        value: 'Run `/storage`, press **Store**, and give it a name you will recognise.\n' +
            '⚠️ **Your dinosaur dies when you store it.** That is how it leaves the ' +
            'world — it is the mechanism, not a bug. It is shrunk first, so nobody ' +
            'gets a free meal from the body.',
    }, {
        name: '3️⃣  Get it back',
        value: 'Run `/storage`, pick a vault, press **Release**.\n' +
            'You must be playing the **same species** — spawn as one, then release. ' +
            'Your new dinosaur becomes the one you stored.',
    }, {
        name: '📏  The rules',
        value: '• Only **fully grown** dinosaurs can be stored\n' +
            '• **Three vaults** per player\n' +
            '• Releasing **empties** that vault\n' +
            '• Same species to release\n' +
            '• Unlinking keeps everything — it is yours again when you link back',
    }, {
        name: '❓  If something goes wrong',
        value: 'The panel tells you why. The usual answers are *not fully grown*, ' +
            '*all three vaults full*, or *the server is restarting* — wait and try ' +
            'again. Nothing is destroyed by a failed store: if it cannot be saved, ' +
            'it is not killed.',
    })
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
export function buildCommandsEmbed() {
    return new EmbedBuilder()
        .setColor(ACCENT)
        .setTitle('📖  Vesta’s commands')
        .setDescription(`Everything ${SERVER} answers to. All replies are private — only you see them.`)
        .addFields({
        name: '🏛️  `/storage`',
        value: 'Open your archive. Store, release, rename and discard, all from buttons.\n' +
            'Updates itself while it is open, so it never shows you a stale vault.',
    }, {
        name: '🔗  `/link`',
        value: 'Connect your Steam account. Needed once, before anything else works.',
    }, {
        name: '🚪  `/unlink`',
        value: 'Disconnect. Anything stored stays yours and returns if you link again.',
    }, {
        name: '💀  `/slay`',
        value: 'Kill your own dinosaur. Nothing is kept — use `/storage` if you want it back later.\n' +
            'It only ever targets **you**, and there is a wait between slays so it ' +
            'cannot be used to reroll your spawn.',
    }, {
        name: '🦕  `/population`',
        value: `What is roaming ${SERVER} right now: species, adults, gender split and ` +
            'prime. Names nobody.',
    }, {
        name: '🧭  `/teleport`',
        value: 'Ask a friend if you can travel to them. They must agree — with a button ' +
            'or by typing `!accept` in game — and you arrive a short while after, not ' +
            'instantly. There is a wait between travels.',
    }, {
        name: '🛒  `/shop`',
        value: '`/shop browse` for what is for sale, `/shop buy` to spend your points.\n' +
            'You get a **fully grown** dinosaur in your archive — collect it by ' +
            'spawning that species and pressing **Release**. Uses a vault, and ' +
            'purchases are not refundable.',
    }, {
        name: '🪙  `/points`',
        value: 'What you have earned by playing, and `/points top` for the leaderboard.\n' +
            'Higher tiers earn faster, and kills pay too. Spend them in `/shop`.',
    }, {
        name: '⚔️  `/kills`',
        value: '`/kills top` for the deadliest players, `/kills me` for your own record.\n' +
            'Only direct attacks count — bleeding out, starving and AI show as ' +
            'deaths with nobody credited.',
    }, {
        name: '💬  In game',
        value: '`!discord` — Vesta sends you the invite link\n' +
            '`!link CODE` — finishes linking your account\n' +
            '`!accept` — lets a friend travel to you',
    })
        .setFooter({ text: SIGNATURE });
}
//# sourceMappingURL=guides.js.map