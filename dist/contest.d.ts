import { EmbedBuilder } from 'discord.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
export interface Contest {
    /** Where, in world units. */
    x: number;
    y: number;
    /** How close counts, in world units. */
    radius: number;
    /** How long somebody has to hold it, in milliseconds. */
    holdMs: number;
    /** Points for the winner. */
    reward: number;
    /** A skin preset the winner also keeps, if one was chosen. */
    skin?: string;
    name: string;
    startedAt: number;
    /** Steam ID to milliseconds held so far. */
    progress: Record<string, number>;
}
export declare function activeContest(ctx: Ctx): Contest | null;
export declare const saveContest: (ctx: Ctx, contest: Contest | null) => void;
/** Straight-line distance, which is what "near it" means on a flat map. */
export declare const distance: (ax: number, ay: number, bx: number, by: number) => number;
export declare const inside: (contest: Contest, player: PlayerRow) => boolean;
export interface TickResult {
    contest: Contest;
    /** Who is standing on it right now. */
    holders: string[];
    /** True when more than one is, so nobody is gaining. */
    contested: boolean;
    /** Set once somebody has held it long enough. */
    winner: string | null;
}
/**
 * Advances the hold clock.
 *
 * Pure on purpose: this is the part with the rules in it, and rules are worth
 * testing without a server attached.
 */
export declare function tickContest(contest: Contest, players: PlayerRow[], elapsedMs: number): TickResult;
/** Best progress so far, for the panel and the announcement. */
export declare function leader(contest: Contest): {
    steam: string;
    heldMs: number;
} | null;
/** The HUD scale, so a player can navigate to it. */
export declare const hud: (value: number) => number;
export declare function buildContestEmbed(contest: Contest, nameFor: (steamId: string) => string, state?: {
    holders: string[];
    contested: boolean;
}): EmbedBuilder;
/** ASCII only: this goes out over RCON, which silently drops anything else. */
export declare const contestAnnounce: (contest: Contest) => string;
export declare const winnerAnnounce: (contest: Contest, who: string) => string;
