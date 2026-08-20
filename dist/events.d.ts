import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
import type { PlayerRow } from './population.js';
/** Under this many alive, a capped species counts as endangered. */
export declare const RARE_AT = 2;
/** At this share of the cap or above, it is overpopulated. */
export declare const CULL_AT = 1;
export declare const DEFAULT_CULL_BONUS = 2;
export declare const DEFAULT_RARE_BONUS = 2;
export type EventKind = 'cull' | 'rare';
export interface SpeciesEvent {
    species: string;
    kind: EventKind;
    count: number;
    cap: number;
}
export interface EventSettings {
    enabled: boolean;
    cullBonus: number;
    rareBonus: number;
}
export declare function eventSettings(ctx: Ctx): EventSettings;
export declare function setEventsEnabled(ctx: Ctx, enabled: boolean): void;
export declare function setCullBonus(ctx: Ctx, multiplier: number): void;
export declare function setRareBonus(ctx: Ctx, multiplier: number): void;
/**
 * Which species are in an event right now.
 *
 * Pure, and only ever considers species that have a cap: without one there is
 * no notion of "too many", and every empty species on the server would read as
 * endangered the moment nobody happened to be playing it.
 */
export declare function eventsFor(caps: Array<{
    species: string;
    cap: number;
}>, counts: Map<string, number>): SpeciesEvent[];
/** The live set, stored so a bot restart does not re-announce what is running. */
export declare function activeEvents(ctx: Ctx): Map<string, EventKind>;
/** What a kill on this species is multiplied by right now. */
export declare function killMultiplier(ctx: Ctx, species: string): number;
/** What playing this species earns per hour, multiplied. */
export declare function playMultiplier(ctx: Ctx, species: string): number;
export declare function buildEventEmbed(event: SpeciesEvent, bonus: number): EmbedBuilder;
export declare function buildEventOverEmbed(species: string, kind: EventKind): EmbedBuilder;
/** ASCII, and a full sentence: these land in chat as <RCON> and stay there. */
export declare function eventAnnounce(event: SpeciesEvent, bonus: number): string;
export declare function overAnnounce(species: string, kind: EventKind): string;
/** So the next event tells everybody again rather than staying quiet. */
export declare function forgetTold(): void;
export declare function personalMessage(species: string, bonus: number, invite: string): string;
/**
 * Messages the players in an endangered event right now.
 *
 * Never throws: this sits on top of an announcement that already went out, and
 * a failed message must not take the population poll down with it.
 */
export declare function tellPlayersInEvents(ctx: Ctx, players: PlayerRow[], log: (m: string) => void): Promise<void>;
/**
 * Called from the population poll, which already has the player list.
 *
 * Only differences are announced, so a species sitting in an event for an hour
 * is mentioned once at each end rather than every minute.
 */
export declare function checkEvents(ctx: Ctx, client: Client, players: PlayerRow[], log: (m: string) => void): Promise<void>;
