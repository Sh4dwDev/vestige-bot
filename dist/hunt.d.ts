import { EmbedBuilder } from 'discord.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
export interface Hunt {
    /** Steam ID of the quarry. */
    targetSteam: string;
    /** For announcements, since Steam IDs mean nothing to players. */
    targetName: string;
    /**
     * What they were last seen playing.
     *
     * Kept on the hunt rather than looked up when needed, because it has to
     * survive them being offline or unlocatable — and it is refreshed on every
     * position call, so a target who dies and comes back on something else is
     * described correctly from the next call onwards.
     */
    targetSpecies?: string;
    reward: number;
    skin?: string;
    /** When it ends, whatever has happened. */
    endsAt: number;
    /** How often the quarry's position goes out. */
    revealEveryMs: number;
    /** Last time it did, so the timer survives a restart. */
    lastRevealAt: number;
    startedAt: number;
    /**
     * How close each hunter was told they were, last time they were told.
     *
     * Kept so a notice fires when somebody crosses a band rather than every few
     * seconds while they stand still — "you are close" repeated twelve times a
     * minute is not a warmer signal, it is spam.
     */
    bands?: Record<string, number>;
}
/**
 * How close counts as close, in HUD units, nearest first.
 *
 * HUD units because that is what the position call already speaks: a hunter is
 * given `Lat -317, Long 120` and can read their own coordinates off the same
 * display, so a distance in the same scale is one they can act on.
 */
export declare const BANDS: Array<{
    within: number;
    hunter: string;
    target: string;
}>;
export declare function activeHunt(ctx: Ctx): Hunt | null;
export declare const saveHunt: (ctx: Ctx, hunt: Hunt | null) => void;
export type HuntStep = {
    kind: 'reveal';
    x: number;
    y: number;
    species: string;
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
export declare const revealAnnounce: (hunt: Hunt, x: number, y: number, species: string) => string;
export declare const caughtAnnounce: (hunt: Hunt, killer: string) => string;
export declare const survivedAnnounce: (hunt: Hunt) => string;
export declare function buildHuntEmbed(hunt: Hunt, state: 'running' | 'caught' | 'survived', killer?: string): EmbedBuilder;
export interface ProximityNotice {
    steam: string;
    text: string;
}
export interface ProximityStep {
    hunt: Hunt;
    notices: ProximityNotice[];
}
/**
 * Who is close enough to be told so, and what they are told.
 *
 * Both sides get a notice. Telling only the hunters makes the quarry a sitting
 * target who never knows to run; telling only the quarry makes the hunters
 * wander. The pair of them is what turns a coordinate into a chase.
 *
 * Pure, and it only speaks on a change of band — including the change to "no
 * longer close", which is how somebody knows they have lost the trail.
 */
export declare function proximityStep(hunt: Hunt, players: PlayerRow[]): ProximityStep;
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
/**
 * Marks a reveal as done, so the timer advances even if announcing fails.
 *
 * The species is refreshed at the same time: it is only knowable while they are
 * locatable, and this is the one moment we know they were.
 */
export declare const markRevealed: (ctx: Ctx, hunt: Hunt, now: number, species?: string) => void;
