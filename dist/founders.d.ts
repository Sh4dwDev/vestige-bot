import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type ButtonInteraction } from 'discord.js';
import { type Ctx } from './commands.js';
import { type Look } from './skins.js';
export declare const FOUNDER_MESSAGE_KEY = "founder_message";
export declare const DEFAULT_LIMIT = 50;
export interface FounderSkin extends Look {
    id: string;
    name: string;
    blurb: string;
    emoji: string;
}
/**
 * Three, and only three. They are exclusive, so they do not appear in the
 * normal preset list and cannot be handed out with `/admin skin`.
 *
 * Field names come from PARTS in skins.ts, which is the verified list. Making
 * one up produces a colour that is silently dropped on the way to the pawn.
 */
export declare const FOUNDER_SKINS: FounderSkin[];
export declare const skinById: (id: string) => FounderSkin | undefined;
export declare function setFounderChannel(ctx: Ctx, channelId: string | null): void;
export declare function founderChannel(ctx: Ctx): string | null;
export declare function founderLimit(ctx: Ctx): number;
export declare function setFounderLimit(ctx: Ctx, limit: number): void;
export declare function buildFounderPanel(ctx: Ctx): EmbedBuilder;
export declare function founderRows(ctx: Ctx): ActionRowBuilder<ButtonBuilder>[];
/** Returns true when this interaction was ours. */
export declare function handleFounderInteraction(ctx: Ctx, interaction: ButtonInteraction): Promise<boolean>;
