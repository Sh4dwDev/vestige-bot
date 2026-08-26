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
 *
 * The first version was a correct and completely flat table of numbers. What
 * makes a record worth opening twice is standing and contents: where you are
 * against everybody else, how far the next place is, and *what* is in your
 * vault rather than how many things are. All of that was already being fetched
 * and thrown away.
 */
export interface StoredAnimal {
    slot: string;
    species: string;
}
export interface ProfileData {
    /** Their name in game, when the bot has seen one. */
    name: string | null;
    steamId: string;
    /** Their Discord avatar, used as the embed thumbnail. */
    avatarUrl?: string;
    points: number;
    rank: number;
    players: number;
    /** Points held by the player one place above, or null at the top. */
    above: number | null;
    /** Points held by the player one place below, or null at the bottom. */
    below: number | null;
    minutes: number;
    kills: number;
    deaths: number;
    skins: string[];
    /** Null when the game server would not answer, which is not the same as none. */
    stored: StoredAnimal[] | null;
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
/** 1st, 2nd, 3rd, 4th. Ranks are read aloud, and "1 of 30" is not how anybody says it. */
export declare function ordinal(n: number): string;
export declare const medalFor: (rank: number) => string;
/**
 * Gold, silver and bronze for the top three, the house colour otherwise.
 *
 * The colour is the first thing read, before any number, so it should say the
 * one thing that matters most about the card.
 */
export declare function colourFor(rank: number): number;
/**
 * The line under the rank.
 *
 * A rank on its own is a fact; a gap is a reason to play. Leaders are told what
 * they are defending, everybody else what they are chasing.
 */
export declare function standing(data: ProfileData): string;
/**
 * Reads everything for one player.
 *
 * The database parts are immediate. The stored animals are the only thing that
 * needs the game server, and that call is allowed to fail: a profile that
 * refuses to load because the server is restarting is worse than one that
 * admits it does not know what is in the vault.
 */
export declare function gatherProfile(ctx: Ctx, discordId: string, steamId: string, avatarUrl?: string): Promise<ProfileData>;
/** Pure, so the wording and the awkward cases can be tested without a server. */
export declare function buildProfileEmbed(data: ProfileData): EmbedBuilder;
