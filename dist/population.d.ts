import { EmbedBuilder } from 'discord.js';
/**
 * Server population, broken down by species.
 *
 * "Adult" is species-dependent — the big-bodied species mature at 50% growth
 * and the rest at 75% — so a single global threshold would misreport most of
 * the roster, and it would do it invisibly: the numbers would just be quietly
 * wrong. Prime is expressed against adults, because only adults can be prime.
 */
export interface PlayerRow {
    species: string;
    growth: number;
    female: boolean;
    prime: boolean;
}
export declare function adultThreshold(species: string): number;
export declare function isAdult(species: string, growth: number): boolean;
export interface SpeciesRow {
    species: string;
    online: number;
    adults: number;
    prime: number;
    males: number;
    females: number;
}
export declare function tally(players: PlayerRow[]): SpeciesRow[];
export interface PopulationOptions {
    /** Adds the auto-update line used by the pinned channel panel. */
    live?: boolean;
    /** Shown instead of the table when the server could not be read. */
    unreachable?: boolean;
    /** Per-species caps, so the panel can show what is full and what is locked. */
    caps?: Array<{
        species: string;
        cap: number;
        locked: boolean;
    }>;
}
export declare function buildPopulationEmbed(players: PlayerRow[], options?: PopulationOptions): EmbedBuilder;
