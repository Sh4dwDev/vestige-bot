import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
export declare const PEAK_DAY_MESSAGE_KEY = "peaks_day_message";
export declare const PEAK_WEEK_MESSAGE_KEY = "peaks_week_message";
/** Long enough to be a trend, short enough that the panel is never far behind. */
export declare const REFRESH_MINUTES = 15;
export declare function setPeaksChannel(ctx: Ctx, channelId: string | null): void;
export declare function peaksChannel(ctx: Ctx): string | null;
export interface Reading {
    at: string;
    online: number;
}
export interface Bucket {
    /** Where the bucket starts. */
    at: Date;
    /** The busiest reading inside it, or null when nothing was recorded. */
    peak: number | null;
}
/**
 * Groups readings into equal slots, oldest first.
 *
 * The **peak** of each slot rather than the average, because a server that hit
 * twelve for an hour and sat at one for the rest of the evening was busy, and
 * an average reports it as empty. Slots with no readings stay null rather than
 * becoming zero: the bot being offline is not the same as nobody playing, and
 * drawing it as an empty bar says something untrue.
 */
export declare function bucket(readings: Reading[], since: Date, slots: number, now: Date): Bucket[];
/**
 * A bar per slot, scaled to the busiest one.
 *
 * Scaled to the data rather than to the slot cap: on a server that peaks at six,
 * scaling to a hundred draws six flat lines and says nothing. A slot with no
 * reading is a space, which reads as a gap rather than as zero players.
 */
export declare function sparkline(buckets: Bucket[]): string;
export declare const IMAGE_NAME: {
    readonly day: "peaks-day.png";
    readonly week: "peaks-week.png";
};
/** Where the bottom of the chart is labelled, kept short: the axis font is 8px. */
export declare const TICKS: {
    readonly day: readonly ["-24h", "-18h", "-12h", "-6h", "now"];
    readonly week: readonly ["-7d", "-5d", "-3d", "-1d", "now"];
};
export declare function buildPeakEmbed(window: 'day' | 'week', peak: {
    online: number;
    at: string;
} | null, buckets: Bucket[], now: Date, 
/** False when the chart could not be drawn, which falls back to the bars. */
charted?: boolean): EmbedBuilder;
/**
 * Draws one window and puts it in the channel.
 *
 * Shared by the timer and the setup command so both produce the same panel —
 * the killfeed had two copies of one rule and kept behaving like the older one.
 */
export declare function postPeak(ctx: Ctx, client: Client, channelId: string, window: 'day' | 'week', since: Date, slots: number, now: Date): Promise<void>;
export declare function startPeakPanels(ctx: Ctx, client: Client, log: (m: string) => void): void;
