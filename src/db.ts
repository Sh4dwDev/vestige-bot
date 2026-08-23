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

CREATE TABLE IF NOT EXISTS founders (
  discord_id TEXT PRIMARY KEY,
  skin       TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
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

-- The look a player is meant to have **on a given species**. The engine forgets
-- colours on relog, respawn and restart, so this is the record and the bot
-- reapplies from it.
--
-- Keyed by species as well as player: keyed by player alone, a Rex's colours
-- got repainted onto their Dryosaurus, which is not what anyone means by
-- "their skin". Supersedes an earlier skins table keyed on steam_id alone.
CREATE TABLE IF NOT EXISTS player_skins (
  steam_id TEXT NOT NULL,
  species  TEXT NOT NULL,
  colours  TEXT NOT NULL,
  set_at   TEXT NOT NULL,
  PRIMARY KEY (steam_id, species)
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

-- The last in-game name each account was seen using. Kept because the killfeed
-- reports people who have often just disconnected, so it cannot ask the server
-- who they were - and a row of Steam ID fragments is unreadable.
CREATE TABLE IF NOT EXISTS player_names (
  steam_id TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  seen_at  TEXT NOT NULL
);

-- One row per poll. The peak panels are built from this; nothing else records
-- how busy the server was, so without it "busiest this week" is unanswerable.
CREATE TABLE IF NOT EXISTS player_counts (
  at     TEXT NOT NULL,
  online INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS player_counts_at ON player_counts (at);

-- Who brought whom. One row per invited Discord account, written the moment
-- they join and paid only once they have linked and played.
CREATE TABLE IF NOT EXISTS referrals (
  invitee_discord TEXT PRIMARY KEY,
  inviter_discord TEXT NOT NULL,
  joined_at       TEXT NOT NULL,
  invitee_steam   TEXT,
  paid_at         TEXT,
  reward          REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS referrals_inviter ON referrals (inviter_discord);

-- A Steam account can be referred once, ever. Enforced here rather than only in
-- code: leaving and rejoining on a new Discord account is the obvious way to
-- farm this, and the database is the one place that cannot be talked round.
CREATE UNIQUE INDEX IF NOT EXISTS referrals_steam
  ON referrals (invitee_steam) WHERE invitee_steam IS NOT NULL;

-- What a dinosaur looked like BEFORE anybody painted it.
--
-- The game has no "reset to default" that can be asked for, and the colours a
-- dinosaur hatches with are its own. So the only honest way to undo a skin is
-- to have kept what was there first, captured the moment before the first
-- paint and never overwritten after.
-- Which skins a player owns.
--
-- A reward skin is a **preset somebody has been given**, rather than a second
-- kind of thing: presets already carry colours and a pattern, and staff already
-- have commands to make them. Owning is the only new idea.
--
-- Held against the Steam account, like points and storage, so it survives
-- unlinking and relinking the way everything else a player earns does.
CREATE TABLE IF NOT EXISTS owned_skins (
  steam_id   TEXT NOT NULL,
  preset     TEXT NOT NULL,
  granted_at TEXT NOT NULL,
  source     TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (steam_id, preset)
);
CREATE INDEX IF NOT EXISTS owned_skins_steam ON owned_skins (steam_id);

-- Every species the server has ever offered.
--
-- The roster only grows. Species caps work by removing a name from the live
-- spawn menu, and the live menu was also where "which species exist" came
-- from - so removing one made it unknown, and unknown species can never be
-- added back. Setting a cap to zero was a door that locked behind you.
CREATE TABLE IF NOT EXISTS known_species (
  name       TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skin_baseline (
  steam_id TEXT NOT NULL,
  species  TEXT NOT NULL,
  colours  TEXT NOT NULL,
  pattern  INTEGER,
  taken_at TEXT NOT NULL,
  PRIMARY KEY (steam_id, species)
);
`;

export interface Link {
  discordId: string;
  steamId: string;
}

export interface Referral {
  inviteeDiscord: string;
  inviterDiscord: string;
  joinedAt: string;
  inviteeSteam: string | null;
  paidAt: string | null;
  reward: number;
}

const toReferral = (row: Record<string, unknown>): Referral => ({
  inviteeDiscord: String(row['invitee_discord']),
  inviterDiscord: String(row['inviter_discord']),
  joinedAt: String(row['joined_at']),
  inviteeSteam: row['invitee_steam'] === null ? null : String(row['invitee_steam']),
  paidAt: row['paid_at'] === null ? null : String(row['paid_at']),
  reward: Number(row['reward'] ?? 0),
});

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

    // Added after player_skins shipped. CREATE TABLE IF NOT EXISTS will not
    // alter an existing table, so the column is added separately and the error
    // from it already being there is the expected case.
    try {
      this.#db.exec('ALTER TABLE player_skins ADD COLUMN pattern INTEGER');
    } catch {
      // Already present.
    }
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

  // ------------------------------------------------------------ in-game names --

  /**
   * Remembers what each account is calling itself in game.
   *
   * Written on every poll, so a rename is picked up within a minute. The name
   * outlives the session on purpose: a death is reported for somebody who may
   * already be gone, and `\`4f2a1c\`` tells nobody anything.
   */
  rememberNames(players: Array<{ steamId: string; name: string }>): void {
    const now = new Date().toISOString();
    const stmt = this.#db.prepare(
      `INSERT INTO player_names (steam_id, name, seen_at) VALUES (?, ?, ?)
       ON CONFLICT (steam_id) DO UPDATE SET name = excluded.name,
                                            seen_at = excluded.seen_at`,
    );
    for (const player of players) {
      const name = player.name?.trim();
      if (!name || !player.steamId) continue;
      stmt.run(player.steamId, name, now);
    }
  }

  gameName(steamId: string): string | null {
    const row = this.#db
      .prepare('SELECT name FROM player_names WHERE steam_id = ?')
      .get(steamId) as Record<string, unknown> | undefined;
    return row ? String(row['name']) : null;
  }

  // ---------------------------------------------------------- how busy it was --

  recordCount(online: number): void {
    this.#db
      .prepare('INSERT INTO player_counts (at, online) VALUES (?, ?)')
      .run(new Date().toISOString(), online);
  }

  /** The busiest single reading since a moment, and when it happened. */
  peakSince(since: Date): { online: number; at: string } | null {
    const row = this.#db
      .prepare(
        `SELECT online, at FROM player_counts
         WHERE at >= ? ORDER BY online DESC, at ASC LIMIT 1`,
      )
      .get(since.toISOString()) as Record<string, unknown> | undefined;
    return row ? { online: Number(row['online']), at: String(row['at']) } : null;
  }

  /** Every reading since a moment, oldest first, for bucketing into a chart. */
  countsSince(since: Date): Array<{ at: string; online: number }> {
    return (this.#db
      .prepare('SELECT at, online FROM player_counts WHERE at >= ? ORDER BY at ASC')
      .all(since.toISOString()) as Array<Record<string, unknown>>)
      .map((r) => ({ at: String(r['at']), online: Number(r['online']) }));
  }

  /** Keeps the table from growing forever; nothing asks beyond a month. */
  pruneCounts(before: Date): number {
    const result = this.#db
      .prepare('DELETE FROM player_counts WHERE at < ?')
      .run(before.toISOString());
    return Number(result.changes ?? 0);
  }

  // ------------------------------------------------------------- referrals --

  /** First invite wins. Someone who leaves and rejoins keeps their original. */
  recordReferral(inviteeDiscord: string, inviterDiscord: string): void {
    this.#db
      .prepare(
        `INSERT INTO referrals (invitee_discord, inviter_discord, joined_at)
         VALUES (?, ?, ?) ON CONFLICT (invitee_discord) DO NOTHING`,
      )
      .run(inviteeDiscord, inviterDiscord, new Date().toISOString());
  }

  referralFor(inviteeDiscord: string): Referral | null {
    const row = this.#db
      .prepare('SELECT * FROM referrals WHERE invitee_discord = ?')
      .get(inviteeDiscord) as Record<string, unknown> | undefined;
    return row ? toReferral(row) : null;
  }

  /**
   * Ties a Steam account to a referral when the invitee links.
   *
   * Returns false when that Steam account has already been referred — the
   * unique index rejects it, which is the point: the account, not the Discord
   * user, is what a reward is owed against.
   */
  attachReferralSteam(inviteeDiscord: string, steamId: string): boolean {
    try {
      const result = this.#db
        .prepare(
          `UPDATE referrals SET invitee_steam = ?
           WHERE invitee_discord = ? AND invitee_steam IS NULL`,
        )
        .run(steamId, inviteeDiscord);
      return Number(result.changes ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /** Linked, played, not yet paid — the queue the payout check walks. */
  pendingReferrals(): Referral[] {
    return (this.#db
      .prepare(
        `SELECT * FROM referrals
         WHERE invitee_steam IS NOT NULL AND paid_at IS NULL
         ORDER BY joined_at ASC`,
      )
      .all() as Array<Record<string, unknown>>).map(toReferral);
  }

  markReferralPaid(inviteeDiscord: string, reward: number): void {
    this.#db
      .prepare('UPDATE referrals SET paid_at = ?, reward = ? WHERE invitee_discord = ?')
      .run(new Date().toISOString(), reward, inviteeDiscord);
  }

  /** How many this inviter has been paid for since a moment, for the cap. */
  paidReferralsSince(inviterDiscord: string, since: Date): number {
    const row = this.#db
      .prepare(
        `SELECT COUNT(*) AS n FROM referrals
         WHERE inviter_discord = ? AND paid_at IS NOT NULL AND paid_at >= ?`,
      )
      .get(inviterDiscord, since.toISOString()) as Record<string, unknown> | undefined;
    return Number(row?.['n'] ?? 0);
  }

  referralLeaderboard(limit: number): Array<{ inviterDiscord: string; count: number }> {
    return (this.#db
      .prepare(
        `SELECT inviter_discord, COUNT(*) AS n FROM referrals
         WHERE paid_at IS NOT NULL
         GROUP BY inviter_discord ORDER BY n DESC LIMIT ?`,
      )
      .all(limit) as Array<Record<string, unknown>>)
      .map((r) => ({ inviterDiscord: String(r['inviter_discord']), count: Number(r['n']) }));
  }

  referralCounts(): { total: number; paid: number; pending: number } {
    const one = (sql: string): number => {
      const row = this.#db.prepare(sql).get() as Record<string, unknown> | undefined;
      return Number(row?.['n'] ?? 0);
    };
    return {
      total: one('SELECT COUNT(*) AS n FROM referrals'),
      paid: one('SELECT COUNT(*) AS n FROM referrals WHERE paid_at IS NOT NULL'),
      pending: one(
        'SELECT COUNT(*) AS n FROM referrals WHERE paid_at IS NULL AND invitee_steam IS NOT NULL'),
    };
  }

  // -------------------------------------------------------- skin baselines --

  /** Only ever written once per dinosaur: a second paint must not overwrite it. */
  setBaseline(
    steamId: string,
    species: string,
    colours: Record<string, string>,
    pattern?: number,
  ): boolean {
    return Number(
      this.#db
        .prepare(
          `INSERT INTO skin_baseline (steam_id, species, colours, pattern, taken_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (steam_id, species) DO NOTHING`,
        )
        .run(steamId, species, JSON.stringify(colours), pattern ?? null,
          new Date().toISOString()).changes,
    ) > 0;
  }

  baselineFor(
    steamId: string,
    species: string,
  ): { colours: Record<string, string>; pattern?: number } | null {
    const row = this.#db
      .prepare('SELECT colours, pattern FROM skin_baseline WHERE steam_id = ? AND species = ?')
      .get(steamId, species) as Record<string, unknown> | undefined;
    if (!row) return null;

    try {
      const colours = JSON.parse(String(row['colours'])) as Record<string, string>;
      const pattern = row['pattern'];
      return typeof pattern === 'number' ? { colours, pattern } : { colours };
    } catch {
      return null;
    }
  }

  clearBaseline(steamId: string, species?: string): number {
    return Number(
      species === undefined
        ? this.#db.prepare('DELETE FROM skin_baseline WHERE steam_id = ?').run(steamId).changes
        : this.#db
          .prepare('DELETE FROM skin_baseline WHERE steam_id = ? AND species = ?')
          .run(steamId, species).changes,
    );
  }

  // ------------------------------------------------------------ owned skins --

  /** Returns false when they already had it, so a grant can say so honestly. */
  grantSkin(steamId: string, preset: string, source: string): boolean {
    return Number(
      this.#db
        .prepare(
          `INSERT INTO owned_skins (steam_id, preset, granted_at, source)
           VALUES (?, ?, ?, ?) ON CONFLICT (steam_id, preset) DO NOTHING`,
        )
        .run(steamId, preset, new Date().toISOString(), source).changes,
    ) > 0;
  }

  revokeSkin(steamId: string, preset: string): boolean {
    return Number(
      this.#db
        .prepare('DELETE FROM owned_skins WHERE steam_id = ? AND preset = ?')
        .run(steamId, preset).changes,
    ) > 0;
  }

  ownsSkin(steamId: string, preset: string): boolean {
    return this.#db
      .prepare('SELECT 1 FROM owned_skins WHERE steam_id = ? AND preset = ?')
      .get(steamId, preset) !== undefined;
  }

  ownedSkins(steamId: string): Array<{ preset: string; grantedAt: string; source: string }> {
    return (this.#db
      .prepare(
        `SELECT preset, granted_at, source FROM owned_skins
         WHERE steam_id = ? ORDER BY granted_at ASC`,
      )
      .all(steamId) as Array<Record<string, unknown>>)
      .map((r) => ({
        preset: String(r['preset']),
        grantedAt: String(r['granted_at']),
        source: String(r['source'] ?? ''),
      }));
  }

  /** Everyone holding one, for staff to see who has what. */
  skinOwners(preset: string): string[] {
    return (this.#db
      .prepare('SELECT steam_id FROM owned_skins WHERE preset = ? ORDER BY granted_at ASC')
      .all(preset) as Array<Record<string, unknown>>)
      .map((r) => String(r['steam_id']));
  }

  // -------------------------------------------------------- species roster --

  /** Only ever adds. A species missing from the live menu is hidden, not gone. */
  rememberSpecies(names: string[]): number {
    const stmt = this.#db.prepare(
      `INSERT INTO known_species (name, first_seen) VALUES (?, ?)
       ON CONFLICT (name) DO NOTHING`,
    );
    const now = new Date().toISOString();
    let added = 0;
    for (const name of names) {
      if (!name || !/^[A-Za-z]{3,}$/.test(name)) continue;
      added += Number(stmt.run(name, now).changes);
    }
    return added;
  }

  knownSpecies(): string[] {
    return (this.#db
      .prepare('SELECT name FROM known_species ORDER BY name ASC')
      .all() as Array<Record<string, unknown>>)
      .map((r) => String(r['name']));
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
  setSkin(steamId: string, species: string, colours: Record<string, string>): void {
    const merged = { ...(this.skinFor(steamId, species) ?? {}), ...colours };
    this.#db
      .prepare(
        `INSERT INTO player_skins (steam_id, species, colours, set_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (steam_id, species) DO UPDATE SET colours = excluded.colours,
                                                       set_at = excluded.set_at`,
      )
      .run(steamId, species, JSON.stringify(merged), new Date().toISOString());
  }

  skinFor(steamId: string, species: string): Record<string, string> | null {
    const row = this.#db
      .prepare('SELECT colours FROM player_skins WHERE steam_id = ? AND species = ?')
      .get(steamId, species) as Record<string, unknown> | undefined;
    if (!row) return null;
    try {
      return JSON.parse(String(row['colours'])) as Record<string, string>;
    } catch {
      return null;
    }
  }

  /** Species omitted clears every look they have. */
  clearSkin(steamId: string, species?: string): number {
    return Number(
      species === undefined
        ? this.#db.prepare('DELETE FROM player_skins WHERE steam_id = ?').run(steamId).changes
        : this.#db
            .prepare('DELETE FROM player_skins WHERE steam_id = ? AND species = ?')
            .run(steamId, species).changes,
    );
  }

  /**
   * Marks a look as still in use, because it was just repainted onto a live
   * dinosaur. Expiry counts from here rather than from when it was set, so a
   * dinosaur somebody is actually playing never expires under them.
   */
  touchSkin(steamId: string, species: string): void {
    this.#db
      .prepare('UPDATE player_skins SET set_at = ? WHERE steam_id = ? AND species = ?')
      .run(new Date().toISOString(), steamId, species);
  }

  /**
   * Forgets looks nobody has worn for a while.
   *
   * A skin belongs to a dinosaur, and a dinosaur that has not been seen for
   * hours is gone — logged off, or died somewhere the death poll missed.
   * Without this, a colour set once was reapplied to the next animal of that
   * species days later, which is what players actually notice and complain
   * about. Clearing on death alone is not enough, because a death is only
   * cleared when it is *detected*.
   */
  expireSkins(olderThanMs: number): number {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    return Number(
      this.#db.prepare('DELETE FROM player_skins WHERE set_at < ?').run(cutoff).changes,
    );
  }

  /** Null when they have never been given one, so the game's own is left alone. */
  setPattern(steamId: string, species: string, pattern: number | null): void {
    this.#db
      .prepare(
        `INSERT INTO player_skins (steam_id, species, colours, set_at, pattern)
         VALUES (?, ?, '{}', ?, ?)
         ON CONFLICT (steam_id, species) DO UPDATE SET pattern = excluded.pattern,
                                                       set_at = excluded.set_at`,
      )
      .run(steamId, species, new Date().toISOString(), pattern);
  }

  patternFor(steamId: string, species: string): number | null {
    const row = this.#db
      .prepare('SELECT pattern FROM player_skins WHERE steam_id = ? AND species = ?')
      .get(steamId, species) as Record<string, unknown> | undefined;
    const value = row?.['pattern'];
    return typeof value === 'number' ? value : null;
  }

  skinSpecies(steamId: string): string[] {
    const rows = this.#db
      .prepare('SELECT species FROM player_skins WHERE steam_id = ? ORDER BY species')
      .all(steamId) as Array<Record<string, unknown>>;
    return rows.map((row) => String(row['species']));
  }

  // ---- skin presets ------------------------------------------------------

  savePreset(
    name: string,
    look: { colours: Record<string, string>; pattern?: number },
    madeBy: string,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO skin_presets (name, colours, made_by, made_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET colours = excluded.colours,
                                          made_by = excluded.made_by,
                                          made_at = excluded.made_at`,
      )
      .run(name, JSON.stringify(look), madeBy, new Date().toISOString());
  }

  /**
   * Tolerates the original shape, which was a bare map of field to hex with no
   * pattern — presets saved before patterns existed still load.
   */
  preset(name: string): { colours: Record<string, string>; pattern?: number } | null {
    const row = this.#db
      .prepare('SELECT colours FROM skin_presets WHERE name = ?')
      .get(name) as Record<string, unknown> | undefined;
    if (!row) return null;

    try {
      const parsed = JSON.parse(String(row['colours'])) as Record<string, unknown>;
      if (parsed['colours'] && typeof parsed['colours'] === 'object') {
        const pattern = parsed['pattern'];
        return {
          colours: parsed['colours'] as Record<string, string>,
          ...(typeof pattern === 'number' ? { pattern } : {}),
        };
      }
      return { colours: parsed as Record<string, string> };
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

  /**
   * Case-insensitive on purpose.
   *
   * The table is keyed by name and SQLite compares keys case-sensitively, so a
   * mis-typed `tyrannosaurus` sits alongside `Tyrannosaurus` as its own row and
   * never matches a live count. Clearing is how that gets fixed, and refusing
   * because the case is wrong is how it stays stuck.
   */
  removeSpeciesCap(species: string): boolean {
    return Number(
      this.#db
        .prepare('DELETE FROM species_caps WHERE species = ? COLLATE NOCASE')
        .run(species).changes,
    ) > 0;
  }

  setSpeciesLocked(species: string, locked: boolean): void {
    this.#db
      .prepare('UPDATE species_caps SET locked = ? WHERE species = ?')
      .run(locked ? 1 : 0, species);
  }

  // ---- founders ------------------------------------------------------------

  founderCount(): number {
    return Number(
      (this.#db.prepare('SELECT COUNT(*) AS n FROM founders').get() as { n: number }).n,
    );
  }

  founderSkin(discordId: string): string | null {
    const row = this.#db
      .prepare('SELECT skin FROM founders WHERE discord_id = ?')
      .get(discordId) as Record<string, unknown> | undefined;
    return row ? String(row['skin']) : null;
  }

  /**
   * Takes a slot, or returns false because they are gone.
   *
   * Counting and inserting have to be one statement. Two people pressing the
   * last button together would both read 49, both pass a separate check, and
   * both claim — so the limit is enforced inside the INSERT itself.
   */
  claimFounder(discordId: string, skin: string, limit: number): boolean {
    return Number(
      this.#db
        .prepare(
          `INSERT INTO founders (discord_id, skin, claimed_at)
           SELECT ?, ?, ?
           WHERE (SELECT COUNT(*) FROM founders) < ?
           ON CONFLICT (discord_id) DO NOTHING`,
        )
        .run(discordId, skin, Date.now(), limit).changes,
    ) > 0;
  }

  /**
   * Newest first: the interesting question is usually who just claimed.
   *
   * Tie-broken on rowid, because two people pressing the button together land
   * in the same millisecond and `claimed_at` alone leaves their order to
   * whatever SQLite feels like — which is not an ordering anybody can explain.
   */
  founders(limit = 50): Array<{ discordId: string; skin: string; claimedAt: number }> {
    return (this.#db
      .prepare(`SELECT discord_id, skin, claimed_at FROM founders
                ORDER BY claimed_at DESC, rowid DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>)
      .map((row) => ({
        discordId: String(row['discord_id']),
        skin: String(row['skin']),
        claimedAt: Number(row['claimed_at']),
      }));
  }

  /** Staff correction only: a claim is meant to be permanent. */
  releaseFounder(discordId: string): boolean {
    return Number(
      this.#db.prepare('DELETE FROM founders WHERE discord_id = ?').run(discordId).changes,
    ) > 0;
  }

  // ---- backup --------------------------------------------------------------

  /**
   * Every table this database has.
   *
   * Read from the schema rather than listed anywhere, because a hand-written
   * list is what a future feature forgets to update - and a backup missing one
   * table is only discovered on the day it is needed.
   */
  tableNames(): string[] {
    return (this.#db
      .prepare(`SELECT name FROM sqlite_master
                WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as Array<Record<string, unknown>>)
      .map((row) => String(row['name']));
  }

  dumpTable(table: string): Array<Record<string, unknown>> {
    this.#assertKnownTable(table);
    return this.#db.prepare(`SELECT * FROM "${table}"`)
      .all() as Array<Record<string, unknown>>;
  }

  /**
   * Empties a table and refills it from a snapshot. Returns rows written.
   *
   * Columns come from the rows themselves and are checked against the live
   * schema, so a snapshot taken before a column existed still restores what it
   * does have rather than failing outright.
   */
  replaceTable(table: string, rows: Array<Record<string, unknown>>): number {
    this.#assertKnownTable(table);

    const live = new Set(
      (this.#db.prepare(`PRAGMA table_info("${table}")`)
        .all() as Array<Record<string, unknown>>).map((c) => String(c['name'])),
    );

    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))]
      .filter((c) => live.has(c));

    // Explicit BEGIN/COMMIT: node:sqlite has no transaction() wrapper, and a
    // restore that empties a table and then fails halfway is worse than one
    // that does not run at all.
    this.#db.exec('BEGIN');
    try {
      this.#db.prepare(`DELETE FROM "${table}"`).run();

      let written = 0;
      if (rows.length > 0 && columns.length > 0) {
        const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) `
          + `VALUES (${columns.map(() => '?').join(', ')})`;
        const insert = this.#db.prepare(sql);

        for (const row of rows) {
          insert.run(...columns.map((c) => (row[c] ?? null) as never));
          written += 1;
        }
      }

      this.#db.exec('COMMIT');
      return written;
    } catch (err) {
      // Rolled back, so the table still holds what it did before. A restore
      // that empties a table and then fails is the worst outcome available:
      // the snapshot did not go in and the live data is gone too.
      this.#db.exec('ROLLBACK');
      throw new Error(
        `restoring ${table} failed, and it was left untouched: `
        + (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  /** Table names reach SQL by interpolation, so they must come from the schema. */
  #assertKnownTable(table: string): void {
    if (!this.tableNames().includes(table)) {
      throw new Error(`unknown table: ${table}`);
    }
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

  // ---- managed Game.ini settings -----------------------------------------

  /**
   * Single Game.ini keys the bot keeps at a chosen value. Stored under a
   * prefix so the reconciler can find them without a second table.
   */
  managedGameSettings(): Array<{ key: string; value: string }> {
    const rows = this.#db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'gameini:%'")
      .all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      key: String(row['key']).slice('gameini:'.length),
      value: String(row['value']),
    }));
  }

  setManagedGameSetting(key: string, value: string): void {
    this.setSetting(`gameini:${key}`, value);
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
