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
export type Verb = 'store' | 'restore' | 'list' | 'delete' | 'slay' | 'players' | 'give' | 'teleport' | 'where' | 'skinget' | 'skinmany' | 'pattern' | 'notify' | 'heal';
export interface StoredSlot {
    slot: string;
    species: string;
    storedAt: number;
}
/**
 * Storage slots per player.
 *
 * The **mod** is the authority — it enforces this and refuses a write past it.
 * This copy only lets the bot say so in words first, so the two must be changed
 * together. It lives here because this is where the mod's contract lives.
 */
export declare const MAX_SLOTS = 3;
export interface PlayerRow {
    /** Present from mod v3.2.0 on; older payloads omit it. */
    steam?: string;
    species: string;
    growth: number;
    female: boolean;
    prime: boolean;
    /**
     * Where they are, from mod v3.24.0 on. Optional because a pawn that will not
     * give a location still counts as playing - it just cannot be plotted.
     */
    x?: number;
    y?: number;
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
/**
 * Notifications must be plain ASCII.
 *
 * Verified live on 2026-08-17: "Travelling in 45s - hold still" arrives, and the
 * same line with an em dash is swallowed — no error, no reply, nothing on
 * screen. Somewhere between the NDJSON bridge and the FText it does not
 * survive, and it fails silently, which is the worst way to fail.
 *
 * So the punctuation is folded here rather than asking every caller to
 * remember. Anything still non-ASCII after folding is dropped.
 */
export declare function toPlainAscii(message: string): string;
export declare class ModBridge {
    #private;
    private readonly sftp;
    private readonly log;
    constructor(sftp: Config['sftp'], log?: (message: string) => void);
    get modDir(): string;
    check(): Promise<void>;
    /**
     * Sends a command and waits for the matching reply.
     *
     * `quiet` suppresses the log lines. Background refreshes use it — an open
     * panel polls every 20 seconds, and logging all of that buries the commands a
     * person actually issued.
     */
    run(verb: Verb, steamId: string, args?: Record<string, unknown>, { quiet }?: {
        quiet?: boolean;
    }): Promise<Result>;
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
    /**
     * A persistent on-screen notice, the same one the game uses for prime.
     *
     * Preferred over RCON `directmessage` for anything a player needs to read:
     * that renders over the game's own ANNOUNCEMENT label and is gone in about a
     * second, which is fine for a link code and useless for anything else.
     *
     * Never throws. A notice is always a nicety on top of a Discord reply that
     * already went out, so failing to show one must not fail the command.
     */
    notify(steamId: string, message: string): Promise<boolean>;
    /**
     * Reads a file out of the mod directory on the game server.
     *
     * The bot and the game run on different hosts, and only the game host has a
     * file manager most people already use. So a picture dropped in beside the
     * mod is reachable without anybody touching the bot's own filesystem.
     *
     * Null rather than throwing when it is not there: callers are asking whether
     * a file exists, and absence is the normal answer.
     */
    readFile(name: string): Promise<Buffer | null>;
    /** Who is playing what, right now. */
    players(): Promise<PlayerRow[]>;
    close(): Promise<void>;
}
