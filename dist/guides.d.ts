import { EmbedBuilder } from 'discord.js';
export declare function buildStorageGuideEmbed(): EmbedBuilder;
/**
 * Commands a **player** can use.
 *
 * Staff commands are deliberately absent: this embed is pinned in a public
 * channel, and advertising `/admin` to everyone invites people to try it and
 * then ask why it was refused. Staff already know what they have.
 */
export declare const STAFF_COMMANDS: Set<string>;
export declare function buildCommandsEmbed(): EmbedBuilder;
