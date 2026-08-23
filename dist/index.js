import { ActivityType, Client, Events, GatewayIntentBits, MessageFlags, } from 'discord.js';
import { AdminStore } from './admins.js';
import { SERVER } from './brand.js';
import { ModBridge, toPlainAscii } from './bridge.js';
import { announceLinked, describeError, handleLinkModal, handleAutocomplete, handleCommand, steamNamer, } from './commands.js';
import { loadConfig } from './config.js';
import { Database } from './db.js';
import { startPopulationPanel } from './livepanel.js';
import { startHeatmapPanel } from './heatmap.js';
import { startPeakPanels } from './peaks.js';
import { refreshGuides } from './guides.js';
import { handleFounderInteraction } from './founders.js';
import { handleHubInteraction } from './hub.js';
import { buildKillEmbed, killfeedChannel } from './kills.js';
import { awardOnline, payLinkBonus } from './points.js';
import { giveJoinRole } from './joinrole.js';
import { grantEarlyRole } from './earlymember.js';
import { founderLimit } from './founders.js';
import { cacheInvites, collectPayouts, noteJoin, noteLink, tellInviter, } from './referrals.js';
import { skinNeedsReapply } from './skinsync.js';
import { clearRequest, requestFor, runAccepted } from './teleport.js';
import { bountyPaidAnnounce, claimBounty } from './bounties.js';
import { killMultiplier } from './events.js';
import { killReward, tierOf } from './tiers.js';
import { Panel } from './pterodactyl.js';
import { startRestartScheduler } from './restarts.js';
import { startCleanupScheduler } from './cleanup.js';
import { backupConfig, startBackupScheduler } from './backup.js';
import { speciesList } from './catalog.js';
import { enforcementEnabled, restoreAllPlayables } from './enforce.js';
import { refreshStatusPanel } from './status.js';
import { handlePanelInteraction } from './panel.js';
import { handleWardrobe } from './wardrobe.js';
import { advanceTryout } from './tryout.js';
import { activeHunt, buildHuntEmbed, caughtAnnounce, claimHunt, huntChannel, huntStep, markRevealed, revealAnnounce, saveHunt, survivedAnnounce, } from './hunt.js';
import { activeContest, advanceContest, buildContestWonEmbed, contestChannel, winnersAnnounce, } from './contest.js';
import { EvrimaRcon } from './rcon.js';
const log = (message) => {
    console.log(`${new Date().toISOString()} ${message}`);
};
async function main() {
    const config = loadConfig();
    const db = new Database(config.databaseFile);
    // If this says "new file" on every boot, the host is wiping the data
    // directory — which looks identical, from Discord, to the bot forgetting
    // everyone. Worth one line to tell those apart.
    const stats = db.stats();
    log(`database ${db.existed ? 'opened' : 'CREATED NEW'}: ${db.file}`);
    log(`  ${stats.links} link(s), ${stats.pending} pending`);
    const rcon = new EvrimaRcon({ ...config.rcon, onLog: log });
    const mod = new ModBridge(config.sftp, log);
    const admins = new AdminStore(config.sftp, config.gameIniPath, db, log);
    const panel = config.panel ? new Panel(config.panel) : null;
    const ctx = { config, db, rcon, mod, admins, panel };
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
    // Prove the panel credentials now rather than at 3am when a restart is due.
    if (panel) {
        try {
            log(`control panel OK, server is ${await panel.check()}`);
        }
        catch (err) {
            log(`WARNING: control panel unusable, restarts will not fire: ${describeError(err)}`);
        }
    }
    else {
        log('note: no control panel configured, so restarts warn and save but cannot restart');
    }
    try {
        log(`${(await rcon.players()).length} player(s) online`);
    }
    catch (err) {
        log(`WARNING: RCON unavailable, linking will not work: ${describeError(err)}`);
    }
    // GuildMembers is privileged: without the toggle in the developer portal,
    // asking for it makes login fail outright. Everything else works without it,
    // so a refusal falls back rather than taking the whole bot down.
    let client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    });
    let canSeeJoins = true;
    const wire = (c) => {
        c.once(Events.ClientReady, (ready) => {
            log(`logged in as ${ready.user.tag}`);
            if (!canSeeJoins) {
                log('note: GuildMembers intent refused, so the join role cannot be given. ' +
                    'Enable "Server Members Intent" in the Discord developer portal.');
            }
            startChatWatcher(ctx, ready);
            startServerPoll(ctx, ready);
            startPopulationPanel(ctx, ready, log);
            startHeatmapPanel(ctx, ready, log);
            startPeakPanels(ctx, ready, log);
            // The invite counts have to be read before anybody joins, or the first
            // join of each boot cannot be attributed to anyone.
            void cacheInvites(ready, log);
            // Static text, so redrawing it on boot is how a change to the wording
            // reaches the people actually reading it.
            void refreshGuides(ctx, ready, log);
            startRestartScheduler(ctx, ready, log);
            startCleanupScheduler(ctx, log);
            // Everything the bot knows is in one file on the game host. This is the
            // only copy of it anywhere.
            const backup = backupConfig(config);
            if (backup) {
                startBackupScheduler(ctx, backup, log);
                log(`backups: on, to ${backup.database} on ${backup.host}`);
            }
            else {
                log('WARNING: no backup database configured, so the bot data has no copy. ' +
                    'Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE.');
            }
            // If enforcement is off, nothing else will ever put back a species that was
            // locked when the bot last stopped — it would sit unspawnable forever.
            if (!enforcementEnabled(ctx)) {
                void speciesList(ctx)
                    .then((known) => restoreAllPlayables(ctx, known, log))
                    .catch(() => undefined);
            }
        });
        c.on(Events.InteractionCreate, (interaction) => {
            void dispatch(ctx, interaction);
        });
        c.on(Events.GuildMemberAdd, (member) => {
            void giveJoinRole(ctx, member, log);
            void noteJoin(ctx, member, log);
            // Capped, so this quietly stops giving it once the seats are gone.
            void grantEarlyRole(ctx, member, founderLimit(ctx), log);
        });
    };
    wire(client);
    try {
        await client.login(config.discord.token);
    }
    catch (err) {
        if (!/disallowed intents/i.test(describeError(err)))
            throw err;
        // The portal toggle is off. Everything except the join role works without
        // it, so drop the intent rather than refusing to start.
        log('WARNING: the Server Members Intent is disabled, so the join role is off');
        canSeeJoins = false;
        await client.destroy().catch(() => undefined);
        client = new Client({ intents: [GatewayIntentBits.Guilds] });
        wire(client);
        await client.login(config.discord.token);
    }
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
    // A stray rejection anywhere else must not take the bot down silently; the
    // host would restart it and the only trace would be a gap in the log.
    process.on('unhandledRejection', (reason) => {
        log(`UNHANDLED REJECTION: ${describeError(reason)}`);
    });
}
async function dispatch(ctx, interaction) {
    try {
        if (interaction.isAutocomplete()) {
            await handleAutocomplete(ctx, interaction);
            return;
        }
        if (interaction.isChatInputCommand()) {
            await handleCommand(ctx, interaction);
            return;
        }
        // Everything else is a button, select or modal, on either the hub panel or
        // the storage panel. The hub gets first refusal; it answers only its own.
        if (interaction.isButton() || interaction.isStringSelectMenu() ||
            interaction.isModalSubmit() || interaction.isUserSelectMenu()) {
            // The link form first: it is the one interaction somebody can reach
            // without having touched any panel.
            if (interaction.isModalSubmit() && await handleLinkModal(ctx, interaction))
                return;
            if (interaction.isButton() && await handleFounderInteraction(ctx, interaction))
                return;
            if ((interaction.isButton() || interaction.isStringSelectMenu())
                && await handleWardrobe(ctx, interaction))
                return;
            if (await handleHubInteraction(ctx, interaction))
                return;
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
function startChatWatcher(ctx, client) {
    const handled = new Set();
    const lastReply = new Map();
    let primed = false;
    /**
     * The mod names events `chat-<steam>-<unix seconds>`, so their age is
     * recoverable. Zero when it cannot be parsed, which reads as "ancient" and is
     * the safe direction: ignored rather than replayed.
     */
    const secondsOld = (id) => {
        const stamp = /-(\d+)$/.exec(id)?.[1];
        return stamp ? Date.now() / 1000 - Number(stamp) : Number.POSITIVE_INFINITY;
    };
    const tick = async () => {
        let events;
        try {
            events = await ctx.mod.chatEvents();
        }
        catch {
            return; // the server is unreachable; try again next time
        }
        // On the first pass, skip what is already old — the results file keeps
        // everything, and replaying it would message people about things they typed
        // hours ago. Anything recent is still acted on, because a player who typed
        // their code seconds before the bot restarted should not have to do it
        // again. Marking the whole file handled was doing exactly that.
        if (!primed) {
            primed = true;
            for (const event of events) {
                if (secondsOld(event.id) > 120)
                    handled.add(event.id);
            }
            const pending = events.filter((e) => !handled.has(e.id)).length;
            if (pending > 0)
                log(`chat: ${pending} recent event(s) carried over a restart`);
        }
        for (const event of events) {
            if (handled.has(event.id))
                continue;
            // One bad event must not take down the loop. Before, an exception here
            // escaped as an unhandled rejection — which by default kills the process
            // — and the event had already been marked handled, so the link was lost
            // for good.
            try {
                await handleChatEvent(ctx, event, lastReply, client);
                handled.add(event.id);
            }
            catch (err) {
                log(`chat: failed to handle ${event.verb} from ${event.steam}: ${describeError(err)}`);
                // Deliberately left unhandled so the next pass retries it.
            }
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
/** One chat event. Throwing here means "retry next pass". */
async function handleChatEvent(ctx, event, lastReply, client) {
    if (event.verb === 'tpaccept') {
        const request = requestFor(event.steam);
        if (!request)
            return;
        if (request.accepted)
            return;
        request.accepted = true;
        clearRequest(event.steam);
        log(`teleport: ${event.steam} accepted in game`);
        // Deliberately not awaited: this waits out the delay, and the watcher must
        // keep polling meanwhile.
        void runAccepted(ctx, client, request, log);
        return;
    }
    if (event.verb === 'kill') {
        const raw = (event.data ?? {});
        const killerAI = String(raw.killerAI ?? '');
        const kill = {
            killer: String(raw.killer ?? ''),
            killerSpecies: String(raw.killerSpecies ?? ''),
            victim: String(raw.victim ?? event.steam),
            species: String(raw.species ?? event.text),
            // Omitted rather than set empty, so the embed can simply test for it.
            ...(killerAI ? { killerAI } : {}),
            ...(raw.lingering ? { lingering: true } : {}),
            cause: String(raw.cause ?? 'health'),
        };
        ctx.db.recordKill(kill.killer, kill.victim, kill.species, kill.cause);
        // The look belonged to that dinosaur, not to the player forever. Dying ends
        // it, so whatever they spawn next is the game's own colours until an admin
        // paints it again — otherwise a skin set once follows someone across every
        // Allosaurus they ever play.
        //
        // Storing and slaying reach here as SetHealth(0) too, but the mod does not
        // emit a kill for those: they are excluded while the player is `busy`. So a
        // stored dinosaur keeps its colours, which is what restore replays.
        if (kill.species)
            ctx.db.clearSkin(kill.victim, kill.species);
        // Respawning builds a fresh pawn, which has none of their colours.
        skinNeedsReapply(kill.victim);
        // Only an attributed kill pays: nobody is owed points for a starvation.
        if (kill.killer) {
            const reward = killReward(ctx, tierOf(ctx, kill.killerSpecies), tierOf(ctx, kill.species));
            // A cull event multiplies on top of tier and upset: the point of it is
            // that thinning an over-cap species is worth going out of your way for.
            const event = killMultiplier(ctx, kill.species);
            // A bounty is a flat pot on top, and claiming spends one of its payouts.
            // Checked here rather than in the reward maths because it has a side
            // effect: the pot has to actually go down.
            const bounty = claimBounty(ctx, kill.species);
            const points = (reward.points * event) + (bounty?.reward ?? 0);
            ctx.db.addPoints(kill.killer, points);
            log(`points: ${kill.killer} earned ${Math.round(points)} for a kill` +
                (reward.upset > 0 ? ` (${reward.upset} tier upset)` : '') +
                (event > 1 ? ` (${event}x cull event)` : '') +
                (bounty ? ` (+${bounty.reward} bounty, ${bounty.claims} left)` : ''));
            if (bounty) {
                await ctx.rcon
                    .announce(bountyPaidAnnounce(kill.species, bounty.reward, bounty.claims))
                    .catch(() => undefined);
            }
        }
        const channelId = killfeedChannel(ctx);
        if (channelId && client) {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (channel?.isTextBased() && 'send' in channel) {
                // A hunt ends on a death, which is an event rather than something
                // visible in a snapshot of who is alive — somebody who died and
                // respawned between two polls would never be noticed.
                await settleHunt(ctx, client, kill, log);
                // Shared with the leaderboards rather than a second copy of the rule —
                // it had its own, which is how it kept pinging people.
                await channel.send({
                    embeds: [buildKillEmbed(kill, steamNamer(ctx))],
                    // Renders a mention as a name without notifying anyone. Dying is not
                    // news to the person who died, and it is noise to everybody else.
                    allowedMentions: { parse: [] },
                });
            }
        }
        return;
    }
    if (event.verb === 'discordreq') {
        // The chat hook has been seen firing twice for one message, 9 seconds
        // apart — well outside the mod's own dedupe window — so the reply is
        // rate limited per player as well.
        const key = `${event.steam}|discord`;
        if (Date.now() - (lastReply.get(key) ?? 0) < 30_000)
            return;
        lastReply.set(key, Date.now());
        await sendInvite(ctx, event.steam);
        return;
    }
    // Find whoever asked for this code, and check it was them who typed it.
    const pending = ctx.db.pendingByCode(event.text.toUpperCase());
    if (!pending)
        return;
    if (pending.steamId !== event.steam) {
        log(`link: ${event.steam} used a code issued for ${pending.steamId} — ignored`);
        return;
    }
    if (Date.now() > pending.expiresAt) {
        ctx.db.clearPending(pending.discordId);
        log(`link: code for ${pending.discordId} had expired`);
        return;
    }
    // steam_id is UNIQUE, so saving over someone else's link would throw. Say
    // which accounts collided instead of failing with a constraint error.
    const owner = ctx.db.linkBySteam(pending.steamId);
    if (owner && owner.discordId !== pending.discordId) {
        ctx.db.clearPending(pending.discordId);
        log(`link: ${pending.steamId} already belongs to ${owner.discordId} — refused`);
        return;
    }
    ctx.db.saveLink(pending.discordId, pending.steamId);
    ctx.db.clearPending(pending.discordId);
    log(`link: ${pending.discordId} <- ${pending.steamId}`);
    const bonus = payLinkBonus(ctx, pending.steamId);
    if (bonus > 0)
        log(`link: paid ${bonus} joining bonus to ${pending.steamId}`);
    // Checked here rather than at join: the Steam account is what a referral is
    // owed against, and this is the first moment it is known. The outcome is
    // logged, because "why was I not credited" is otherwise unanswerable.
    const outcome = noteLink(ctx, pending.discordId, pending.steamId);
    if (outcome !== 'not-referred') {
        log(`referrals: ${pending.discordId} link -> ${outcome}`);
    }
    // Turns their own "/link" reply into a confirmation, in the channel they are
    // already looking at and visible only to them.
    await announceLinked(pending.discordId, bonus);
}
/**
 * Answers `!discord`. The mod cannot write to game chat, so the reply goes out
 * over RCON as a direct message to that player.
 */
/**
 * Advances the contested point and announces an outcome once.
 *
 * Announcing lives here rather than in the rules so the rules stay pure and
 * testable, and so a Discord failure can never stop somebody being paid.
 */
async function runContest(ctx, client, players, elapsedMs, log) {
    const contest = activeContest(ctx);
    if (!contest)
        return;
    const outcome = advanceContest(ctx, players, elapsedMs);
    if (!outcome || outcome.winners.length === 0)
        return;
    const namer = steamNamer(ctx);
    const named = outcome.winners.map(namer);
    log(`contest: ${outcome.winners.join(', ')} won ${contest.name} `
        + `for ${contest.reward} each`);
    // Points are already paid by this point. Everything below is telling people,
    // so each part is allowed to fail on its own.
    await ctx.rcon.announce(toPlainAscii(winnersAnnounce(contest, named)))
        .catch(() => undefined);
    const channelId = contestChannel(ctx);
    if (!channelId)
        return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel))
        return;
    await channel.send({
        embeds: [buildContestWonEmbed(contest, named)],
        allowedMentions: { parse: [] },
    }).catch(() => undefined);
}
/** Pays a hunt out when its quarry is killed, and says so. */
async function settleHunt(ctx, client, kill, log) {
    const hunt = claimHunt(ctx, kill.killer, kill.victim);
    if (!hunt)
        return;
    const killer = steamNamer(ctx)(kill.killer);
    log(`hunt: ${kill.killer} caught ${hunt.targetSteam} for ${hunt.reward}`);
    await ctx.rcon.announce(toPlainAscii(caughtAnnounce(hunt, killer))).catch(() => undefined);
    await sayInHuntChannel(ctx, client, buildHuntEmbed(hunt, 'caught', killer));
}
/** Calls out the quarry's position, and ends the hunt when its time is up. */
async function runHunt(ctx, client, players, log) {
    const hunt = activeHunt(ctx);
    if (!hunt)
        return;
    const step = huntStep(hunt, players, Date.now());
    if (step.kind === 'waiting')
        return;
    if (step.kind === 'survived') {
        saveHunt(ctx, null);
        log(`hunt: ${hunt.targetSteam} survived`);
        await ctx.rcon.announce(toPlainAscii(survivedAnnounce(hunt))).catch(() => undefined);
        await sayInHuntChannel(ctx, client, buildHuntEmbed(hunt, 'survived'));
        return;
    }
    // Marked before announcing: a failed announcement must not mean trying again
    // every minute for the rest of the hunt.
    markRevealed(ctx, hunt, Date.now());
    await ctx.rcon.announce(toPlainAscii(revealAnnounce(hunt, step.x, step.y, step.species)))
        .catch(() => undefined);
}
async function sayInHuntChannel(ctx, client, embed) {
    const channelId = huntChannel(ctx);
    if (!channelId)
        return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel))
        return;
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } })
        .catch(() => undefined);
}
async function sendInvite(ctx, steamId) {
    if (!ctx.config.discordInvite)
        return;
    // The mod's notification, not RCON. `directmessage` draws over the game's own
    // ANNOUNCEMENT label, renders the sender as "RCON" on a line of its own, and
    // is gone in about a second — which is useless for a link somebody has to
    // read and type out. The notification stays on screen until dismissed.
    try {
        await ctx.mod.notify(steamId, `Discord: ${ctx.config.discordInvite}`);
        log(`discord: sent invite to ${steamId}`);
        return;
    }
    catch (err) {
        log(`discord: notification failed for ${steamId}: ${describeError(err)}`);
    }
    // Falls back rather than saying nothing: a banner that vanishes still beats
    // silence when somebody has just asked for the link.
    try {
        await ctx.rcon.directMessage(steamId, ctx.config.discordInvite);
        log(`discord: sent invite to ${steamId} over RCON instead`);
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
    let lastAward = Date.now();
    const tick = async () => {
        const players = await ctx.rcon.players().catch(() => null);
        const online = players?.length ?? null;
        if (players !== null) {
            // Both of these are only knowable while somebody is looking. The names
            // feed the killfeed, which reports people who have often already
            // disconnected; the counts are the only record of how busy it was.
            try {
                ctx.db.rememberNames(players);
                ctx.db.recordCount(online ?? 0);
            }
            catch (err) {
                log(`history: could not record: ${describeError(err)}`);
            }
        }
        // Points accrue against this poll rather than a timer of their own, so a
        // player is only ever paid for time they were actually seen online. The
        // species comes from the mod, since the payout is scaled by tier.
        if (players !== null) {
            const elapsed = Date.now() - lastAward;
            lastAward = Date.now();
            try {
                // Read once and used twice: the positions the contest needs are the
                // same ones the payout needs, so asking again would be a second round
                // trip for data already in hand.
                const live = await ctx.mod.players();
                awardOnline(ctx, live, elapsed);
                await runContest(ctx, client, live, elapsed, log);
                // Closes the hidden-species window the instant the admin is seen on it.
                await advanceTryout(ctx, live, log);
                await runHunt(ctx, client, live, log);
            }
            catch (err) {
                log(`points: award failed: ${describeError(err)}`);
            }
        }
        else {
            // Do not bank time while the server is unreachable — nobody is playing.
            lastAward = Date.now();
        }
        // Referrals are paid on playtime, which only exists after the award above.
        try {
            for (const payout of collectPayouts(ctx)) {
                log(`referrals: paid ${payout.reward} to ${payout.inviterDiscord} `
                    + `for ${payout.inviteeDiscord}`);
                void tellInviter(client, payout);
            }
        }
        catch (err) {
            log(`referrals: payout failed: ${describeError(err)}`);
        }
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
        // Shares this poll rather than running its own, so the panel and the bot's
        // own status can never disagree.
        await refreshStatusPanel(ctx, client, online).catch(() => undefined);
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