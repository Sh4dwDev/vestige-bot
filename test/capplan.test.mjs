// The starting cap table. These are balance decisions, so the test states the
// intent: apexes scarce, the bottom tier generous enough that a late arrival
// always has something to spawn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);
const { PER_HUNDRED, planCaps, applyCaps } =
  await import(pathToFileURL(path.join(root, 'dist/capplan.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'cp.sqlite');
const db = new Database(file);
const ctx = { db };

// Exactly what the live server reports.
const AVAILABLE = ['Allosaurus', 'Austroraptor', 'Beipiaosaurus', 'Carnotaurus',
  'Ceratosaurus', 'Deinosuchus', 'Diabloceratops', 'Dilophosaurus', 'Dryosaurus',
  'Gallimimus', 'Herrerasaurus', 'Hypsilophodon', 'Kentrosaurus', 'Maiasaura',
  'Omniraptor', 'Pachycephalosaurus', 'Pteranodon', 'Stegosaurus', 'Tenontosaurus',
  'Triceratops', 'Troodon', 'Tyrannosaurus'];

const at100 = planCaps(ctx, 100, AVAILABLE);
const capOf = (plan, species) => plan.find((e) => e.species === species)?.cap;

check('every species the server has is given a cap', at100.length === AVAILABLE.length,
  `${at100.length} of ${AVAILABLE.length}`);
check('at 100 slots the caps are the table verbatim',
  at100.every((e) => e.cap === PER_HUNDRED[e.species]));

// The balance itself.
check('a Rex is the scarcest thing on the island', capOf(at100, 'Tyrannosaurus') === 5,
  String(capOf(at100, 'Tyrannosaurus')));
check('apexes are all scarce',
  ['Tyrannosaurus', 'Deinosuchus', 'Triceratops'].every((s) => capOf(at100, s) <= 10));
check('the fallback species are generous',
  capOf(at100, 'Dryosaurus') >= 20 && capOf(at100, 'Hypsilophodon') >= 20);
check('an apex is scarcer than the fallback it hunts',
  capOf(at100, 'Tyrannosaurus') < capOf(at100, 'Dryosaurus'));
check('fliers are held below their tier', capOf(at100, 'Pteranodon') <= 10);

{
  // Caps are not a queue: if they summed to the slot count, a full server would
  // have nothing left to spawn at all.
  const total = at100.reduce((sum, e) => sum + e.cap, 0);
  check('the caps add up to well over the slot count', total > 200, String(total));
  check('but not so high that the apex caps stop mattering', total < 400, String(total));
}

{
  const tiers = new Map();
  for (const e of at100) tiers.set(e.tier, (tiers.get(e.tier) ?? 0) + e.cap);
  check('the bottom tier has more room than the top',
    tiers.get(1) > tiers.get(4), `tier1=${tiers.get(1)} tier4=${tiers.get(4)}`);
}

// Scaling to the real slot count.
{
  const at50 = planCaps(ctx, 50, AVAILABLE);
  check('halving the slots halves the caps', capOf(at50, 'Dryosaurus') === 10,
    String(capOf(at50, 'Dryosaurus')));
  check('scaling keeps apexes scarce', capOf(at50, 'Tyrannosaurus') <= 3,
    String(capOf(at50, 'Tyrannosaurus')));
  check('a tiny server still allows one of everything',
    planCaps(ctx, 5, AVAILABLE).every((e) => e.cap >= 1));
  check('a cap is never zero, which would lock a species forever',
    planCaps(ctx, 1, AVAILABLE).every((e) => e.cap > 0));
}

{
  const at200 = planCaps(ctx, 200, AVAILABLE);
  check('doubling the slots doubles the caps', capOf(at200, 'Tyrannosaurus') === 10);
}

// A species this build does not have must not get a row: it could never
// unlock, and it would show in the panel as something nobody can play.
{
  const plan = planCaps(ctx, 100, ['Tyrannosaurus', 'Dryosaurus']);
  check('only species the server reports are capped', plan.length === 2,
    plan.map((e) => e.species).join(','));
  check('an unknown playable list falls back to the whole table',
    planCaps(ctx, 100, []).length === Object.keys(PER_HUNDRED).length);
}

check('the plan is ordered apex first', at100[0].tier === 4);

// Writing it.
applyCaps(ctx, at100);
const stored = db.speciesCaps();
check('applying writes every cap', stored.length === at100.length);
check('a stored cap matches the plan',
  stored.find((c) => c.species === 'Tyrannosaurus')?.cap === 5);
check('a fresh cap starts unlocked', stored.every((c) => c.locked === false));

db.setSpeciesLocked('Tyrannosaurus', true);
applyCaps(ctx, planCaps(ctx, 200, AVAILABLE));
check('re-applying updates the number',
  db.speciesCaps().find((c) => c.species === 'Tyrannosaurus')?.cap === 10);
check('re-applying does not silently unlock what is full',
  db.speciesCaps().find((c) => c.species === 'Tyrannosaurus')?.locked === true);

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
