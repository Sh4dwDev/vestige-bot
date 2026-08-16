import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
/**
 * Only what the bot needs to know: which Discord account belongs to which Steam
 * account. The stored dinosaurs themselves live with the mod, on the game
 * server — this database is not the source of truth for anything else.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS links (
  discord_id  TEXT PRIMARY KEY,
  steam_id    TEXT NOT NULL UNIQUE,
  verified_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pending_links (
  discord_id TEXT PRIMARY KEY,
  steam_id   TEXT NOT NULL,
  code       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0
);

-- Desired in-game admins. Game.ini is written from this, not the other way
-- round, because the server rewrites that file on shutdown.
CREATE TABLE IF NOT EXISTS game_admins (
  steam_id TEXT PRIMARY KEY,
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL
);

-- Who may use /admin in Discord.
CREATE TABLE IF NOT EXISTS bot_admins (
  discord_id TEXT PRIMARY KEY,
  added_by   TEXT NOT NULL,
  added_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Named skin presets. Colours are stored as sRGB hex per part, so a preset
-- stays readable and editable rather than being opaque linear floats.
CREATE TABLE IF NOT EXISTS skin_presets (
  name    TEXT PRIMARY KEY,
  colours TEXT NOT NULL,
  made_by TEXT NOT NULL,
  made_at TEXT NOT NULL
);

-- Per-species population caps. The locked column is the last announced state,
-- kept so a bot restart does not re-announce a lock already reported.
CREATE TABLE IF NOT EXISTS species_caps (
  species TEXT PRIMARY KEY,
  cap     INTEGER NOT NULL,
  locked  INTEGER NOT NULL DEFAULT 0
);

-- Per-player action cooldowns. Keyed by Steam ID so unlinking and relinking is
-- not a way to clear one.
CREATE TABLE IF NOT EXISTS cooldowns (
  steam_id TEXT NOT NULL,
  action   TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (steam_id, action)
);

-- One row per death. killer_steam is empty when nothing could be attributed —
-- bleed, starvation, drowning, AI and falls leave no attacker, so kills and
-- deaths deliberately do not reconcile.
CREATE TABLE IF NOT EXISTS kills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  killer_steam TEXT NOT NULL,
  victim_steam TEXT NOT NULL,
  species      TEXT NOT NULL,
  cause        TEXT NOT NULL,
  at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kills_killer ON kills (killer_steam);
CREATE INDEX IF NOT EXISTS kills_victim ON kills (victim_steam);

-- Points are keyed by Steam ID, not Discord: they are earned by being in game,
-- so an unlinked player still accrues and finds their balance waiting when they
-- do link. Balance is REAL so a rate that is not a whole number per minute does
-- not quietly round away to nothing.
CREATE TABLE IF NOT EXISTS points (
  steam_id   TEXT PRIMARY KEY,
  balance    REAL NOT NULL DEFAULT 0,
  minutes    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`;
export class Database {
    #db;
    /** Absolute path, and whether the file already existed. Logged at boot. */
    file;
    existed;
    constructor(file) {
        this.file = path.resolve(file);
        this.existed = fs.existsSync(this.file);
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        this.#db = new DatabaseSync(this.file);
        this.#db.exec('PRAGMA journal_mode = WAL;');
        this.#db.exec(SCHEMA);
    }
    /**
     * Boot diagnostics. A link count of zero on a server that had links is the
     * signature of the database being wiped, which otherwise looks exactly like
     * the bot "forgetting" people.
     */
    stats() {
        const one = (sql) => Number(this.#db.prepare(sql).get()['n']);
        return {
            links: one('SELECT COUNT(*) AS n FROM links'),
            pending: one('SELECT COUNT(*) AS n FROM pending_links'),
        };
    }
    close() {
        this.#db.close();
    }
    linkFor(discordId) {
        const row = this.#db
            .prepare('SELECT discord_id, steam_id FROM links WHERE discord_id = ?')
            .get(discordId);
        return row ? { discordId: String(row['discord_id']), steamId: String(row['steam_id']) } : null;
    }
    linkBySteam(steamId) {
        const row = this.#db
            .prepare('SELECT discord_id, steam_id FROM links WHERE steam_id = ?')
            .get(steamId);
        return row ? { discordId: String(row['discord_id']), steamId: String(row['steam_id']) } : null;
    }
    saveLink(discordId, steamId) {
        this.#db
            .prepare(`INSERT INTO links (discord_id, steam_id, verified_at) VALUES (?, ?, ?)
         ON CONFLICT (discord_id) DO UPDATE SET steam_id = excluded.steam_id,
                                                verified_at = excluded.verified_at`)
            .run(discordId, steamId, new Date().toISOString());
    }
    removeLink(discordId) {
        this.#db.prepare('DELETE FROM links WHERE discord_id = ?').run(discordId);
    }
    setPending(discordId, steamId, code, ttlMs) {
        this.#db
            .prepare(`INSERT INTO pending_links (discord_id, steam_id, code, expires_at, attempts)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT (discord_id) DO UPDATE SET steam_id = excluded.steam_id,
                                                code = excluded.code,
                                                expires_at = excluded.expires_at,
                                                attempts = 0`)
            .run(discordId, steamId, code, Date.now() + ttlMs);
    }
    pendingFor(discordId) {
        const row = this.#db
            .prepare('SELECT steam_id, code, expires_at, attempts FROM pending_links WHERE discord_id = ?')
            .get(discordId);
        if (!row)
            return null;
        return {
            steamId: String(row['steam_id']),
            code: String(row['code']),
            expiresAt: Number(row['expires_at']),
            attempts: Number(row['attempts']),
        };
    }
    /** Looks up a pending link by its code, for the in-game chat confirmation. */
    pendingByCode(code) {
        const row = this.#db
            .prepare('SELECT discord_id, steam_id, code, expires_at, attempts FROM pending_links WHERE code = ?')
            .get(code.toUpperCase());
        if (!row)
            return null;
        return {
            discordId: String(row['discord_id']),
            steamId: String(row['steam_id']),
            code: String(row['code']),
            expiresAt: Number(row['expires_at']),
            attempts: Number(row['attempts']),
        };
    }
    bumpAttempts(discordId) {
        this.#db.prepare('UPDATE pending_links SET attempts = attempts + 1 WHERE discord_id = ?').run(discordId);
        return this.pendingFor(discordId)?.attempts ?? 0;
    }
    clearPending(discordId) {
        this.#db.prepare('DELETE FROM pending_links WHERE discord_id = ?').run(discordId);
    }
    // ---- in-game admins ----------------------------------------------------
    gameAdmins() {
        const rows = this.#db
            .prepare('SELECT steam_id FROM game_admins ORDER BY added_at')
            .all();
        return rows.map((row) => String(row['steam_id']));
    }
    addGameAdmin(steamId, addedBy) {
        this.#db
            .prepare('INSERT OR IGNORE INTO game_admins (steam_id, added_by, added_at) VALUES (?, ?, ?)')
            .run(steamId, addedBy, new Date().toISOString());
    }
    removeGameAdmin(steamId) {
        return Number(this.#db.prepare('DELETE FROM game_admins WHERE steam_id = ?').run(steamId).changes) > 0;
    }
    // ---- bot admins --------------------------------------------------------
    botAdmins() {
        const rows = this.#db
            .prepare('SELECT discord_id FROM bot_admins ORDER BY added_at')
            .all();
        return rows.map((row) => String(row['discord_id']));
    }
    isBotAdmin(discordId) {
        return this.#db.prepare('SELECT 1 FROM bot_admins WHERE discord_id = ?').get(discordId) !== undefined;
    }
    addBotAdmin(discordId, addedBy) {
        this.#db
            .prepare('INSERT OR IGNORE INTO bot_admins (discord_id, added_by, added_at) VALUES (?, ?, ?)')
            .run(discordId, addedBy, new Date().toISOString());
    }
    removeBotAdmin(discordId) {
        return Number(this.#db.prepare('DELETE FROM bot_admins WHERE discord_id = ?').run(discordId).changes) > 0;
    }
    // ---- skin presets ------------------------------------------------------
    savePreset(name, colours, madeBy) {
        this.#db
            .prepare(`INSERT INTO skin_presets (name, colours, made_by, made_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET colours = excluded.colours,
                                          made_by = excluded.made_by,
                                          made_at = excluded.made_at`)
            .run(name, JSON.stringify(colours), madeBy, new Date().toISOString());
    }
    preset(name) {
        const row = this.#db
            .prepare('SELECT colours FROM skin_presets WHERE name = ?')
            .get(name);
        if (!row)
            return null;
        try {
            return JSON.parse(String(row['colours']));
        }
        catch {
            return null;
        }
    }
    presetNames() {
        const rows = this.#db
            .prepare('SELECT name FROM skin_presets ORDER BY name')
            .all();
        return rows.map((row) => String(row['name']));
    }
    removePreset(name) {
        return Number(this.#db.prepare('DELETE FROM skin_presets WHERE name = ?').run(name).changes) > 0;
    }
    // ---- species caps ------------------------------------------------------
    speciesCaps() {
        const rows = this.#db
            .prepare('SELECT species, cap, locked FROM species_caps ORDER BY species')
            .all();
        return rows.map((row) => ({
            species: String(row['species']),
            cap: Number(row['cap']),
            locked: Number(row['locked']) === 1,
        }));
    }
    setSpeciesCap(species, cap) {
        this.#db
            .prepare(`INSERT INTO species_caps (species, cap, locked) VALUES (?, ?, 0)
         ON CONFLICT (species) DO UPDATE SET cap = excluded.cap`)
            .run(species, cap);
    }
    removeSpeciesCap(species) {
        return Number(this.#db.prepare('DELETE FROM species_caps WHERE species = ?').run(species).changes) > 0;
    }
    setSpeciesLocked(species, locked) {
        this.#db
            .prepare('UPDATE species_caps SET locked = ? WHERE species = ?')
            .run(locked ? 1 : 0, species);
    }
    // ---- cooldowns ---------------------------------------------------------
    /** Milliseconds remaining, or 0 when the action is available. */
    cooldownLeft(steamId, action, windowMs) {
        if (windowMs <= 0)
            return 0;
        const row = this.#db
            .prepare('SELECT at FROM cooldowns WHERE steam_id = ? AND action = ?')
            .get(steamId, action);
        if (!row)
            return 0;
        return Math.max(0, Number(row['at']) + windowMs - Date.now());
    }
    startCooldown(steamId, action) {
        this.#db
            .prepare(`INSERT INTO cooldowns (steam_id, action, at) VALUES (?, ?, ?)
         ON CONFLICT (steam_id, action) DO UPDATE SET at = excluded.at`)
            .run(steamId, action, Date.now());
    }
    // ---- kills -------------------------------------------------------------
    recordKill(killerSteam, victimSteam, species, cause) {
        this.#db
            .prepare('INSERT INTO kills (killer_steam, victim_steam, species, cause, at) VALUES (?, ?, ?, ?, ?)')
            .run(killerSteam, victimSteam, species, cause, new Date().toISOString());
    }
    /** Attributed kills only — an empty killer is a death nobody gets credit for. */
    topKillers(limit) {
        const rows = this.#db
            .prepare(`SELECT killer_steam, COUNT(*) AS n FROM kills WHERE killer_steam <> ''
         GROUP BY killer_steam ORDER BY n DESC LIMIT ?`)
            .all(limit);
        return rows.map((row) => ({ steamId: String(row['killer_steam']), kills: Number(row['n']) }));
    }
    killStats(steamId) {
        const one = (sql) => Number(this.#db.prepare(sql).get(steamId)['n']);
        return {
            kills: one("SELECT COUNT(*) AS n FROM kills WHERE killer_steam = ?"),
            deaths: one('SELECT COUNT(*) AS n FROM kills WHERE victim_steam = ?'),
        };
    }
    /** Totals for the footer, so the attribution gap is visible rather than puzzling. */
    killTotals() {
        const one = (sql) => Number(this.#db.prepare(sql).get()['n']);
        return {
            total: one('SELECT COUNT(*) AS n FROM kills'),
            attributed: one("SELECT COUNT(*) AS n FROM kills WHERE killer_steam <> ''"),
        };
    }
    // ---- points ------------------------------------------------------------
    pointsFor(steamId) {
        const row = this.#db
            .prepare('SELECT balance, minutes FROM points WHERE steam_id = ?')
            .get(steamId);
        return row
            ? { balance: Number(row['balance']), minutes: Number(row['minutes']) }
            : { balance: 0, minutes: 0 };
    }
    /** Adds to a balance, creating the row if this is their first minute. */
    addPoints(steamId, amount, minutes = 0) {
        this.#db
            .prepare(`INSERT INTO points (steam_id, balance, minutes, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (steam_id) DO UPDATE SET balance = balance + excluded.balance,
                                              minutes = minutes + excluded.minutes,
                                              updated_at = excluded.updated_at`)
            .run(steamId, amount, minutes, new Date().toISOString());
    }
    /** Awards every online player in one transaction, so a crash cannot half-pay. */
    awardOnline(steamIds, amount, minutes) {
        if (steamIds.length === 0 || amount <= 0)
            return;
        this.#db.exec('BEGIN');
        try {
            for (const steamId of steamIds)
                this.addPoints(steamId, amount, minutes);
            this.#db.exec('COMMIT');
        }
        catch (err) {
            this.#db.exec('ROLLBACK');
            throw err;
        }
    }
    /** Never goes below zero — a negative balance would be a bug with a shop attached. */
    setPoints(steamId, balance) {
        this.#db
            .prepare(`INSERT INTO points (steam_id, balance, minutes, updated_at) VALUES (?, ?, 0, ?)
         ON CONFLICT (steam_id) DO UPDATE SET balance = excluded.balance,
                                              updated_at = excluded.updated_at`)
            .run(steamId, Math.max(0, balance), new Date().toISOString());
    }
    topPoints(limit) {
        const rows = this.#db
            .prepare('SELECT steam_id, balance, minutes FROM points ORDER BY balance DESC LIMIT ?')
            .all(limit);
        return rows.map((row) => ({
            steamId: String(row['steam_id']),
            balance: Number(row['balance']),
            minutes: Number(row['minutes']),
        }));
    }
    // ---- settings ----------------------------------------------------------
    getSetting(key) {
        const row = this.#db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
        return row ? String(row['value']) : null;
    }
    setSetting(key, value) {
        this.#db
            .prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
            .run(key, value);
    }
}
//# sourceMappingURL=db.js.map