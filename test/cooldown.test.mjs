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

// A shorter window than the elapsed time means it has already expired. The
// wait matters: with a 1ms window and no pause this can be checked inside the
// same millisecond it was started, which is not expiry, it is a race.
await new Promise((r) => setTimeout(r, 10));
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

// Travel to a friend requires the ARRIVAL POINT to be unhurt. Travelling to
// somebody at half health is travelling into whatever took the other half, so
// without this it is a way to call in reinforcements mid-fight - or to escape
// one by jumping to a friend who is already losing.
{
  const fs4 = await import('node:fs');
  const path4 = await import('node:path');
  const lua4 = fs4.readFileSync(
    path4.join(path4.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''),
      '..', 'mod/DinoStorage/Scripts/main.lua'), 'utf8');
  const tp = lua4.slice(lua4.indexOf('local function handleTeleport'),
    lua4.indexOf('local function handleSkinGet'));

  check('the destination health is read', /GetHealth/.test(tp) && /GetMaxHealth/.test(tp));
  check('and a hurt friend is refused', /they have to be at full health/.test(tp));
  check('the refusal says how hurt they are', /%d%%/.test(tp));
  check('there is a margin, so regen ticks do not read as broken',
    /0\.98/.test(tp), '');
  check('it is checked before anybody is moved',
    tp.indexOf('GetHealth') < tp.indexOf('locationOf(anchor)'));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
