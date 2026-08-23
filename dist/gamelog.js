import { EmbedBuilder } from 'discord.js';
import { auditChannel } from './auditlog.js';
import { SIGNATURE } from './brand.js';
/**
 * Forwards the game's own command log into the staff channel.
 *
 * **Why the log file and not a hook.** The engine's admin path is not something
 * this project can safely reach: two attempts at reflection took the server
 * down on 2026-08-23, and `pcall` does not catch a native access violation.
 * Reading a file the game already writes costs nothing and cannot crash
 * anything.
 *
 * The game writes `LogTheIsleCommandData` lines of the shape:
 *
 * ```
 * [2026.08.23-14.50.16:447][523]LogTheIsleCommandData: [2026.08.23-14.50.16] RCON Command Used [Announce] : Server cleanup in 10 minutes
 * ```
 *
 * Everything under that category is forwarded, not just the RCON form. The
 * qualifier in "RCON Command Used" is the game distinguishing a source, which
 * means other sources use the same category — so matching the category rather
 * than the phrase is what will pick up an in-game admin action without another
 * change here.
 *
 * **What is deliberately dropped:** the player-list poll. The bot asks for it
 * every minute, so forwarding it would bury every real line under a heartbeat.
 */
const OFFSET_KEY = 'gamelog_offset';
const ENABLED_KEY = 'gamelog_enabled';
/** Where the dedicated server writes it, under the game root. */
export const GAME_LOG_PATH = '/TheIsle/Saved/Logs/TheIsle.log';
/** The category the game files every command under. */
const COMMAND_LINE = /LogTheIsleCommandData:\s*(.*)$/;
/**
 * Lines not worth a Discord message.
 *
 * Get Player List is the bot's own once-a-minute poll. Anything else, staff
 * should see — a quiet log is better than one nobody reads.
 */
const NOISE = /Command Used \[Get Player List\]/i;
export const gameLogEnabled = (ctx) => ctx.db.getSetting(ENABLED_KEY) === '1';
export const setGameLogEnabled = (ctx, on) => ctx.db.setSetting(ENABLED_KEY, on ? '1' : '0');
const offset = (ctx) => {
    const raw = Number.parseInt(ctx.db.getSetting(OFFSET_KEY) ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : 0;
};
const setOffset = (ctx, at) => ctx.db.setSetting(OFFSET_KEY, String(at));
/**
 * Pulls the interesting lines out of a chunk of log.
 *
 * Pure, so the parsing can be tested against real lines without a server —
 * which matters, because the shape is the game's and could change under us.
 */
export function parseCommandLines(chunk) {
    const out = [];
    for (const raw of chunk.split(/\r?\n/)) {
        const matched = COMMAND_LINE.exec(raw);
        if (!matched)
            continue;
        // The game repeats its own timestamp inside the message; the Discord embed
        // carries one already.
        const body = (matched[1] ?? '').replace(/^\[[\d.\-:]+\]\s*/, '').trim();
        if (!body || NOISE.test(body))
            continue;
        const parts = /^(\S+)\s+Command Used\s*\[([^\]]*)\]\s*:?\s*(.*)$/.exec(body);
        out.push(parts
            ? {
                text: body,
                source: parts[1] ?? '',
                command: parts[2] ?? '',
                args: (parts[3] ?? '').trim(),
            }
            // An unrecognised shape is still forwarded verbatim rather than dropped.
            // A log that silently discards what it does not understand is worse than
            // one that occasionally shows a raw line.
            : { text: body, source: '', command: '', args: '' });
    }
    return out;
}
export function buildGameLogEmbed(line) {
    const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🎮  ${line.command || 'In-game command'}`)
        .setTimestamp();
    embed.setDescription(line.command
        ? `Source: **${line.source || 'unknown'}**`
        : line.text.slice(0, 4000));
    if (line.args)
        embed.addFields({ name: 'With', value: line.args.slice(0, 1024) });
    embed.setFooter({ text: `From the game's own log · ${SIGNATURE}` });
    return embed;
}
/** However busy it gets, this many per pass — the rest waits for the next. */
const MAX_PER_PASS = 10;
/**
 * One pass: read what is new, forward what matters.
 *
 * The offset lives in the database so a bot restart does not replay the whole
 * file into the channel. A rotated file — which the server does on restart —
 * starts again from the beginning rather than seeking past the end of a fresh
 * one.
 */
export async function runGameLog(ctx, client, log) {
    if (!gameLogEnabled(ctx))
        return 0;
    const channelId = auditChannel(ctx);
    if (!channelId)
        return 0;
    const tail = await ctx.mod.tailFile(GAME_LOG_PATH, offset(ctx));
    if (!tail)
        return 0;
    setOffset(ctx, tail.at);
    if (tail.rotated)
        log('gamelog: the log rotated, reading from the start');
    if (!tail.text)
        return 0;
    const lines = parseCommandLines(tail.text);
    if (lines.length === 0)
        return 0;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel))
        return 0;
    let sent = 0;
    for (const line of lines.slice(0, MAX_PER_PASS)) {
        const posted = await channel
            .send({ embeds: [buildGameLogEmbed(line)], allowedMentions: { parse: [] } })
            .catch(() => null);
        if (posted)
            sent += 1;
    }
    if (lines.length > MAX_PER_PASS) {
        log(`gamelog: ${lines.length - MAX_PER_PASS} line(s) held back this pass`);
    }
    return sent;
}
/**
 * Starts from the end of the file rather than the beginning.
 *
 * Used when switching on: without it, the first pass forwards an entire
 * session's log into the channel at once.
 */
export async function skipToEnd(ctx) {
    const tail = await ctx.mod.tailFile(GAME_LOG_PATH, 0);
    if (tail)
        setOffset(ctx, tail.at);
}
//# sourceMappingURL=gamelog.js.map