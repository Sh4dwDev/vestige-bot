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
    /**
     * When the quarry stopped being locatable, or absent while they are on.
     *
     * A hunt whose target has logged off looks identical to one where nobody has
     * found them yet: no position calls, no kill, and then "survived". Hunters
     * search an empty island and blame the bot. Tracked so it can be said out
     * loud instead.
     */
    goneSince?: number;
    /** Whether the disappearance was announced, so it is said once, not per tick. */
    goneTold?: boolean;
    /**
     * Who was standing with the quarry when the hunt was called.
     *
     * These are the people who cannot claim it. A quarry's own group killing
     * them is not a hunt, it is the pair of them splitting the reward, and it is
     * the cheapest way to farm one.
     *
     * The game does not tell us who is grouped with whom, and the two attempts
     * at asking the engine directly took the server down (see NOTES.md). Standing
     * together at the moment the hunt is announced is the signal available
     * without that risk: a group is already together, a hunter has to travel.
     */
    company?: string[];
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
/**
 * How long the quarry can be unlocatable before it is worth saying so.
 *
 * Longer than a respawn or a loading screen, short enough that hunters are not
 * left combing an empty island. Somebody dying and coming back should not
 * trigger it.
 */
export declare const GONE_AFTER_MS = 90000;
export interface PresenceStep {
    /** The hunt with its presence bookkeeping updated. */
    hunt: Hunt;
    /** Whether anything changed, and so whether it is worth saving. */
    changed: boolean;
    /** Said once per transition, never per tick. */
    announce: 'gone' | 'back' | null;
}
/**
 * Whether the quarry is on the island, and whether that has just changed.
 *
 * Pure, and separate from the position call because it answers a different
 * question: not "where are they" but "are they here at all".
 *
 * Two flags rather than one. `goneSince` starts the clock the moment they stop
 * being locatable, which is not yet worth announcing because a respawn or a
 * loading screen looks the same. `goneTold` records that it was announced, so
 * the message goes out once per disappearance rather than every five seconds
 * for the rest of the hunt.
 */
export declare function presenceStep(hunt: Hunt, players: PlayerRow[], now: number): PresenceStep;
export declare const goneAnnounce: (hunt: Hunt) => string;
export declare const backAnnounce: (hunt: Hunt) => string;
/** ASCII only: these go out over RCON, which drops anything else silently. */
export declare const huntAnnounce: (hunt: Hunt) => string;
export declare const revealAnnounce: (hunt: Hunt, x: number, y: number, species: string) => string;
export declare const caughtAnnounce: (hunt: Hunt, killer: string) => string;
export declare const survivedAnnounce: (hunt: Hunt) => string;
export declare const colludedAnnounce: (hunt: Hunt) => string;
export declare function buildHuntEmbed(hunt: Hunt, state: 'running' | 'caught' | 'survived', killer?: string): EmbedBuilder;
export interface HuntStatus {
    /** Null when the server would not say, which is not the same as absent. */
    online: boolean;
    x?: number;
    y?: number;
    species?: string;
    /** How far the nearest hunter is, in HUD units, excluding the quarry. */
    nearest: number | null;
    /** How many are barred from claiming because they were stood with the quarry. */
    companyCount: number;
}
/**
 * The live staff view, which answers the question the card is opened for:
 * is this working, and does it need a nudge.
 *
 * The static card says what the hunt IS. During a hunt what matters is whether
 * the quarry is even on the island, and whether anybody is anywhere near them.
 */
export declare function buildHuntStatusEmbed(hunt: Hunt, status: HuntStatus): EmbedBuilder;
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
/**
 * How close counts as travelling with somebody, in HUD units.
 *
 * The "you are close" band. Tighter than that and a group spread over a
 * clearing is missed; wider and half the server is somebody's company.
 */
export declare const COMPANY_WITHIN = 20;
/**
 * Who is standing with the quarry right now.
 *
 * Pure, and taken once at the start rather than tracked: after the hunt is
 * announced, somebody approaching the quarry is exactly what a hunter does, so
 * there is no way to tell a late-joining friend from a hunter closing in. The
 * snapshot only claims to catch the people who were already there.
 */
export declare function companyOf(targetSteam: string, players: PlayerRow[]): string[];
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
export type HuntClaim = 
/** Somebody earned it. */
{
    kind: 'paid';
    hunt: Hunt;
}
/** Killed by their own company, so it ends and nobody is paid. */
 | {
    kind: 'collusion';
    hunt: Hunt;
};
export declare function claimHunt(ctx: Ctx, killerSteam: string, victimSteam: string): HuntClaim | null;
/**
 * Marks a reveal as done, so the timer advances even if announcing fails.
 *
 * The species is refreshed at the same time: it is only knowable while they are
 * locatable, and this is the one moment we know they were.
 */
export declare const markRevealed: (ctx: Ctx, hunt: Hunt, now: number, species?: string) => void;
