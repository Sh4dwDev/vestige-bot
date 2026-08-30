import { type ChatInputCommandInteraction } from 'discord.js';
import { type Ctx } from './commands.js';
export declare function setModLogChannel(ctx: Ctx, channelId: string | null): void;
export declare function modLogChannel(ctx: Ctx): string | null;
export declare function handleModeration(ctx: Ctx, i: ChatInputCommandInteraction, action: string): Promise<void>;
export declare function handleInGame(ctx: Ctx, i: ChatInputCommandInteraction, action: string): Promise<void>;
