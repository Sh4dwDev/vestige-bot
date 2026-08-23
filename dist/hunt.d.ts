import { EmbedBuilder } from 'discord.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
export interface Hunt {
    /** Steam ID of the quarry. */
    targetSteam: string;
    /** For announcements, since Steam IDs mean nothing to players. */
    targetName: string;
    reward: number;
    skin?: string;
    /** When it ends, whatever has happened. */
    endsAt: number;
    /** How often the quarry's position goes out. */
    revealEveryMs: number;
    /** Last time it did, so the timer survives a restart. */
    lastRevealAt: number;
    startedAt: number;
}
export declare function activeHunt(ctx: Ctx): Hunt | null;
export declare const saveHunt: (ctx: Ctx, hunt: Hunt | null) => void;
export type HuntStep = {
    kind: 'reveal';
    x: number;
    y: number;
} | {
    kind: 'survived';
} | {
    kind: 'waiting';
};
/**
 * What the hunt should do next, given the clock and where everyone is.
 *
 * Pure. A kill is handled separately because it arrives as an event rather than
 * being visible in a snapshot of positions.
 */
export declare function huntStep(hunt: Hunt, players: PlayerRow[], now: number): HuntStep;
/** ASCII only: these go out over RCON, which drops anything else silently. */
export declare const huntAnnounce: (hunt: Hunt) => string;
export declare const revealAnnounce: (hunt: Hunt, x: number, y: number) => string;
export declare const caughtAnnounce: (hunt: Hunt, killer: string) => string;
export declare const survivedAnnounce: (hunt: Hunt) => string;
export declare function buildHuntEmbed(hunt: Hunt, state: 'running' | 'caught' | 'survived', killer?: string): EmbedBuilder;
export declare const huntChannel: (ctx: Ctx) => string | null;
export declare const setHuntChannel: (ctx: Ctx, channelId: string | null) => void;
/**
 * Pays the killer and ends it.
 *
 * Called from the kill handler rather than the poll: a death is an event, and
 * looking for it in a snapshot of who is alive would miss anybody who died and
 * respawned between two readings.
 *
 * Returns the hunt that was ended, or null when this kill had nothing to do
 * with one.
 */
export declare function claimHunt(ctx: Ctx, killerSteam: string, victimSteam: string): Hunt | null;
/** Marks a reveal as done, so the timer advances even if announcing fails. */
export declare const markRevealed: (ctx: Ctx, hunt: Hunt, now: number) => void;
