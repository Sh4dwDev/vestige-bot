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

-- Every purchase, kept forever. This is the receipt when someone says they were
-- charged and got nothing, and the audit trail for staff.
CREATE TABLE IF NOT EXISTS purchases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  steam_id   TEXT NOT NULL,
  species    TEXT NOT NULL,
  mutations  TEXT NOT NULL,
  price      REAL NOT NULL,
  slot       TEXT NOT NULL,
  at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_who ON purchases (discord_id);

-- The look each player is meant to have. The engine forgets colours on relog,
-- respawn and restart, so this is the record and the bot reapplies from it.
CREATE TABLE IF NOT EXISTS skins (
  steam_id TEXT PRIMARY KEY,
  colours  TEXT NOT NULL,
  set_at   TEXT NOT NULL
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

export interface Link {
  discordId: string;
  steamId: string;
}

export interface Pending {
  steamId: string;
  code: string;
  expiresAt: number;
  attempts: number;
}

export class Database {
  readonly #db: DatabaseSync;
  /** Absolute path, and whether the file already existed. Logged at boot. */
  readonly file: string;
  readonly existed: boolean;

  constructor(file: string) {
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
  stats(): { links: number; pending: number } {
    const one = (sql: string): number =>
      Number((this.#db.prepare(sql).get() as Record<string, unknown>)['n']);
    return {
      links: one('SELECT COUNT(*) AS n FROM links'),
      pending: one('SELECT COUNT(*) AS n FROM pending_links'),
    };
  }

  close(): void {
    this.#db.close();
  }

  linkFor(discordId: string): Link | null {
    const row = this.#db
      .prepare('SELECT discord_id, steam_id FROM links WHERE discord_id = ?')
      .get(discordId) as Record<string, unknown> | undefined;
    return row ? { discordId: String(row['discord_id']), steamId: String(row['steam_id']) } : null;
  }

  linkBySteam(steamId: string): Link | null {
    const row = this.#db
      .prepare('SELECT discord_id, steam_id FROM links WHERE steam_id = ?')
      .get(steamId) as Record<string, unknown> | undefined;
    return row ? { discordId: String(row['discord_id']), steamId: String(row['steam_id']) } : null;
  }

  saveLink(discordId: string, steamId: string): void {
    this.#db
      .prepare(
        `INSERT INTO links (discord_id, steam_id, verified_at) VALUES (?, ?, ?)
         ON CONFLICT (discord_id) DO UPDATE SET steam_id = excluded.steam_id,
                                                verified_at = excluded.verified_at`,
      )
      .run(discordId, steamId, new Date().toISOString());
  }

  removeLink(discordId: string): void {
    this.#db.prepare('DELETE FROM links WHERE discord_id = ?').run(discordId);
  }

  setPending(discordId: string, steamId: string, code: string, ttlMs: number): void {
    this.#db
      .prepare(
        `INSERT INTO pending_links (discord_id, steam_id, code, expires_at, attempts)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT (discord_id) DO UPDATE SET steam_id = excluded.steam_id,
                                                code = excluded.code,
                                                expires_at = excluded.expires_at,
                                                attempts = 0`,
      )
      .run(discordId, steamId, code, Date.now() + ttlMs);
  }

  pendingFor(discordId: string): Pending | null {
    const row = this.#db
      .prepare('SELECT steam_id, code, expires_at, attempts FROM pending_links WHERE discord_id = ?')
      .get(discordId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      steamId: String(row['steam_id']),
      code: String(row['code']),
      expiresAt: Number(row['expires_at']),
      attempts: Number(row['attempts']),
    };
  }

  /** Looks up a pending link by its code, for the in-game chat confirmation. */
  pendingByCode(code: string): (Pending & { discordId: string }) | null {
    const row = this.#db
      .prepare('SELECT discord_id, steam_id, code, expires_at, attempts FROM pending_links WHERE code = ?')
      .get(code.toUpperCase()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      discordId: String(row['discord_id']),
      steamId: String(row['steam_id']),
      code: String(row['code']),
      expiresAt: Number(row['expires_at']),
      attempts: Number(row['attempts']),
    };
  }

  bumpAttempts(discordId: string): number {
    this.#db.prepare('UPDATE pending_links SET attempts = attempts + 1 WHERE discord_id = ?').run(discordId);
    return this.pendingFor(discordId)?.attempts ?? 0;
  }

  clearPending(discordId: string): void {
    this.#db.prepare('DELETE FROM pending_links WHERE discord_id = ?').run(discordId);
  }

  // ---- in-game admins ----------------------------------------------------

  gameAdmins(): string[] {
    const rows = this.#db
      .prepare('SELECT steam_id FROM game_admins ORDER BY added_at')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => String(row['steam_id']));
  }

  addGameAdmin(steamId: string, addedBy: string): void {
    this.#db
      .prepare('INSERT OR IGNORE INTO game_admins (steam_id, added_by, added_at) VALUES (?, ?, ?)')
      .run(steamId, addedBy, new Date().toISOString());
  }

  removeGameAdmin(steamId: string): boolean {
    return Number(
      this.#db.prepare('DELETE FROM game_admins WHERE steam_id = ?').run(steamId).changes,
    ) > 0;
  }

  // ---- bot admins --------------------------------------------------------

  botAdmins(): string[] {
    const rows = this.#db
      .prepare('SELECT discord_id FROM bot_admins ORDER BY added_at')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => String(row['discord_id']));
  }

  isBotAdmin(discordId: string): boolean {
    return this.#db.prepare('SELECT 1 FROM bot_admins WHERE discord_id = ?').get(discordId) !== undefined;
  }

  addBotAdmin(discordId: string, addedBy: string): void {
    this.#db
      .prepare('INSERT OR IGNORE INTO bot_admins (discord_id, added_by, added_at) VALUES (?, ?, ?)')
      .run(discordId, addedBy, new Date().toISOString());
  }

  removeBotAdmin(discordId: string): boolean {
    return Number(
      this.#db.prepare('DELETE FROM bot_admins WHERE discord_id = ?').run(discordId).changes,
    ) > 0;
  }

  // ---- purchases ---------------------------------------------------------

  recordPurchase(purchase: {
    discordId: string;
    steamId: string;
    species: string;
    mutations: string[];
    price: number;
    slot: string;
  }): void {
    this.#db
      .prepare(
        `INSERT INTO purchases (discord_id, steam_id, species, mutations, price, slot, at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        purchase.discordId,
        purchase.steamId,
        purchase.species,
        purchase.mutations.join(', '),
        purchase.price,
        purchase.slot,
        new Date().toISOString(),
      );
  }

  recentPurchases(limit: number): Array<{
    discordId: string;
    species: string;
    mutations: string;
    price: number;
    at: string;
  }> {
    const rows = this.#db
      .prepare('SELECT discord_id, species, mutations, price, at FROM purchases ORDER BY id DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      discordId: String(row['discord_id']),
      species: String(row['species']),
      mutations: String(row['mutations']),
      price: Number(row['price']),
      at: String(row['at']),
    }));
  }

  // ---- applied skins -----------------------------------------------------

  /** Merges: setting one part must not wipe the others already applied. */
  setSkin(steamId: string, colours: Record<string, string>): void {
    const merged = { ...(this.skinFor(steamId) ?? {}), ...colours };
    this.#db
      .prepare(
        `INSERT INTO skins (steam_id, colours, set_at) VALUES (?, ?, ?)
         ON CONFLICT (steam_id) DO UPDATE SET colours = excluded.colours,
                                              set_at = excluded.set_at`,
      )
      .run(steamId, JSON.stringify(merged), new Date().toISOString());
  }

  skinFor(steamId: string): Record<string, string> | null {
    const row = this.#db
      .prepare('SELECT colours FROM skins WHERE steam_id = ?')
      .get(steamId) as Record<string, unknown> | undefined;
    if (!row) return null;
    try {
      return JSON.parse(String(row['colours'])) as Record<string, string>;
    } catch {
      return null;
    }
  }

  clearSkin(steamId: string): boolean {
    return Number(
      this.#db.prepare('DELETE FROM skins WHERE steam_id = ?').run(steamId).changes,
    ) > 0;
  }

  // ---- skin presets ------------------------------------------------------

  savePreset(name: string, colours: Record<string, string>, madeBy: string): void {
    this.#db
      .prepare(
        `INSERT INTO skin_presets (name, colours, made_by, made_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET colours = excluded.colours,
                                          made_by = excluded.made_by,
                                          made_at = excluded.made_at`,
      )
      .run(name, JSON.stringify(colours), madeBy, new Date().toISOString());
  }

  preset(name: string): Record<string, string> | null {
    const row = this.#db
      .prepare('SELECT colours FROM skin_presets WHERE name = ?')
      .get(name) as Record<string, unknown> | undefined;
    if (!row) return null;
    try {
      return JSON.parse(String(row['colours'])) as Record<string, string>;
    } catch {
      return null;
    }
  }

  presetNames(): string[] {
    const rows = this.#db
      .prepare('SELECT name FROM skin_presets ORDER BY name')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => String(row['name']));
  }

  removePreset(name: string): boolean {
    return Number(
      this.#db.prepare('DELETE FROM skin_presets WHERE name = ?').run(name).changes,
    ) > 0;
  }

  // ---- species caps ------------------------------------------------------

  speciesCaps(): Array<{ species: string; cap: number; locked: boolean }> {
    const rows = this.#db
      .prepare('SELECT species, cap, locked FROM species_caps ORDER BY species')
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      species: String(row['species']),
      cap: Number(row['cap']),
      locked: Number(row['locked']) === 1,
    }));
  }

  setSpeciesCap(species: string, cap: number): void {
    this.#db
      .prepare(
        `INSERT INTO species_caps (species, cap, locked) VALUES (?, ?, 0)
         ON CONFLICT (species) DO UPDATE SET cap = excluded.cap`,
      )
      .run(species, cap);
  }

  removeSpeciesCap(species: string): boolean {
    return Number(
      this.#db.prepare('DELETE FROM species_caps WHERE species = ?').run(species).changes,
    ) > 0;
  }

  setSpeciesLocked(species: string, locked: boolean): void {
    this.#db
      .prepare('UPDATE species_caps SET locked = ? WHERE species = ?')
      .run(locked ? 1 : 0, species);
  }

  // ---- cooldowns ---------------------------------------------------------

  /** Milliseconds remaining, or 0 when the action is available. */
  cooldownLeft(steamId: string, action: string, windowMs: number): number {
    if (windowMs <= 0) return 0;
    const row = this.#db
      .prepare('SELECT at FROM cooldowns WHERE steam_id = ? AND action = ?')
      .get(steamId, action) as Record<string, unknown> | undefined;
    if (!row) return 0;
    return Math.max(0, Number(row['at']) + windowMs - Date.now());
  }

  startCooldown(steamId: string, action: string): void {
    this.#db
      .prepare(
        `INSERT INTO cooldowns (steam_id, action, at) VALUES (?, ?, ?)
         ON CONFLICT (steam_id, action) DO UPDATE SET at = excluded.at`,
      )
      .run(steamId, action, Date.now());
  }

  // ---- kills -------------------------------------------------------------

  recordKill(killerSteam: string, victimSteam: string, species: string, cause: string): void {
    this.#db
      .prepare('INSERT INTO kills (killer_steam, victim_steam, species, cause, at) VALUES (?, ?, ?, ?, ?)')
      .run(killerSteam, victimSteam, species, cause, new Date().toISOString());
  }

  /** Attributed kills only — an empty killer is a death nobody gets credit for. */
  topKillers(limit: number): Array<{ steamId: string; kills: number }> {
    const rows = this.#db
      .prepare(
        `SELECT killer_steam, COUNT(*) AS n FROM kills WHERE killer_steam <> ''
         GROUP BY killer_steam ORDER BY n DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({ steamId: String(row['killer_steam']), kills: Number(row['n']) }));
  }

  killStats(steamId: string): { kills: number; deaths: number } {
    const one = (sql: string): number =>
      Number((this.#db.prepare(sql).get(steamId) as Record<string, unknown>)['n']);
    return {
      kills: one("SELECT COUNT(*) AS n FROM kills WHERE killer_steam = ?"),
      deaths: one('SELECT COUNT(*) AS n FROM kills WHERE victim_steam = ?'),
    };
  }

  /** Totals for the footer, so the attribution gap is visible rather than puzzling. */
  killTotals(): { total: number; attributed: number } {
    const one = (sql: string): number =>
      Number((this.#db.prepare(sql).get() as Record<string, unknown>)['n']);
    return {
      total: one('SELECT COUNT(*) AS n FROM kills'),
      attributed: one("SELECT COUNT(*) AS n FROM kills WHERE killer_steam <> ''"),
    };
  }

  // ---- points ------------------------------------------------------------

  pointsFor(steamId: string): { balance: number; minutes: number } {
    const row = this.#db
      .prepare('SELECT balance, minutes FROM points WHERE steam_id = ?')
      .get(steamId) as Record<string, unknown> | undefined;
    return row
      ? { balance: Number(row['balance']), minutes: Number(row['minutes']) }
      : { balance: 0, minutes: 0 };
  }

  /** Adds to a balance, creating the row if this is their first minute. */
  addPoints(steamId: string, amount: number, minutes = 0): void {
    this.#db
      .prepare(
        `INSERT INTO points (steam_id, balance, minutes, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (steam_id) DO UPDATE SET balance = balance + excluded.balance,
                                              minutes = minutes + excluded.minutes,
                                              updated_at = excluded.updated_at`,
      )
      .run(steamId, amount, minutes, new Date().toISOString());
  }

  /** Awards every online player in one transaction, so a crash cannot half-pay. */
  awardOnline(steamIds: string[], amount: number, minutes: number): void {
    if (steamIds.length === 0 || amount <= 0) return;
    this.#db.exec('BEGIN');
    try {
      for (const steamId of steamIds) this.addPoints(steamId, amount, minutes);
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Never goes below zero — a negative balance would be a bug with a shop attached. */
  setPoints(steamId: string, balance: number): void {
    this.#db
      .prepare(
        `INSERT INTO points (steam_id, balance, minutes, updated_at) VALUES (?, ?, 0, ?)
         ON CONFLICT (steam_id) DO UPDATE SET balance = excluded.balance,
                                              updated_at = excluded.updated_at`,
      )
      .run(steamId, Math.max(0, balance), new Date().toISOString());
  }

  topPoints(limit: number): Array<{ steamId: string; balance: number; minutes: number }> {
    const rows = this.#db
      .prepare('SELECT steam_id, balance, minutes FROM points ORDER BY balance DESC LIMIT ?')
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      steamId: String(row['steam_id']),
      balance: Number(row['balance']),
      minutes: Number(row['minutes']),
    }));
  }

  // ---- settings ----------------------------------------------------------

  getSetting(key: string): string | null {
    const row = this.#db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | Record<string, unknown>
      | undefined;
    return row ? String(row['value']) : null;
  }

  setSetting(key: string, value: string): void {
    this.#db
      .prepare(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}
