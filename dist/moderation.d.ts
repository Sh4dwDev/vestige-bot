import { type ChatInputCommandInteraction } from 'discord.js';
import { type Ctx } from './commands.js';
export declare function setModLogChannel(ctx: Ctx, channelId: string | null): void;
export declare function modLogChannel(ctx: Ctx): string | null;
export declare function handleModeration(ctx: Ctx, i: ChatInputCommandInteraction, action: string): Promise<void>;
/**
 * The small favours: patch someone up, or move people around.
 *
 * `bring` and `goto` are the same mod verb with the ends swapped, which is why
 * they read as one thing here rather than two.
 */
export declare function handleInGame(ctx: Ctx, i: ChatInputCommandInteraction, action: string): Promise<void>;
