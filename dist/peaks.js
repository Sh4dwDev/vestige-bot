import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { renderChart } from './chart.js';
import { postOrEdit } from './pinned.js';
/**
 * How busy the island has been: one panel for the last day, one for the week.
 *
 * Built from the readings the server poll writes, which is the only record of
 * this that exists — Evrima keeps none, so a question as ordinary as "when is
 * this server actually busy" is otherwise unanswerable.
 *
 * Two panels rather than one with both ranges, because they answer different
 * questions. The day tells somebody whether to log on tonight; the week tells
 * an owner which evenings are worth running an event on.
 */
const CHANNEL_KEY = 'peaks_channel';
export const PEAK_DAY_MESSAGE_KEY = 'peaks_day_message';
export const PEAK_WEEK_MESSAGE_KEY = 'peaks_week_message';
/** Long enough to be a trend, short enough that the panel is never far behind. */
export const REFRESH_MINUTES = 15;
/** Nothing asks beyond this, and the table would otherwise grow forever. */
const KEEP_DAYS = 30;
export function setPeaksChannel(ctx, channelId) {
    const current = ctx.db.getSetting(CHANNEL_KEY) || '';
    ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
    // Only forget the panels when they are moving, so re-running the command in
    // the same channel refreshes rather than orphaning them.
    if ((channelId ?? '') !== current) {
        ctx.db.setSetting(PEAK_DAY_MESSAGE_KEY, '');
        ctx.db.setSetting(PEAK_WEEK_MESSAGE_KEY, '');
    }
}
export function peaksChannel(ctx) {
    return ctx.db.getSetting(CHANNEL_KEY) || null;
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
export function bucket(readings, since, slots, now) {
    const span = now.getTime() - since.getTime();
    const width = span / slots;
    const out = Array.from({ length: slots }, (_, n) => ({
        at: new Date(since.getTime() + (n * width)),
        peak: null,
    }));
    for (const reading of readings) {
        const offset = new Date(reading.at).getTime() - since.getTime();
        if (offset < 0 || offset > span)
            continue;
        // The final instant belongs to the last slot rather than one past the end.
        const index = Math.min(slots - 1, Math.floor(offset / width));
        const slot = out[index];
        if (!slot)
            continue;
        slot.peak = slot.peak === null ? reading.online : Math.max(slot.peak, reading.online);
    }
    return out;
}
/** Eight heights, so a bar has some resolution without needing a real chart. */
const BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
/**
 * A bar per slot, scaled to the busiest one.
 *
 * Scaled to the data rather than to the slot cap: on a server that peaks at six,
 * scaling to a hundred draws six flat lines and says nothing. A slot with no
 * reading is a space, which reads as a gap rather than as zero players.
 */
export function sparkline(buckets) {
    const highest = Math.max(0, ...buckets.map((b) => b.peak ?? 0));
    if (highest === 0)
        return ' '.repeat(buckets.length);
    return buckets.map((b) => {
        if (b.peak === null)
            return ' ';
        if (b.peak === 0)
            return '▁';
        const step = Math.ceil((b.peak / highest) * BLOCKS.length);
        return BLOCKS[Math.min(BLOCKS.length, Math.max(1, step)) - 1] ?? '▁';
    }).join('');
}
export const IMAGE_NAME = { day: 'peaks-day.png', week: 'peaks-week.png' };
/** Where the bottom of the chart is labelled, kept short: the axis font is 8px. */
export const TICKS = {
    day: ['-24h', '-18h', '-12h', '-6h', 'now'],
    week: ['-7d', '-5d', '-3d', '-1d', 'now'],
};
export function buildPeakEmbed(window, peak, buckets, now, 
/** False when the chart could not be drawn, which falls back to the bars. */
charted = false) {
    const day = window === 'day';
    const title = day ? '📈  Busiest in the last 24 hours' : '📅  Busiest this week';
    const seen = buckets.filter((b) => b.peak !== null);
    if (!peak || seen.length === 0) {
        return new EmbedBuilder()
            .setColor(0x4f545c)
            .setTitle(title)
            .setDescription('Nothing recorded yet. This fills in as the bot watches the server — ' +
            `give it ${day ? 'a few hours' : 'a day or two'}.`)
            .setFooter({ text: SIGNATURE })
            .setTimestamp(now);
    }
    // The highest a slot reached, averaged across slots that have data: "a
    // typical busy moment", which is more use than a mean over dead hours.
    const typical = seen.reduce((sum, b) => sum + (b.peak ?? 0), 0) / seen.length;
    const when = new Date(peak.at);
    return new EmbedBuilder()
        .setColor(peak.online > 0 ? 0x57f287 : 0x4f545c)
        .setTitle(title)
        .setDescription(`**${peak.online}** at once, <t:${Math.floor(when.getTime() / 1000)}:R>.\n` +
        `Typically **${typical.toFixed(1)}** at the busiest point of each ` +
        `${day ? 'hour' : 'day'}.` +
        // The bars are the fallback for when the chart could not be drawn. They
        // carry the same shape at far lower resolution, which beats a panel that
        // silently loses its picture.
        (charted
            ? ''
            : `\n\n\`\`\`\n${sparkline(buckets)}\n\`\`\`\n`
                + `-# ${day ? '24 hours ago' : '7 days ago'} → now`))
        .setImage(charted ? `attachment://${IMAGE_NAME[window]}` : null)
        .setFooter({ text: `${SERVER} · updates every ${REFRESH_MINUTES} min\n${SIGNATURE}` })
        .setTimestamp(now);
}
/**
 * Draws one window and puts it in the channel.
 *
 * Shared by the timer and the setup command so both produce the same panel —
 * the killfeed had two copies of one rule and kept behaving like the older one.
 */
export async function postPeak(ctx, client, channelId, window, since, slots, now) {
    const buckets = bucket(ctx.db.countsSince(since), since, slots, now);
    const peak = ctx.db.peakSince(since);
    const key = window === 'day' ? PEAK_DAY_MESSAGE_KEY : PEAK_WEEK_MESSAGE_KEY;
    // A failed render must not take the panel with it: the text fallback still
    // says everything the chart does, just less legibly.
    const png = await renderChart(buckets, {
        heading: window === 'day' ? 'Players, last 24 hours' : 'Players, last 7 days',
        ticks: [...TICKS[window]],
    }).catch(() => null);
    await postOrEdit(ctx.db, client, channelId, key, [buildPeakEmbed(window, peak, buckets, now, png !== null)], [], png ? [{ attachment: png, name: IMAGE_NAME[window] }] : []);
}
export function startPeakPanels(ctx, client, log) {
    const tick = async () => {
        const channelId = peaksChannel(ctx);
        if (!channelId)
            return;
        const now = new Date();
        const dayAgo = new Date(now.getTime() - (24 * 60 * 60 * 1000));
        const weekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
        try {
            // One slot an hour for the day, one a day for the week.
            await postPeak(ctx, client, channelId, 'day', dayAgo, 24, now);
            await postPeak(ctx, client, channelId, 'week', weekAgo, 7, now);
            ctx.db.pruneCounts(new Date(now.getTime() - (KEEP_DAYS * 24 * 60 * 60 * 1000)));
        }
        catch (err) {
            log(`peaks: ${err instanceof Error ? err.message : String(err)}`);
        }
    };
    setInterval(() => void tick(), REFRESH_MINUTES * 60_000).unref();
    void tick();
}
//# sourceMappingURL=peaks.js.map