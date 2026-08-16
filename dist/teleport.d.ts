import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
export interface TeleportRequest {
    fromDiscord: string;
    fromSteam: string;
    toDiscord: string;
    toSteam: string;
    askedAt: number;
    accepted: boolean;
}
export declare function delaySeconds(ctx: Ctx): number;
export declare function cooldownMinutes(ctx: Ctx): number;
export declare function requestFor(steamId: string): TeleportRequest | null;
export declare function clearRequest(steamId: string): void;
export declare function addRequest(request: TeleportRequest): void;
export declare function askEmbed(fromName: string): EmbedBuilder;
export declare function askRows(fromSteam: string): ActionRowBuilder<ButtonBuilder>[];
/**
 * Runs the accepted teleport after the delay.
 *
 * Both sides are told in game, because the person being travelled to deserves
 * to know someone is on their way — and the traveller needs to know not to move.
 */
export declare function runAccepted(ctx: Ctx, client: Client, request: TeleportRequest, log: (m: string) => void): Promise<void>;
