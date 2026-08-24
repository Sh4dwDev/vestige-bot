import { EmbedBuilder, type Client } from 'discord.js';
import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
declare const KEYS: {
    readonly channel: "region_channel";
    readonly mapChannel: "region_map_channel";
    readonly mapMessage: "region_map_message";
    readonly auto: "region_auto";
    readonly reward: "region_reward";
    readonly minutes: "region_minutes";
    readonly required: "region_required_minutes";
    readonly minPlayers: "region_min_players";
    readonly roleMention: "region_role";
    readonly overrides: "region_overrides";
    readonly lastRegion: "region_last";
};
export declare const DEFAULTS: {
    readonly reward: 300;
    /** How long an event runs. */
    readonly minutes: 45;
    /** Active time inside it before somebody qualifies. */
    readonly requiredMinutes: 15;
    readonly minPlayers: 2;
    /** The gap between automatic events is drawn from this range. */
    readonly gapMinMinutes: 60;
    readonly gapMaxMinutes: 90;
};
/** How often participation is counted. Cheap: it reads the existing poll. */
export declare const CHECK_SECONDS = 30;
/**
 * No meaningful movement for this long and somebody stops accruing.
 *
 * Generous on purpose. Resting, hiding and eating are all things a player
 * should be able to do inside the region without being called AFK, so this
 * only catches somebody who has not moved at all for a long stretch.
 */
export declare const AFK_MINUTES = 10;
export interface Region {
    id: string;
    name: string;
    x: number;
    y: number;
    radius: number;
    enabled: boolean;
}
/**
 * The regions, as shipped.
 *
 * ⚠️ **EVERY COORDINATE BELOW IS A PLACEHOLDER.** They are spaced out across
 * the map so the feature can be exercised, but none of them has been measured
 * against the real Gateway landmarks and none should be trusted for a live
 * event until it has been.
 *
 * To fix one: stand in the middle of the area in game, read your position from
 * `/active-region status`, and set it with `/active-region move`. That writes
 * an override to the database, so no redeploy is needed and this list stays as
 * the fallback.
 *
 * The radius is in world units, the same scale positions arrive in — roughly
 * 1000 per HUD unit. 150000 is about 150 HUD units across the radius, which is
 * a large area on purpose: this is meant to gather people loosely, not to
 * stand them on a spot.
 */
export declare const REGIONS: Region[];
/** Regions with any admin overrides applied. */
export declare function regionsFor(ctx: Ctx): Region[];
export declare function setRegionOverride(ctx: Ctx, id: string, patch: Partial<Region>): void;
export declare const regionById: (ctx: Ctx, id: string) => Region | null;
export declare const regionChannel: (ctx: Ctx) => string | null;
export declare const regionMapChannel: (ctx: Ctx) => string | null;
export declare const REGION_MAP_MESSAGE_KEY: "region_map_message";
export declare const regionRole: (ctx: Ctx) => string | null;
export declare const autoRegions: (ctx: Ctx) => boolean;
export interface RegionSettings {
    reward: number;
    minutes: number;
    requiredMinutes: number;
    minPlayers: number;
}
export declare const regionSettings: (ctx: Ctx) => RegionSettings;
export declare const setRegionSetting: (ctx: Ctx, key: keyof typeof KEYS, value: string) => void;
export interface Participant {
    /** Eligible seconds accrued so far. */
    seconds: number;
    /** Where they were last seen, for the movement check. */
    lastX?: number;
    lastY?: number;
    /** When they last moved meaningfully. */
    movedAt: number;
}
export interface RegionEvent {
    eventId: string;
    regionId: string;
    regionName: string;
    startedAt: number;
    endsAt: number;
    reward: number;
    requiredMinutes: number;
    minPlayers: number;
    participants: Record<string, Participant>;
    /** Set once, so a restart or a repeated finish cannot pay twice. */
    rewarded: boolean;
    /** A test event pays nobody and says so. */
    dryRun?: boolean;
    lastCheck: number;
}
export declare function activeEvent(ctx: Ctx): RegionEvent | null;
export declare const saveEvent: (ctx: Ctx, event: RegionEvent | null) => void;
/** Straight-line distance, which is what "inside" means for a circle. */
export declare const distanceTo: (region: Region, x: number, y: number) => number;
export declare const inside: (region: Region, player: PlayerRow) => boolean;
/**
 * Picks the next region, avoiding an immediate repeat.
 *
 * Pure so the "never twice running" rule can be tested without a clock.
 */
