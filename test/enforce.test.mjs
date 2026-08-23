// Turning a cap into a real block. The risk here is a species left removed
// with nothing to put it back, so most of this is about recovery.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);
const { diffPlayables, syncPlayables, restoreAllPlayables, enforcementEnabled,
  setEnforcement, enforcementFault } =
  await import(pathToFileURL(path.join(root, 'dist/enforce.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const ALL = ['Tyrannosaurus', 'Deinosuchus', 'Dryosaurus', 'Troodon'];

// ---- the pure diff -------------------------------------------------------
{
  const caps = [
    { species: 'Tyrannosaurus', cap: 5, locked: true },
    { species: 'Dryosaurus', cap: 20, locked: false },
  ];
  const plan = diffPlayables(caps, ALL, ALL);
  check('a locked species is removed', plan.remove.join(',') === 'Tyrannosaurus');
  check('an unlocked one is left alone', !plan.remove.includes('Dryosaurus'));
  check('nothing needs adding when the menu is complete', plan.add.length === 0);
}

{
  // Already removed: the second pass must be a no-op, not a re-send.
  const caps = [{ species: 'Tyrannosaurus', cap: 5, locked: true }];
  const live = ALL.filter((s) => s !== 'Tyrannosaurus');
  const plan = diffPlayables(caps, live, ALL);
  check('an already-removed species is not removed twice', plan.remove.length === 0);
  check('and it is not added back while still locked', plan.add.length === 0);
}

{
  // Unlocking is what puts it back.
  const caps = [{ species: 'Tyrannosaurus', cap: 5, locked: false }];
  const live = ALL.filter((s) => s !== 'Tyrannosaurus');
  const plan = diffPlayables(caps, live, ALL);
  check('unlocking restores it', plan.add.join(',') === 'Tyrannosaurus');
}

{
  // The dangerous case: the bot died while something was locked, and the cap
  // was deleted in the meantime. Nothing references it any more, so only the
  // known-species list can bring it back.
  const live = ALL.filter((s) => s !== 'Deinosuchus');
  const plan = diffPlayables([], live, ALL);
  check('a species removed with no cap left is still restored',
    plan.add.join(',') === 'Deinosuchus');
}

{
  const plan = diffPlayables([{ species: 'Ghostosaurus', cap: 1, locked: true }], ALL, ALL);
  check('a cap for a species the server does not have changes nothing',
    plan.remove.length === 0 && plan.add.length === 0);
}

{
  // Never ask the game for a species it does not have.
  const plan = diffPlayables([], ['Dryosaurus'], ALL);
  check('only known species are ever added back',
    plan.add.every((s) => ALL.includes(s)));
}

// ---- the round trip against a fake server --------------------------------
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'en.sqlite');
const db = new Database(file);

function fakeServer(options = {}) {
  const menu = new Set(ALL);
  const calls = [];
  return {
    menu,
    calls,
    rcon: {
      playables: async () => `[log] Playables\n${[...menu].join(',')},`,
      removePlayable: async (s) => {
        calls.push(`remove:${s}`);
        if (!options.ignoreWrites) menu.delete(s);
      },
      addPlayable: async (s) => {
        calls.push(`add:${s}`);
        if (!options.ignoreWrites) menu.add(s);
      },
      // Modelled on what the real server does: 0x15 does not push the list to
      // clients, it rebuilds it from the base catalogue and empties it. If
      // anything ever calls this again, the checks below go red rather than a
      // live server losing every species.
      updatePlayables: async () => { calls.push('update'); menu.clear(); },
    },
  };
}

{
  const server = fakeServer();
  const ctx = { db, rcon: server.rcon };
  db.setSpeciesCap('Tyrannosaurus', 5);
  db.setSpeciesLocked('Tyrannosaurus', true);

  const result = await syncPlayables(ctx, ALL, () => {});
  check('locking takes it out of the live menu', !server.menu.has('Tyrannosaurus'));
  check('the write is reported as verified', result.verified === true);
  check('UpdatePlayables is never called — it empties the list',
    !server.calls.includes('update'));
  check('everything else is still spawnable',
    ALL.filter((s) => s !== 'Tyrannosaurus').every((s) => server.menu.has(s)),
    [...server.menu].join(','));

  // Idempotence: the population poll runs this every minute.
  const again = await syncPlayables(ctx, ALL, () => {});
  check('a second pass sends nothing', again.remove.length === 0 && again.add.length === 0);

  db.setSpeciesLocked('Tyrannosaurus', false);
  await syncPlayables(ctx, ALL, () => {});
  check('unlocking puts it back in the live menu', server.menu.has('Tyrannosaurus'));
}

{
  // The whole reason this is trustworthy: a server that accepts the command
  // and does nothing must be caught, not believed.
  const server = fakeServer({ ignoreWrites: true });
  const ctx = { db, rcon: server.rcon };
  setEnforcement(ctx, true);
  db.setSpeciesLocked('Tyrannosaurus', true);

  const result = await syncPlayables(ctx, ALL, () => {});
  check('a write that does not take is detected', result.verified === false);
  check('enforcement switches itself off', enforcementEnabled(ctx) === false);
  check('and it records why', (enforcementFault(ctx) ?? '').includes('Tyrannosaurus'),
    enforcementFault(ctx) ?? '');
}

{
  // Switching enforcement off must not leave anything banned.
  const server = fakeServer();
  const ctx = { db, rcon: server.rcon };
  server.menu.delete('Deinosuchus');
  server.menu.delete('Troodon');

  const restored = await restoreAllPlayables(ctx, ALL, () => {});
  check('everything missing is put back', restored.sort().join(',') === 'Deinosuchus,Troodon');
  check('the menu is whole again', ALL.every((s) => server.menu.has(s)));
  check('restoring does not call UpdatePlayables either',
    !server.calls.includes('update'));

  const second = await restoreAllPlayables(ctx, ALL, () => {});
  check('restoring twice sends nothing the second time', second.length === 0);
}

{
  const ctx = { db, rcon: fakeServer().rcon };
  setEnforcement(ctx, true);
  check('turning enforcement on clears the old fault', enforcementFault(ctx) === null);
  setEnforcement(ctx, false);
  check('enforcement is off again', enforcementEnabled(ctx) === false);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

// ---- unlocking has to be possible ----------------------------------------
//
// Reported live: setting a Rex cap to 0 removed it from the spawn menu, and
// putting the cap back to 10 did nothing. A cap works by removing the name from
// the live menu, and the live menu was also where "which species exist" came
// from - so a removed species became unknown, and unknown species were never
// re-added. Setting a cap to zero was a door that locked behind you.

{
  const fresh = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'roster.sqlite'));
  const ctx = { db: fresh };

  fresh.rememberSpecies(['Tyrannosaurus', 'Dryosaurus', 'Troodon']);
  check('the roster remembers what it has seen', fresh.knownSpecies().length === 3);
  check('and never records the same name twice',
    fresh.rememberSpecies(['Tyrannosaurus']) === 0);
  check('rubbish is not recorded', fresh.rememberSpecies(['', 'x', '12345']) === 0);

  // The exact reported case: locked, so absent from the live menu.
  const capped = [{ species: 'Tyrannosaurus', cap: 0, locked: true }];
  const live = ['Dryosaurus', 'Troodon'];

  const stuck = diffPlayables(capped, live, live);
  check('the old behaviour could not add it back, because it asked the menu',
    !stuck.add.includes('Tyrannosaurus'));

  // Now unlocked, and asked against the roster instead.
  const freed = [{ species: 'Tyrannosaurus', cap: 10, locked: false }];
  const plan = diffPlayables(freed, live, fresh.knownSpecies());
  check('the roster puts it back', plan.add.includes('Tyrannosaurus'),
    JSON.stringify(plan));
  check('and nothing already present is added twice',
    !plan.add.includes('Dryosaurus') && !plan.add.includes('Troodon'));
  check('and it is not removed at the same time', plan.remove.length === 0);

  // A species only ever named by a cap must still be recoverable: the roster is
  // seeded from the caps too, so locking something the bot never saw listed
  // does not strand it.
  fresh.rememberSpecies(['Deinosuchus']);
  check('a species known only from a cap can be restored',
    diffPlayables([{ species: 'Deinosuchus', cap: 5, locked: false }], live,
      fresh.knownSpecies()).add.includes('Deinosuchus'));

  fresh.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
