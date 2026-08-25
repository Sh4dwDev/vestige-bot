import { EmbedBuilder } from 'discord.js';
import type { Ctx } from './commands.js';
/**
 * One player's own record: everything the bot knows about them in one place.
 *
 * It exists because the answer to "how am I doing" was four separate buttons
 * and a slash command, and none of them showed storage or how long somebody had
 * been here.
 *
 * **Only ever your own.** Points balances are private, and a profile command
 * that took a user option would quietly make every balance on the server
 * readable by anybody who asked.
 */
export interface ProfileData {
    /** Their name in game, when the bot has seen one. */
    name: string | null;
    steamId: string;
    points: number;
    rank: number;
    players: number;
    minutes: number;
    kills: number;
    deaths: number;
    skins: string[];
    /** Null when the game server would not answer, which is not the same as none. */
    slots: number | null;
    maxSlots: number;
    /** ISO 8601, or null if the bot never caught them arriving. */
    firstSeen: string | null;
    referrals: number;
}
/** 5312 becomes "88h". Under an hour stays in minutes, so a new player sees movement. */
export declare function playtime(minutes: number): string;
/**
 * Kills per death, to one decimal.
 *
 * Deaths of zero is not an error and not infinity: somebody who has killed
 * three things and died to none has a ratio of 3, which is what they would say
 * themselves.
 */
export declare function ratio(kills: number, deaths: number): string;
/**
 * Reads everything for one player.
 *
 * The database parts are immediate. The slot count is the only thing that needs
 * the game server, and it is allowed to fail: a profile that refuses to load
 * because the server is restarting is worse than one that admits it does not
 * know how many slots are in use.
 */
export declare function gatherProfile(ctx: Ctx, discordId: string, steamId: string): Promise<ProfileData>;
/** Pure, so the wording and the awkward cases can be tested without a server. */
export declare function buildProfileEmbed(data: ProfileData): EmbedBuilder;
