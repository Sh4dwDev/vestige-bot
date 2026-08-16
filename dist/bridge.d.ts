import type { Config } from './config.js';
/**
 * Talks to the DinoStorage mod.
 *
 * The mod runs inside the game server and has no sockets, so its interface is
 * NDJSON files in its own Saved directory, reached over SFTP:
 *
 *   inbox.ndjson     commands in
 *   results.ndjson   results out, append-only
 */
export type Verb = 'store' | 'restore' | 'list' | 'delete' | 'slay' | 'players';
export interface StoredSlot {
    slot: string;
    species: string;
    storedAt: number;
}
export interface PlayerRow {
    species: string;
    growth: number;
    female: boolean;
    prime: boolean;
}
export interface Result {
    id: string;
    verb: string;
    steam: string;
    ok: boolean;
    msg: string;
    /** Shape depends on the verb: slots for `list`, players for `players`. */
    data?: StoredSlot[] | PlayerRow[];
}
export declare class ModBridge {
    #private;
    private readonly sftp;
    private readonly log;
    constructor(sftp: Config['sftp'], log?: (message: string) => void);
    get modDir(): string;
    check(): Promise<void>;
    /** Sends a command and waits for the matching reply. */
    run(verb: Verb, steamId: string, args?: Record<string, unknown>): Promise<Result>;
    /**
     * Things players typed in game chat — link codes and `!discord`. The mod
     * appends these to the results file as they happen, so the bot polls rather
     * than being pushed to. One read serves both, since the watcher wakes often.
     */
    chatEvents(): Promise<Array<{
        id: string;
        verb: string;
        steam: string;
        text: string;
        data?: unknown;
    }>>;
    /** Who is playing what, right now. */
    players(): Promise<PlayerRow[]>;
    close(): Promise<void>;
}
