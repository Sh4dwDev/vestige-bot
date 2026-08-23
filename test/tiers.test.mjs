// Species tiers, and what they pay. Tiers are server policy rather than
// anything the game knows about, so the defaults must be overridable and the
// kill maths must not quietly reward the wrong side.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { tierOf, setTier, multiplierFor, setMultiplier, killReward } = await load('tiers.js');
const { awardFor, awardOnline } = await load('points.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 't.sqlite');
const db = new Database(file);
const ctx = { db };

// ---- the agreed defaults ------------------------------------------------------

check('Rex is apex', tierOf(ctx, 'Tyrannosaurus') === 4);
check('Deinosuchus is apex', tierOf(ctx, 'Deinosuchus') === 4);
check('Trike is apex, as asked', tierOf(ctx, 'Triceratops') === 4, String(tierOf(ctx, 'Triceratops')));
check('Allosaurus is tier 3', tierOf(ctx, 'Allosaurus') === 3);
check('Carnotaurus is tier 2', tierOf(ctx, 'Carnotaurus') === 2);
check('Dryosaurus is tier 1', tierOf(ctx, 'Dryosaurus') === 1);

// A species the game adds later must not break anything.
check('an unknown species falls to tier 1', tierOf(ctx, 'Somethingnew') === 1);

// ---- overrides ----------------------------------------------------------------

setTier(ctx, 'Dryosaurus', 3);
check('an override wins over the default', tierOf(ctx, 'Dryosaurus') === 3);
check('overriding one leaves the others alone', tierOf(ctx, 'Hypsilophodon') === 1);

setMultiplier(ctx, 1, 5);
check('a multiplier can be overridden', multiplierFor(ctx, 1) === 5);
check('other tiers keep their defaults', multiplierFor(ctx, 4) === 3);
setMultiplier(ctx, 1, 1);
setTier(ctx, 'Dryosaurus', 1);

// ---- what a kill pays ---------------------------------------------------------

{
  const equal = killReward(ctx, 4, 4);
  const punchUp = killReward(ctx, 1, 4);
  const punchDown = killReward(ctx, 4, 1);

  check('a bigger victim pays more', killReward(ctx, 2, 4).points > killReward(ctx, 2, 1).points);
  check('killing up pays more than an even fight', punchUp.points > equal.points,
    `${punchUp.points} vs ${equal.points}`);
  check('the upset size is reported', punchUp.upset === 3, String(punchUp.upset));
  check('killing down is no upset', punchDown.upset === 0);
  check('killing down still pays something', punchDown.points > 0);
  check('an even fight is not an upset', equal.upset === 0);
}

// ---- earning while playing -----------------------------------------------------

{
  const minute = 60_000;
  const rate = 60;
  const base = awardFor(minute, rate).points;

  db.setPoints('76561198000000001', 0);
  db.setPoints('76561198000000002', 0);

  awardOnline(ctx, [
    { steam: '76561198000000001', species: 'Tyrannosaurus', growth: 1, female: false, prime: false },
    { steam: '76561198000000002', species: 'Dryosaurus', growth: 1, female: false, prime: false },
    // A fixed Wednesday: the weekend bonus is added on top of the multipliers,
    // so running this on a Saturday would fail on the calendar rather than on
    // the maths.
  ], minute, new Date('2026-08-19T10:00:00Z'));

  const apex = db.pointsFor('76561198000000001').balance;
  const small = db.pointsFor('76561198000000002').balance;

  check('an apex earns its multiplier', Math.abs(apex - base * 3) < 1e-9, String(apex));
  check('a tier 1 earns the base rate', Math.abs(small - base) < 1e-9, String(small));
  check('higher tiers earn more', apex > small);
}

{
  // Someone on the spawn screen has no species, so there is nothing to pay.
  db.setPoints('76561198000000003', 0);
  awardOnline(ctx, [{ species: 'Tyrannosaurus', growth: 1, female: false, prime: false }], 60_000);
  check('a row with no steam id pays nobody', db.pointsFor('76561198000000003').balance === 0);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
