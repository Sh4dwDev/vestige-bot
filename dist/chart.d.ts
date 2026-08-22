import type { Bucket } from './peaks.js';
/** Nice round steps, so the axis reads 0/5/10 rather than 0/3.7/7.4. */
export declare function niceStep(max: number, targetLines: number): number;
export interface ChartLabels {
    /** Drawn under the plot, spread evenly left to right. */
    ticks: string[];
    /** Top left, above the plot. */
    heading: string;
}
/**
 * Renders the chart.
 *
 * Gaps stay gaps: a slot with no reading breaks the line rather than being
 * joined through, because the bot being offline is not a quiet hour and a
 * continuous line across it would claim otherwise.
 */
export declare function renderChart(buckets: Bucket[], labels: ChartLabels): Promise<Buffer>;
