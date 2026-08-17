// Periodic corpse clearing. The scheduler must fire the wipe once per cycle and
// warn first — a corpse someone is eating is about to vanish.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);
const cleanup = await import(pathToFileURL(path.join(root, 'dist/cleanup.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'cl.sqlite');
const db = new Database(file);
const ctx = { db, rcon: { wipeCorpses: async () => {}, announce: async () => {} } };

check('cleaning up is off until someone asks for it',
  cleanupSettingsOf().enabled === false);
check('the default interval is three hours',
  cleanupSettingsOf().hours === cleanup.DEFAULT_HOURS && cleanup.DEFAULT_HOURS === 3,
  String(cleanup.DEFAULT_HOURS));

cleanup.setCleanupEnabled(ctx, true);
cleanup.setCleanupHours(ctx, 6);
check('the setting survives a read back',
  cleanupSettingsOf().enabled === true && cleanupSettingsOf().hours === 6);

cleanup.setCleanupEnabled(ctx, false);
check('it can be turned off again', cleanupSettingsOf().enabled === false);
check('turning it off keeps the interval', cleanupSettingsOf().hours === 6);

// A stored nonsense value must not produce a schedule of zero-hour steps, which
// would wipe on every tick.
db.setSetting('cleanup_hours', 'abc');
check('a corrupt interval falls back to the default',
  cleanupSettingsOf().hours === cleanup.DEFAULT_HOURS);
db.setSetting('cleanup_hours', '0');
check('a zero interval falls back too, rather than wiping constantly',
  cleanupSettingsOf().hours === cleanup.DEFAULT_HOURS);

// Clock alignment: shared with restarts so the two are predictable together.
{
  const next = cleanup.nextCleanup(new Date('2026-08-16T01:00:00Z'), 3);
  check('the schedule lands on the clock', next.toISOString() === '2026-08-16T03:00:00.000Z',
    next.toISOString());
}

// The wipe itself.
{
  let wiped = 0;
  const ok = await cleanup.wipeNow(
    { rcon: { wipeCorpses: async () => { wiped += 1; } } }, () => {});
  check('wiping asks the server to clear corpses', ok === true && wiped === 1);
}
{
  const ok = await cleanup.wipeNow(
    { rcon: { wipeCorpses: async () => { throw new Error('down'); } } }, () => {});
  check('an unreachable server reports failure rather than throwing', ok === false);
}

function cleanupSettingsOf() {
  return cleanup.cleanupSettings(ctx);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
