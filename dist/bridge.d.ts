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
export type Verb = 'store' | 'restore' | 'list' | 'delete' | 'slay' | 'players' | 'give' | 'teleport' | 'where' | 'skinget' | 'skinmany' | 'pattern' | 'notify' | 'heal' | 'prime' | 'nest' | 'look' | 'skinfields' | 'transfer' | 'slotinfo';
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
/** What the mod reports for one player's prime progress. */
export interface PrimeState {
    eligible: boolean;
    /** Keyed "1" to "10". Absent keys are conditions the pawn did not expose. */
    conditions: Record<string, boolean>;
    growth: number;
    health: number;
    maxHealth: number;
    stamina: number;
    maxStamina: number;
    hunger: number;
    maxHunger: number;
    thirst: number;
    maxThirst: number;
    /** How many Elder stacks the pawn carries; this alone decides Elder tier. */
    elderStacks: number;
    /** Per-nutrient values, plus `bMalnutrition`. Empty if the pawn withheld them. */
    nutrients?: Record<string, number | boolean>;
}
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
    /**
     * Ground height, from mod v3.30.0 on.
     *
     * The only terrain height the bot can ever trust. Nothing can ask the engine
     * what the ground is at an arbitrary point, so a place a dinosaur was
     * standing is the only spot anything can safely be spawned.
     */
    z?: number;
}
export interface Result {
    id: string;
    verb: string;
    steam: string;
    ok: boolean;
    msg: string;
    /** Shape depends on the verb: slots for `list`, players for `players`. */
    data?: StoredSlot[] | PlayerRow[] | PrimeState;
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
     * Finds and reads a file in the mod directory, by listing rather than by
     * guessing names.
     *
     * Guessing meant four `get` calls per refresh for a file that is usually not
     * there, and a miss goes through the reconnect-and-retry path — so a server
     * with no map picture reconnected SFTP eight times every five minutes and
     * filled the log with it. One listing answers the whole question.
     *
     * The negative answer is cached too: "there is no map here" does not change
     * often enough to be worth asking every time.
     */
    findFile(match: RegExp): Promise<Buffer | null>;
    /** Who is playing what, right now. */
    players(): Promise<PlayerRow[]>;
    /**
     * The ten prime condition flags for one player, with their vitals.
     *
     * Reported by number. What each condition actually means is not documented
     * anywhere, so the vitals ride along: the mapping is worked out by changing
     * one thing in game and seeing which flag moves.
     */
    prime(steamId: string): Promise<PrimeState>;
    /**
     * Reads the part of a file that has appeared since `from`.
     *
     * For tailing the game's own log, which is megabytes by the end of a session
     * — fetching the whole thing every poll would move a gigabyte an hour to
     * read a handful of new lines. `start` on the read stream means only the new
     * bytes cross the wire.
     *
     * A file that has shrunk was rotated, which the server does on restart. That
     * is reported rather than guessed at, so the caller can start again from the
     * beginning instead of seeking past the end of a fresh file.
     */
    tailFile(remotePath: string, from: number): Promise<{
        text: string;
        at: number;
        rotated: boolean;
    } | null>;
    close(): Promise<void>;
}
