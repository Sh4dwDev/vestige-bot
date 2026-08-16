import type { Config } from './config.js';
import type { Database } from './db.js';
export declare class AdminStore {
    #private;
    private readonly sftp;
    private readonly gameIniPath;
    private readonly db;
    private readonly log;
    constructor(sftp: Config['sftp'], gameIniPath: string, db: Database, log?: (message: string) => void);
    readIni(): Promise<string>;
    /**
     * The server's slot count. `null` until Game.ini has been read once.
     *
     * The key is `MaxPlayerCount` under `[/script/theisle.tigamesession]` — not
     * `MaxPlayers`, and not under `Engine.GameSession`, which is what most guides
     * claim.
     */
    static parseMaxPlayers(ini: string): number | null;
    get maxPlayers(): number | null;
    /** Steam IDs currently written in Game.ini. */
    static parseAdmins(ini: string): string[];
    /**
     * Rewrites only the admin lines, leaving every other byte of the file alone —
     * this config holds the entire server's settings and is not ours to reformat.
     */
    static replaceAdmins(ini: string, steamIds: string[]): string;
    /** Writes atomically, so a dropped connection cannot truncate the config. */
    writeAdmins(steamIds: string[]): Promise<void>;
    /**
     * On first run, adopt whoever is already in the file — otherwise the first
     * write would quietly remove admins nobody asked to remove.
     */
    adoptExisting(): Promise<number>;
    /**
     * Brings Game.ini in line with the database, but only while the server is
     * down. Writing while it is running is pointless — the shutdown would
     * overwrite it — so changes wait for the window where they will survive.
     */
    reconcile(serverIsUp: boolean): Promise<'applied' | 'pending' | 'in-sync'>;
    close(): Promise<void>;
}
