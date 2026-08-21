import { type ActionRowBuilder, type ButtonBuilder, type Client, type EmbedBuilder } from 'discord.js';
import type { Database } from './db.js';
/**
 * A message the bot owns and keeps in a channel.
 *
 * The message id is remembered, so re-running the command that created it edits
 * what is already there instead of posting a second copy — otherwise a channel
 * meant to hold one reference embed slowly fills with stale duplicates.
 *
 * If the message is gone (deleted, or the channel changed) a fresh one is
 * posted and the new id recorded.
 */
export declare function postOrEdit(db: Database, client: Client, channelId: string, messageKey: string, embeds: EmbedBuilder[], components?: ActionRowBuilder<ButtonBuilder>[], files?: Array<{
    attachment: Buffer;
    name: string;
}>): Promise<void>;
