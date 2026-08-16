import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './population.js';
export declare function setSpeciesChannel(ctx: Ctx, channelId: string | null): void;
export declare function speciesChannel(ctx: Ctx): string | null;
export interface LockChange {
    species: string;
    cap: number;
    count: number;
    locked: boolean;
}
/**
 * Compares live counts against the caps and returns only what changed.
 *
 * Pure so the hysteresis is testable: a species sitting exactly on its cap must
 * not flap between locked and unlocked as one player logs in and out.
 */
export declare function lockChanges(caps: Array<{
    species: string;
    cap: number;
    locked: boolean;
}>, counts: Map<string, number>): LockChange[];
export declare function buildLockEmbed(change: LockChange): EmbedBuilder;
/**
 * Called from the population poll, which already has the player list — so this
 * costs no extra round trip.
 */
export declare function checkSpeciesLocks(ctx: Ctx, client: Client, players: PlayerRow[], log: (m: string) => void): Promise<void>;
