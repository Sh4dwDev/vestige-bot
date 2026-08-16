import SftpClient from 'ssh2-sftp-client';
/**
 * In-game administrators.
 *
 * Evrima keeps them in Game.ini as repeated `AdminsSteamIDs=<id>` lines under
 * `[/script/theisle.tigamestatebase]`, and reads the file only at startup.
 *
 * The awkward part: **the server rewrites its own config on shutdown**, so an
 * edit made while it is running is silently thrown away. The bot therefore
 * treats its database as the desired state and writes the file whenever the
 * server is DOWN — the one window where an edit survives to be read on the next
 * start. Everything else is bookkeeping around that fact.
 */
const ADMIN_KEY = 'AdminsSteamIDs';
const SECTION = '/script/theisle.tigamestatebase';
export class AdminStore {
    sftp;
    gameIniPath;
    db;
    log;
    #client = null;
    #maxPlayers = null;
    constructor(sftp, gameIniPath, db, log = () => { }) {
        this.sftp = sftp;
        this.gameIniPath = gameIniPath;
        this.db = db;
        this.log = log;
    }
    async #connect() {
        if (this.#client)
            return this.#client;
        const client = new SftpClient();
        await client.connect({
            host: this.sftp.host,
            port: this.sftp.port,
            username: this.sftp.username,
            password: this.sftp.password,
            readyTimeout: 15_000,
            keepaliveInterval: 10_000,
        });
        client.on('close', () => { this.#client = null; });
        client.on('error', () => { this.#client = null; });
        this.#client = client;
        return client;
    }
    async #withClient(fn) {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const client = await this.#connect();
            try {
                return await fn(client);
            }
            catch (err) {
                this.#client = null;
                await client.end().catch(() => undefined);
                if (attempt === 1)
                    throw err;
            }
        }
        throw new Error('unreachable');
    }
    async readIni() {
        const raw = await this.#withClient((client) => client.get(this.gameIniPath));
        if (!Buffer.isBuffer(raw))
            throw new Error('unexpected Game.ini response');
        const ini = raw.toString('utf8');
        // Picked up here rather than fetched separately: the reconciler already
        // downloads this file every minute, so the slot count stays fresh for free.
        this.#maxPlayers = AdminStore.parseMaxPlayers(ini);
        return ini;
    }
    /**
     * The server's slot count. `null` until Game.ini has been read once.
     *
     * The key is `MaxPlayerCount` under `[/script/theisle.tigamesession]` — not
     * `MaxPlayers`, and not under `Engine.GameSession`, which is what most guides
     * claim.
     */
    static parseMaxPlayers(ini) {
        const match = /^\s*MaxPlayerCount\s*=\s*(\d+)\s*$/im.exec(ini);
        const value = match?.[1];
        if (!value)
            return null;
        const parsed = Number.parseInt(value, 10);
        return parsed > 0 ? parsed : null;
    }
    get maxPlayers() {
        return this.#maxPlayers;
    }
    /** Steam IDs currently written in Game.ini. */
    static parseAdmins(ini) {
        const found = [];
        for (const line of ini.split(/\r?\n/)) {
            const match = new RegExp(`^\\s*${ADMIN_KEY}\\s*=\\s*(\\S+)\\s*$`, 'i').exec(line);
            const value = match?.[1];
            if (value && /^7656119\d{10}$/.test(value))
                found.push(value);
        }
        return [...new Set(found)];
    }
    /**
     * Rewrites only the admin lines, leaving every other byte of the file alone —
     * this config holds the entire server's settings and is not ours to reformat.
     */
    static replaceAdmins(ini, steamIds) {
        const lines = ini.split(/\r?\n/);
        const out = [];
        let inserted = false;
        for (const line of lines) {
            if (new RegExp(`^\\s*${ADMIN_KEY}\\s*=`, 'i').test(line)) {
                // Drop existing entries; the full list is re-emitted at the section head.
                continue;
            }
            out.push(line);
            if (!inserted && line.trim().toLowerCase() === `[${SECTION}]`) {
                for (const id of steamIds)
                    out.push(`${ADMIN_KEY}=${id}`);
                inserted = true;
            }
        }
        if (!inserted) {
            // The section is missing entirely, which would make the keys silently
            // ignored — add it rather than writing orphaned lines.
            out.push('', `[${SECTION}]`, ...steamIds.map((id) => `${ADMIN_KEY}=${id}`));
        }
        return out.join('\n');
    }
    /** Writes atomically, so a dropped connection cannot truncate the config. */
    async writeAdmins(steamIds) {
        const ini = await this.readIni();
        const next = AdminStore.replaceAdmins(ini, steamIds);
        await this.#withClient(async (client) => {
            const tmp = `${this.gameIniPath}.bot-tmp`;
            const backup = `${this.gameIniPath}.bot-backup`;
            // Keep one rollback copy of whatever the server last wrote.
            await client.put(Buffer.from(ini, 'utf8'), backup).catch(() => undefined);
            await client.put(Buffer.from(next, 'utf8'), tmp);
            if (await client.exists(this.gameIniPath)) {
                await client.delete(this.gameIniPath).catch(() => undefined);
            }
            await client.rename(tmp, this.gameIniPath);
        });
        this.log(`Game.ini updated: ${steamIds.length} admin(s)`);
    }
    /**
     * On first run, adopt whoever is already in the file — otherwise the first
     * write would quietly remove admins nobody asked to remove.
     */
    async adoptExisting() {
        if (this.db.getSetting('admins_seeded') !== null)
            return 0;
        const existing = AdminStore.parseAdmins(await this.readIni());
        for (const steamId of existing)
            this.db.addGameAdmin(steamId, 'existing config');
        this.db.setSetting('admins_seeded', new Date().toISOString());
        return existing.length;
    }
    /**
     * Brings Game.ini in line with the database, but only while the server is
     * down. Writing while it is running is pointless — the shutdown would
     * overwrite it — so changes wait for the window where they will survive.
     */
    async reconcile(serverIsUp) {
        const desired = this.db.gameAdmins();
        const current = AdminStore.parseAdmins(await this.readIni());
        const same = desired.length === current.length && desired.every((id) => current.includes(id));
        if (same)
            return 'in-sync';
        if (serverIsUp)
            return 'pending';
        await this.writeAdmins(desired);
        return 'applied';
    }
    async close() {
        const client = this.#client;
        this.#client = null;
        if (client)
            await client.end().catch(() => undefined);
    }
}
//# sourceMappingURL=admins.js.map