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

  constructor(file: string) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.#db = new DatabaseSync(file);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec(SCHEMA);
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