export declare function pickRegion(regions: Region[], lastId: string | null, roll?: number): Region | null;
export interface TickResult {
    event: RegionEvent;
    /** Who accrued time this check. */
    counted: string[];
    /** Inside the region but not moving. */
    afk: string[];
    /** Crossed in since the last check. */
    entered: string[];
    /** Crossed out, died, or logged off. */
    left: string[];
}
/**
 * One participation check.
 *
 * Pure: this is the part that decides who gets paid, so it is testable without
 * a server. Time is credited between two checks rather than on first sighting,
 * the same way the contest does it — being seen once says only that somebody
 * arrived at some point in the last interval.
 */
export declare function tickEvent(event: RegionEvent, region: Region, players: PlayerRow[], now: number): TickResult;
/** Who has put in the time. */
export declare const qualified: (event: RegionEvent) => string[];
export interface Payout {
    paid: string[];
    reward: number;
    enough: boolean;
    dryRun: boolean;
}
/**
 * Pays everybody who qualified, once.
 *
 * `rewarded` is set before the payments and saved immediately, so a crash
 * midway cannot pay the same event twice on the next start. Each payment is
 * its own transaction: one failure must not cost everybody else theirs.
 */
export declare function payOut(ctx: Ctx, event: RegionEvent, log: (m: string) => void): Payout;
export declare function buildStartEmbed(event: RegionEvent): EmbedBuilder;
export declare function buildEndEmbed(event: RegionEvent, payout: Payout, gapMinutes: [number, number]): EmbedBuilder;
export declare const nextEventAt: (ctx: Ctx) => number;
export declare function scheduleNext(ctx: Ctx, now?: number, roll?: number): number;
export interface StartOptions {
    regionId?: string;
    minutes?: number;
    reward?: number;
    requiredMinutes?: number;
    dryRun?: boolean;
}
export type StartResult = {
    ok: true;
    event: RegionEvent;
} | {
    ok: false;
    reason: string;
};
/**
 * Opens an event.
 *
 * Refuses while one is running: two at once would split everybody and neither
 * would gather anyone, which is the entire point of the feature.
 */
export declare function startEvent(ctx: Ctx, options?: StartOptions, now?: number): StartResult;
/**
 * Finishes an event: pays, clears, and schedules the next.
 *
 * Safe to call twice — `payOut` refuses a second payment on the same event, so
 * a restart that finds an expired event finalises it exactly once.
 */
export declare function finishEvent(ctx: Ctx, event: RegionEvent, log: (m: string) => void): Payout;
/** Posts an embed to the announcement channel, mentioning a role if configured. */
export declare function announceRegion(ctx: Ctx, client: Client, embed: EmbedBuilder, log: (m: string) => void): Promise<void>;
/**
 * One pass of the whole feature: count participation, finish what is due, and
 * start the next when it is time.
 *
 * Called from the poll that already reads positions, so it costs nothing
 * extra. Never throws: an Active Region must not be able to take the poll down.
 */
export declare function runRegions(ctx: Ctx, client: Client, players: PlayerRow[], log: (m: string) => void): Promise<void>;
/**
 * The region map: the areas, and deliberately not the players.
 *
 * Shares the heatmap's projection and base image, so a region drawn here lands
 * where the same coordinates land there — which is what makes it possible to
 * check a placeholder against the real map.
 */
export declare function drawRegionMap(ctx: Ctx, client: Client, log: (m: string) => void): Promise<void>;
export {};
