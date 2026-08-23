import type { Config } from './config.js';
import type { Ctx } from './commands.js';
export interface BackupConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
}
export declare function backupConfig(config: Config): BackupConfig | null;
export interface BackupResult {
    takenAt: number;
    tables: number;
    rows: number;
}
/**
 * Writes a snapshot. Returns what it wrote.
 *
 * Throws on failure rather than swallowing: a backup that quietly does nothing
 * is the worst possible outcome, since it is indistinguishable from a working
 * one until the day it matters.
 */
export declare function runBackup(ctx: Ctx, cfg: BackupConfig): Promise<BackupResult>;
export interface Snapshot {
    takenAt: number;
    tables: number;
    rows: number;
}
export declare function listSnapshots(cfg: BackupConfig): Promise<Snapshot[]>;
/**
 * Puts a snapshot back.
 *
 * Destructive by definition: every table in the snapshot is emptied and
 * refilled. Guarded behind an explicit confirmation at the command layer, since
 * the failure mode is losing whatever has happened since the snapshot.
 */
export declare function restoreSnapshot(ctx: Ctx, cfg: BackupConfig, takenAt: number): Promise<{
    tables: number;
    rows: number;
}>;
export declare function lastBackup(ctx: Ctx): number;
export declare function markBackup(ctx: Ctx, at: number): void;
export declare function backupEveryHours(ctx: Ctx): number;
export declare function setBackupEveryHours(ctx: Ctx, hours: number): void;
export declare function startBackupScheduler(ctx: Ctx, cfg: BackupConfig, log: (m: string) => void): void;
