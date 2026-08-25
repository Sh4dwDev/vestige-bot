import { type Server } from 'node:http';
import type { Ctx } from './commands.js';
export interface Website {
    server: Server;
    close: () => Promise<void>;
}
/**
 * Starts the API, or returns null when it is not configured.
 *
 * Never throws on a bad request or a failed Discord call. A website that can
 * take the bot down with it would be a poor trade for a page of statistics.
 */
export declare function startWebsite(ctx: Ctx, log: (m: string) => void): Website | null;
