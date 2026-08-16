import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, } from 'discord.js';
import { AdminStore } from './admins.js';
import { SERVER } from './brand.js';
import { ModBridge } from './bridge.js';
import { announceLinked, describeError, handleCommand } from './commands.js';
import { loadConfig } from './config.js';
import { Database } from './db.js';
import { startPopulationPanel } from './livepanel.js';
import { handlePanelInteraction } from './panel.js';
import { EvrimaRcon } from './rcon.js';
const log = (message) => {
    console.log(`${new Date().toISOString()} ${message}`);
};
async function main() {
    const config = loadConfig();
    const db = new Database(config.databaseFile);
    const rcon = new EvrimaRcon({ ...config.rcon, onLog: log });
    const mod = new ModBridge(config.sftp, log);
    const admins = new AdminStore(config.sftp, config.gameIniPath, db, log);
    const ctx = { config, db, rcon, mod, admins };
    // Fail at boot rather than on someone's first command.
    await mod.check();
    log(`mod directory OK: ${mod.modDir}`);
    try {
        const adopted = await admins.adoptExisting();
        if (adopted > 0)
            log(`adopted ${adopted} existing admin(s) from ${config.gameIniPath}`);
    }
    catch (err) {
        log(`WARNING: could not read Game.ini, /admin game will not work: ${describeError(err)}`);
    }
    if (!config.discordInvite)
        log('note: DISCORD_INVITE is unset, so !discord is disabled');
    try {
        log(`${(await rcon.players()).length} player(s) online`);
    }
    catch (err) {
        log(`WARNING: RCON unavailable, linking will not work: ${describeError(err)}`);
    }
    // Slash commands only, so no privileged intents are needed.
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.once(Events.ClientReady, (ready) => {
        log(`logged in as ${ready.user.tag}`);
        startChatWatcher(ctx);
        startServerPoll(ctx, ready);
        startPopulationPanel(ctx, ready, log);
    });
    client.on(Events.InteractionCreate, (interaction) => {
        void dispatch(ctx, interaction);
    });
    await client.login(config.discord.token);
    const shutdown = () => {
        log('shutting down');
        void client.destroy().finally(() => {
            rcon.close();
            void Promise.all([mod.close(), admins.close()]).finally(() => {
                db.close();
                process.exit(0);
            });
        });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
async function dispatch(ctx, interaction) {
    try {
        if (interaction.isChatInputCommand()) {
            await handleCommand(ctx, interaction);
            return;
        }
        // Everything on the storage panel is a button, select or modal.
        if (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) {
            await handlePanelInteraction(ctx, interaction);
        }
    }
    catch (err) {
        const message = describeError(err);
        console.error('interaction failed:', message);
        if (!interaction.isRepliable())
            return;
        try {
            const payload = { content: `Something went wrong: ${message}` };
            if (interaction.deferred || interaction.replied)
                await interaction.editReply(payload);
            else
                await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
        }
        catch {
            // The interaction token expired; nothing to do but keep running.
        }
    }
}
/**
 * Reacts to what players type in game chat: `!link CODE` and `!discord`.
 *
 * The mod appends those to its results file as they happen, so this polls
 * rather than being pushed to. Events already handled are remembered, because
 * the file keeps them until it rotates.
 */
function startChatWatcher(ctx) {
    const handled = new Set();
    const lastReply = new Map();
    let primed = false;
    const tick = async () => {
        let events;
        try {
            events = await ctx.mod.chatEvents();
        }
        catch {
            return; // the server is unreachable; try again next time
        }
        // The results file keeps events until it rotates, so on the first pass we
        // only take note of what is already there. Otherwise every restart replays
        // the whole history and messages people about things they typed hours ago.
        if (!primed) {
            primed = true;
            for (const event of events)
                handled.add(event.id);
            return;
        }
        for (const event of events) {
            if (handled.has(event.id))
                continue;
            handled.add(event.id);
            if (event.verb === 'discordreq') {
                // The chat hook has been seen firing twice for one message, 9 seconds
                // apart — well outside the mod's own dedupe window — so the reply is
                // rate limited per player as well.
                const key = `${event.steam}|discord`;
                const previous = lastReply.get(key) ?? 0;
                if (Date.now() - previous < 30_000)
                    continue;
                lastReply.set(key, Date.now());
                await sendInvite(ctx, event.steam);
                continue;
            }
            // Find whoever asked for this code, and check it was them who typed it.
            const pending = ctx.db.pendingByCode(event.text.toUpperCase());
            if (!pending)
                continue;
            if (pending.steamId !== event.steam) {
                log(`link: ${event.steam} used a code issued for ${pending.steamId} — ignored`);
                continue;
            }
            if (Date.now() > pending.expiresAt) {
                ctx.db.clearPending(pending.discordId);
                continue;
            }
            ctx.db.saveLink(pending.discordId, pending.steamId);
            ctx.db.clearPending(pending.discordId);
            log(`link: ${pending.discordId} <- ${pending.steamId}`);
            // Turns their own "/link" reply into a confirmation, in the channel they
            // are already looking at and visible only to them.
            await announceLinked(pending.discordId);
        }
        // Keep the seen-set from growing without bound on a long-running bot.
        // Re-prime rather than simply clearing, so the next pass does not treat
        // every event still in the file as new.
        if (handled.size > 500) {
            handled.clear();
            primed = false;
        }
    };
    setInterval(() => void tick(), 3000).unref();
    void tick();
}
/**
 * Answers `!discord`. The mod cannot write to game chat, so the reply goes out
 * over RCON as a direct message to that player.
 */
async function sendInvite(ctx, steamId) {
    if (!ctx.config.discordInvite)
        return;
    try {
        // Short on purpose: this renders as a notification that vanishes in about
        // a second, so it has to be readable at a glance.
        await ctx.rcon.directMessage(steamId, `${SERVER} Discord: ${ctx.config.discordInvite}`);
        log(`discord: sent invite to ${steamId}`);
    }
    catch (err) {
        log(`discord: could not message ${steamId}: ${describeError(err)}`);
    }
}
/**
 * One poll a minute drives everything that needs to know whether the server is
 * up: the bot's status, and the Game.ini reconciler. They share a single RCON
 * call rather than each asking separately.
 *
 * The reconciler matters because the server rewrites its own config when it
 * stops, so an edit made while it runs is thrown away. Being down is the only
 * durable moment, which is why this watches for it — and why a restart is all
 * an operator ever has to do.
 */
function startServerPoll(ctx, client) {
    let previous;
    const tick = async () => {
        const online = await ctx.rcon.players().then((p) => p.length).catch(() => null);
        // Before the status, because reading Game.ini is also what refreshes the
        // slot count the status wants to show.
        try {
            const outcome = await ctx.admins.reconcile(online !== null);
            if (outcome === 'applied')
                log('admins: Game.ini written while the server was down');
        }
        catch {
            // SFTP hiccup, or a config being rewritten right now; next pass retries.
        }
        setStatus(client, online, ctx.admins.maxPlayers);
        // Only on a change, so an idle server does not fill the log — and so a
        // drop-out is obvious when reading it back.
        if (online !== previous) {
            previous = online;
            log(online === null ? 'status: server not responding' : `status: ${online} online`);
        }
    };
    // A minute is also comfortably inside Discord's presence rate limit.
    setInterval(() => void tick(), 60_000).unref();
    void tick();
}
/** `online: null` means the server did not answer; `max: null` means Game.ini has not been read. */
function setStatus(client, online, max) {
    if (online === null) {
        client.user.setPresence({
            status: 'idle',
            activities: [{ name: `${SERVER} restart`, type: ActivityType.Watching }],
        });
        return;
    }
    client.user.setPresence({
        status: 'online',
        activities: [{
                name: max === null ? `${online} player${online === 1 ? '' : 's'}` : `${online}/${max} players`,
                type: ActivityType.Watching,
            }],
    });
}
main().catch((err) => {
    console.error(describeError(err));
    process.exit(1);
});
//# sourceMappingURL=index.js.map