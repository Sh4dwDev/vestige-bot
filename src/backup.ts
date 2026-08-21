import mysql from 'mysql2/promise';

import type { Config } from './config.js';
import type { Ctx } from './commands.js';

/**
 * Backing the database up somewhere the file system cannot take with it.
 *
 * Everything the bot knows lives in one SQLite file on the game host: links,
 * points, purchases, founder claims. The boot log has always said whether that
 * file was opened or created, precisely because a host wiping its data
 * directory looks — from Discord — exactly like the bot forgetting everybody.
 * Until now there was nothing behind that warning.
 *
 * PebbleHost hands out a MySQL database alongside the file store, which is a
 * different subsystem on the same host. That is not off-site, and it will not
 * survive the account going away, but it does survive the thing that actually
 * happens: a wiped or rolled-back data directory.
 *
 * **Every table, generically.** Tables are read from `sqlite_master` rather
 * than listed here, because a list is something a future feature forgets to
 * update — and a backup missing one table is discovered only when it is needed.
 *
 * **One row per snapshot per table**, holding JSON. No schema mirroring: the
 * shapes would drift, and a restore that half-matches is worse than none.
 */

const KEEP = 14;

export interface BackupConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export function backupConfig(config: Config): BackupConfig | null {
  const host = process.env['MYSQL_HOST']?.trim();
  const user = process.env['MYSQL_USER']?.trim();
  const password = process.env['MYSQL_PASSWORD'];
  const database = process.env['MYSQL_DATABASE']?.trim();
  if (!host || !user || password === undefined || !database) return null;

  void config;
  return {
    host,
    port: Number.parseInt(process.env['MYSQL_PORT'] ?? '3306', 10) || 3306,
    user,
    password,
    database,
  };
}

export interface BackupResult {
  takenAt: number;
  tables: number;
  rows: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vesta_backups (
  id        BIGINT AUTO_INCREMENT PRIMARY KEY,
  taken_at  BIGINT NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  rows_json LONGTEXT NOT NULL,
  row_count INT NOT NULL,
  INDEX taken_at_idx (taken_at)
)`;

/**
 * Writes a snapshot. Returns what it wrote.
 *
 * Throws on failure rather than swallowing: a backup that quietly does nothing
 * is the worst possible outcome, since it is indistinguishable from a working
 * one until the day it matters.
 */
export async function runBackup(ctx: Ctx, cfg: BackupConfig): Promise<BackupResult> {
  const takenAt = Date.now();
  const tables = ctx.db.tableNames();

  const conn = await mysql.createConnection({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    // Snapshots are one big string each; the default limit is too small.
    maxPreparedStatements: 1,
  });

  try {
    await conn.query(SCHEMA);

    let rows = 0;
    for (const table of tables) {
      const data = ctx.db.dumpTable(table);
      rows += data.length;
      await conn.execute(
        'INSERT INTO vesta_backups (taken_at, table_name, rows_json, row_count) VALUES (?, ?, ?, ?)',
        [takenAt, table, JSON.stringify(data), data.length],
      );
    }

    // Prune by snapshot, not by row: deleting the oldest N rows would leave a
    // snapshot with half its tables, which restores into a mess.
    const [old] = await conn.query(
      'SELECT DISTINCT taken_at FROM vesta_backups ORDER BY taken_at DESC LIMIT ?, 18446744073709551615',
      [KEEP],
    ) as [Array<{ taken_at: number }>, unknown];

    for (const row of old) {
      await conn.execute('DELETE FROM vesta_backups WHERE taken_at = ?', [row.taken_at]);
    }

    return { takenAt, tables: tables.length, rows };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

export interface Snapshot {
  takenAt: number;
  tables: number;
  rows: number;
}

export async function listSnapshots(cfg: BackupConfig): Promise<Snapshot[]> {
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user,
    password: cfg.password, database: cfg.database,
  });

  try {
    await conn.query(SCHEMA);
    const [rows] = await conn.query(
      `SELECT taken_at, COUNT(*) AS tables_count, SUM(row_count) AS rows_count
       FROM vesta_backups GROUP BY taken_at ORDER BY taken_at DESC LIMIT 20`,
    ) as [Array<Record<string, unknown>>, unknown];

    return rows.map((row) => ({
      takenAt: Number(row['taken_at']),
      tables: Number(row['tables_count']),
      rows: Number(row['rows_count']),
    }));
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/**
 * Puts a snapshot back.
 *
 * Destructive by definition: every table in the snapshot is emptied and
 * refilled. Guarded behind an explicit confirmation at the command layer, since
 * the failure mode is losing whatever has happened since the snapshot.
 */
export async function restoreSnapshot(
  ctx: Ctx,
  cfg: BackupConfig,
  takenAt: number,
): Promise<{ tables: number; rows: number }> {
  const conn = await mysql.createConnection({
    host: cfg.host, port: cfg.port, user: cfg.user,
    password: cfg.password, database: cfg.database,
  });

  try {
    const [rows] = await conn.query(
      'SELECT table_name, rows_json FROM vesta_backups WHERE taken_at = ?',
      [takenAt],
    ) as [Array<Record<string, unknown>>, unknown];

    if (rows.length === 0) throw new Error(`no snapshot taken at ${takenAt}`);

    let restored = 0;
    for (const row of rows) {
      const table = String(row['table_name']);
      const data = JSON.parse(String(row['rows_json'])) as Array<Record<string, unknown>>;
      restored += ctx.db.replaceTable(table, data);
    }

    return { tables: rows.length, rows: restored };
  } finally {
    await conn.end().catch(() => undefined);
  }
}

// --------------------------------------------------------------- scheduler --

const LAST_KEY = 'backup_last';

export function lastBackup(ctx: Ctx): number {
  return Number.parseInt(ctx.db.getSetting(LAST_KEY) ?? '', 10) || 0;
}

export function markBackup(ctx: Ctx, at: number): void {
  ctx.db.setSetting(LAST_KEY, String(at));
}

/**
 * Once a day, and once shortly after boot if the last one is stale.
 *
 * Deliberately not on a fixed clock time: the bot restarts often enough that a
 * midnight-only schedule would be missed whenever it happened to be down then,
 * and nobody would notice until the backup was needed.
 */
export function startBackupScheduler(ctx: Ctx, cfg: BackupConfig, log: (m: string) => void): void {
  const DAY = 24 * 3_600_000;

  const tick = async (): Promise<void> => {
    if (Date.now() - lastBackup(ctx) < DAY) return;
    try {
      const result = await runBackup(ctx, cfg);
      markBackup(ctx, result.takenAt);
      log(`backup: ${result.rows} row(s) across ${result.tables} table(s)`);
    } catch (err) {
      log(`backup: FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Not immediately: boot is busy, and a failure here should not be tangled up
  // with everything else starting.
  setTimeout(() => void tick(), 60_000).unref();
  setInterval(() => void tick(), 3_600_000).unref();
}
