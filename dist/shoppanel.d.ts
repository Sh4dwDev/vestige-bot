import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type ButtonInteraction, type StringSelectMenuInteraction } from 'discord.js';
import { type Ctx } from './commands.js';
export declare const SHOP_PANEL_MESSAGE_KEY = "shop_panel_message";
export declare function setShopPanelChannel(ctx: Ctx, channelId: string | null): void;
export declare function buildShopPanel(ctx: Ctx): EmbedBuilder;
export declare function shopPanelRows(): ActionRowBuilder<ButtonBuilder>[];
/** Returns true when the interaction was ours. */
export declare function handleShopPanel(ctx: Ctx, interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<boolean>;
