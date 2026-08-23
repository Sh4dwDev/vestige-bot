import { EmbedBuilder } from 'discord.js';
import type { Ctx } from './commands.js';
export declare function setKillfeedChannel(ctx: Ctx, channelId: string | null): void;
export declare function killfeedChannel(ctx: Ctx): string | null;
export interface KillEvent {
    killer: string;
    /** What the killer was playing when they landed the hit. */
    killerSpecies: string;
    victim: string;
    species: string;
    /** The creature that did it, when the attacker was AI rather than a player. */
    killerAI?: string;
    /**
     * The attacker landed the wounds but was not there at the end — the victim
     * broke off and bled out. Still their kill; worded differently so the feed
     * does not claim a bite that did not happen.
     */
    lingering?: boolean;
    cause: string;
}
export declare function buildKillEmbed(event: KillEvent, nameFor: (steamId: string) => string): EmbedBuilder;
export declare function buildKillsEmbed(rows: Array<{
    steamId: string;
    kills: number;
}>, totals: {
    total: number;
    attributed: number;
}, nameFor: (steamId: string) => string): EmbedBuilder;
