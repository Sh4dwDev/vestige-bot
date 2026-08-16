import { ModalBuilder, type ButtonInteraction, type InteractionUpdateOptions, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import type { Ctx } from './commands.js';
export interface PanelOptions {
    selected?: string | null;
    notice?: {
        text: string;
        tone: 'good' | 'bad' | 'warn';
    } | null;
    /** Set for background refreshes, so they stay out of the log. */
    quiet?: boolean;
}
export declare function buildPanel(ctx: Ctx, steamId: string, options?: PanelOptions): Promise<InteractionUpdateOptions>;
export declare function stopAutoRefresh(userId: string): void;
type Editable = {
    editReply: (options: InteractionUpdateOptions) => Promise<unknown>;
};
/** Renders the panel and (re)arms auto-refresh. */
export declare function showPanel(ctx: Ctx, interaction: Editable, userId: string, steamId: string, options?: PanelOptions): Promise<void>;
export declare function storeModal(): ModalBuilder;
/**
 * Handles every component and modal on the panel. Returns true when the
 * interaction belonged to us.
 */
export declare function handlePanelInteraction(ctx: Ctx, interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<boolean>;
export {};
