import type { PlayerRow } from './bridge.js';
import type { Ctx } from './commands.js';
export declare const DEFAULT_PARENT_POINTS = 400;
/** HUD units. A nest is a small thing; standing on it is the claim. */
export declare const DEFAULT_RADIUS = 20;
/**
 * Which prime flag means "get nested in".
 *
 * Configurable rather than hardcoded because the project's own condition table
 * says indexes 2 and 9 were inferred from ordering and never individually
 * watched — and that it should be believed over the table when a player
 * reports otherwise. A wrong guess here would pay for the wrong achievement,
 * so it is a setting rather than a constant.
 */
export declare const DEFAULT_CONDITION = 2;
/** Growth at or below which somebody is new enough to have just hatched. */
export declare const DEFAULT_GROWTH = 0.2;
/** However big the crowd, this many parents at most. */
export declare const MAX_PARENTS = 3;
export interface NestingSettings {
    enabled: boolean;
    parentPoints: number;
    radius: number;
    condition: number;
    growth: number;
}
export declare function nestingSettings(ctx: Ctx): NestingSettings;
export declare const setNestingEnabled: (ctx: Ctx, on: boolean) => void;
export declare const setNestingPoints: (ctx: Ctx, points: number) => void;
export declare const setNestingRadius: (ctx: Ctx, hud: number) => void;
export declare const setNestingCondition: (ctx: Ctx, index: number) => void;
/**
 * Who was near enough, adult enough and the right species to have nested this
 * hatchling.
 *
 * Pure, because this is the part that decides who gets paid on a guess — and a
 * guess is worth testing precisely.
 */
export declare function parentsOf(hatchling: PlayerRow, players: PlayerRow[], radiusHud: number): string[];
/** Who is small enough to be worth asking about, and has not been asked yet. */
export declare function hatchlingCandidates(players: PlayerRow[], growth: number, checked: ReadonlySet<string>): PlayerRow[];
/**
 * Players who have grown past the threshold and can be forgotten.
 *
 * Without this the checked set grows forever, and a player who hatches, dies
 * and hatches again is never paid for the second nest.
 */
export declare function grownUp(players: PlayerRow[], growth: number, checked: ReadonlySet<string>): string[];
/** The in-game line. ASCII only: the mod drops anything else silently. */
export declare const nestAnnounce: (species: string, parents: number, points: number) => string;
/** What the parent sees on their own screen. */
export declare const parentNotice: (species: string, points: number) => string;
/** Test seam, and the way a restart-like reset is done. */
export declare const forgetChecked: () => void;
export interface NestOutcome {
    hatchling: string;
    species: string;
    parents: string[];
    points: number;
}
/**
 * One pass: find new hatchlings, confirm they were nested, pay the parents.
 *
 * Reads the prime flags only for players small enough to have just hatched and
 * not already asked about — normally nobody, occasionally one. Never throws:
 * a nest payout must not be able to take down the poll it rides on.
 */
export declare function runNesting(ctx: Ctx, players: PlayerRow[], log: (m: string) => void): Promise<NestOutcome[]>;
