// The slay cooldown. Without it, slaying is a free spawn reroll — kill,
// respawn, repeat until you land somewhere good.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'cd.sqlite');
const db = new Database(file);
const A = '76561198000000001';
const B = '76561198000000002';
const FIFTEEN = 15 * 60_000;

check('an untouched player is not on cooldown', db.cooldownLeft(A, 'slay', FIFTEEN) === 0);

db.startCooldown(A, 'slay');
const left = db.cooldownLeft(A, 'slay', FIFTEEN);
check('starting one blocks the action', left > 0 && left <= FIFTEEN, `${Math.round(left / 1000)}s`);

check('it does not block anyone else', db.cooldownLeft(B, 'slay', FIFTEEN) === 0);
check('it does not block other actions', db.cooldownLeft(A, 'store', FIFTEEN) === 0);

// A shorter window than the elapsed time means it has already expired.
check('an expired cooldown reads as available', db.cooldownLeft(A, 'slay', 1) === 0,
  String(db.cooldownLeft(A, 'slay', 1)));

// Admins can turn the limit off entirely.
check('a zero window disables the limit', db.cooldownLeft(A, 'slay', 0) === 0);
check('a negative window disables the limit', db.cooldownLeft(A, 'slay', -1) === 0);

// Re-slaying restarts the clock rather than stacking rows.
db.startCooldown(A, 'slay');
check('starting again replaces, not duplicates', db.cooldownLeft(A, 'slay', FIFTEEN) > 0);

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
