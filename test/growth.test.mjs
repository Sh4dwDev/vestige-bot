// The growth floor: grow everybody to a size, and keep them there as they
// respawn. The rules that matter are that it never shrinks anybody and never
// asks the server about somebody it does not need to.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { growthFloor, setGrowthFloor, belowFloor, runGrowthFloor } = await load('growth.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const fresh = () => new Database(
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'growth.sqlite'));

const at = (steam, growth) => ({ steam, species: 'Rex', growth, female: false, prime: false });

// ---- the setting ------------------------------------------------------------

{
  const db = fresh();
  const ctx = { db };

  check('off by default', growthFloor(ctx) === null);

  setGrowthFloor(ctx, 80, true);
  check('a floor reads back', growthFloor(ctx).growth === 0.8,
    JSON.stringify(growthFloor(ctx)));
  check('and remembers whether to heal', growthFloor(ctx).heal === true);

  setGrowthFloor(ctx, 60, false);
  check('healing can be off', growthFloor(ctx).heal === false);

  setGrowthFloor(ctx, null);
  check('and it can be switched off', growthFloor(ctx) === null);

  // Nonsense in the database must read as off rather than as a floor of zero,
  // which would try to shrink the whole server.
  db.setSetting('grow_floor_percent', 'banana');
  check('rubbish is off, not zero', growthFloor(ctx) === null);
  db.setSetting('grow_floor_percent', '0');
  check('and so is a percentage out of range', growthFloor(ctx) === null);

  db.close();
}

// ---- who needs growing ------------------------------------------------------

{
  const floor = { growth: 0.8, heal: true };

  const small = belowFloor([at('a', 0.2), at('b', 0.95), at('c', 0.5)], floor);
  check('only those under the floor', small.join(',') === 'a,c', small.join(','));

  // A floor, never a ceiling. Taking size away from somebody who earned it is a
  // different and much worse thing than handing it out.
  check('nobody above it is touched', !belowFloor([at('b', 1)], floor).includes('b'));

  // Growth reads back imprecisely, so somebody at the floor must not be grown
  // every single minute for the rest of the event.
  check('and somebody already at it is left alone',
    belowFloor([at('d', 0.795)], floor).length === 0, JSON.stringify(belowFloor([at('d', 0.795)], floor)));

  check('a player with no growth reported is skipped',
    belowFloor([{ steam: 'e', species: 'Rex' }], floor).length === 0);
  check('and one with no steam id is too',
    belowFloor([{ species: 'Rex', growth: 0.1 }], floor).length === 0);
}

// ---- applying it ------------------------------------------------------------

{
  const db = fresh();
  const calls = [];
  const ctx = {
    db,
    mod: { run: async (verb, steam, args) => { calls.push({ verb, steam, args }); return { ok: true }; } },
  };

  check('off means not a single round trip',
    (await runGrowthFloor(ctx, [at('a', 0.1)], () => {})) === 0 && calls.length === 0);

  setGrowthFloor(ctx, 80, true);
  const grown = await runGrowthFloor(ctx, [at('a', 0.1), at('b', 1)], () => {});

  check('only the small one is grown', grown === 1 && calls.length === 1,
    JSON.stringify(calls));
  check('to the floor', calls[0].args.growth === 0.8, JSON.stringify(calls[0].args));
  check('and filled up, since that was asked for', calls[0].args.heal === true);

  // A pawn mid-transition or an unreachable server must not stop the tick this
  // shares a pass with.
  const throwing = { db, mod: { run: async () => { throw new Error('unreachable'); } } };
  setGrowthFloor(throwing, 80, true);
  let threw = false;
  try {
    await runGrowthFloor(throwing, [at('a', 0.1)], () => {});
  } catch {
    threw = true;
  }
  check('an unreachable server is survivable', !threw);

  db.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
