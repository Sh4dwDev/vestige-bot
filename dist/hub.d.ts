import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { type Ctx } from './commands.js';
export declare const HUB_MESSAGE_KEY = "hub_message";
export declare function setHubChannel(ctx: Ctx, channelId: string | null): void;
export declare function buildHubEmbed(): EmbedBuilder;
export declare function hubRows(): ActionRowBuilder<ButtonBuilder>[];
/** Returns true when the interaction was ours. */
export declare function handleHubInteraction(ctx: Ctx, interaction: ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction): Promise<boolean>;
