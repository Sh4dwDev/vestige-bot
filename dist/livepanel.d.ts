import { type Client } from 'discord.js';
import type { Ctx } from './commands.js';
export declare function setPopulationChannel(ctx: Ctx, channelId: string | null): void;
export declare function populationChannel(ctx: Ctx): string | null;
/** Renders once, immediately. Used when an admin sets the channel. */
export declare function refreshPopulationPanel(ctx: Ctx, client: Client): Promise<void>;
export declare function startPopulationPanel(ctx: Ctx, client: Client, log: (m: string) => void): void;
