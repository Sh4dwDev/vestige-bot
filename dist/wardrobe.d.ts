import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import type { Ctx } from './commands.js';
export declare const WARDROBE_MESSAGE_KEY = "wardrobe_message";
export declare function setWardrobeChannel(ctx: Ctx, channelId: string | null): void;
export declare function wardrobeChannel(ctx: Ctx): string | null;
export declare function buildWardrobePanel(): EmbedBuilder;
export declare function wardrobeRows(): ActionRowBuilder<ButtonBuilder>[];
/** The picker, built from what this player actually owns. */
export declare function buildPicker(ctx: Ctx, steamId: string): {
    embed: EmbedBuilder;
    rows: ActionRowBuilder<StringSelectMenuBuilder>[];
};
/** Returns true when the interaction was ours. */
export declare function handleWardrobe(ctx: Ctx, interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean>;
