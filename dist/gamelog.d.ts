import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
/** Where the dedicated server writes it, under the game root. */
export declare const GAME_LOG_PATH = "/TheIsle/Saved/Logs/TheIsle.log";
export declare const gameLogEnabled: (ctx: Ctx) => boolean;
export declare const setGameLogEnabled: (ctx: Ctx, on: boolean) => void;
export interface CommandLine {
    /** The bit after the category, with the game's own timestamp removed. */
    text: string;
    /** `RCON`, or whatever else the game names as the source. */
    source: string;
    /** The command in brackets, where there was one. */
    command: string;
    /** Everything after the colon. */
    args: string;
}
/**
 * Pulls the interesting lines out of a chunk of log.
 *
 * Pure, so the parsing can be tested against real lines without a server —
 * which matters, because the shape is the game's and could change under us.
 */
export declare function parseCommandLines(chunk: string): CommandLine[];
export declare function buildGameLogEmbed(line: CommandLine): EmbedBuilder;
/**
 * One pass: read what is new, forward what matters.
 *
 * The offset lives in the database so a bot restart does not replay the whole
 * file into the channel. A rotated file — which the server does on restart —
 * starts again from the beginning rather than seeking past the end of a fresh
 * one.
 */
export declare function runGameLog(ctx: Ctx, client: Client, log: (m: string) => void): Promise<number>;
/**
 * Starts from the end of the file rather than the beginning.
 *
 * Used when switching on: without it, the first pass forwards an entire
 * session's log into the channel at once.
 */
export declare function skipToEnd(ctx: Ctx): Promise<void>;
