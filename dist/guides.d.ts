import { EmbedBuilder } from 'discord.js';
export declare function buildStorageGuideEmbed(): EmbedBuilder;
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
export declare const STAFF_COMMANDS: Set<string>;
export declare function buildCommandsEmbed(): EmbedBuilder;
