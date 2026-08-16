import { ModalBuilder, type ButtonInteraction, type InteractionUpdateOptions, type ModalSubmitInteraction, type StringSelectMenuInteraction, type UserSelectMenuInteraction } from 'discord.js';
import type { Ctx } from './commands.js';
/**
 * Names are cleaned up rather than rejected.
 *
 * "my rex" is a perfectly reasonable thing to type, and bouncing it back with a
 * rules lecture — which then hides whatever the real problem was — is a bad
 * trade for a label nobody but the owner ever sees.
 */
export declare function cleanSlotName(raw: string): string | null;
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
export declare function handlePanelInteraction(ctx: Ctx, interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction | UserSelectMenuInteraction): Promise<boolean>;
export {};
