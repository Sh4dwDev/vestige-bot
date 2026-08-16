import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
export declare function setStatusChannel(ctx: Ctx, channelId: string | null): void;
export declare function statusChannel(ctx: Ctx): string | null;
export interface StatusView {
    /** null when the server did not answer. */
    online: number | null;
    max: number | null;
}
export declare function buildStatusEmbed(view: StatusView, restart: Date | null): EmbedBuilder;
/** Called from the minute poll, which already knows these numbers. */
export declare function refreshStatusPanel(ctx: Ctx, client: Client, online: number | null): Promise<void>;
