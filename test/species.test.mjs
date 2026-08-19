// Species caps. The thing that matters is that a lock is announced once, on
// the change — a panel that re-announces every minute is worse than silence.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { lockChanges, buildLockEmbed } = await load('species.js');
const { buildPopulationEmbed } = await load('population.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const caps = (species, cap, locked) => [{ species, cap, locked }];
const counts = (species, n) => new Map([[species, n]]);

// ---- when a lock flips -------------------------------------------------------

check('under the cap and open stays quiet',
  lockChanges(caps('Rex', 10, false), counts('Rex', 5)).length === 0);

check('reaching the cap locks it',
  lockChanges(caps('Rex', 10, false), counts('Rex', 10))[0]?.locked === true);

check('exactly on the cap counts as full',
  lockChanges(caps('Rex', 10, false), counts('Rex', 10)).length === 1);

check('over the cap and already locked stays quiet',
  lockChanges(caps('Rex', 10, true), counts('Rex', 14)).length === 0);

check('dropping below unlocks',
  lockChanges(caps('Rex', 10, true), counts('Rex', 9))[0]?.locked === false);

// Nobody online for a capped species: it must open, not stay stuck locked.
check('a species with nobody on unlocks',
  lockChanges(caps('Rex', 10, true), new Map())[0]?.locked === false);

check('an uncapped species is never reported',
  lockChanges([], counts('Rex', 999)).length === 0);

{
  const many = lockChanges(
    [{ species: 'Rex', cap: 2, locked: false }, { species: 'Dryo', cap: 5, locked: true }],
    new Map([['Rex', 3], ['Dryo', 1]]),
  );
  check('several species change at once', many.length === 2, JSON.stringify(many));
}

// ---- storage -----------------------------------------------------------------

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 's.sqlite');
const db = new Database(file);

db.setSpeciesCap('Tyrannosaurus', 10);
check('a cap is stored', db.speciesCaps()[0]?.cap === 10);
check('a new cap starts unlocked', db.speciesCaps()[0]?.locked === false);

db.setSpeciesLocked('Tyrannosaurus', true);
check('lock state persists', db.speciesCaps()[0]?.locked === true);

// Changing the cap must not silently drop the announced state.
db.setSpeciesCap('Tyrannosaurus', 15);
check('raising the cap keeps the state', db.speciesCaps()[0]?.cap === 15);

check('clearing removes it', db.removeSpeciesCap('Tyrannosaurus') && db.speciesCaps().length === 0);
check('clearing something absent is not an error', db.removeSpeciesCap('Nope') === false);

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

// ---- embeds ------------------------------------------------------------------

{
  const locked = buildLockEmbed({ species: 'Rex', cap: 10, count: 10, locked: true }).toJSON();
  const open = buildLockEmbed({ species: 'Rex', cap: 10, count: 4, locked: false }).toJSON();
  check('a lock reads as locked', /🔒/.test(locked.title ?? ''), locked.title);
  check('an unlock reads as open', /🔓/.test(open.title ?? ''), open.title);
  check('the two are colour coded', locked.color !== open.color);
}

{
  const dino = (species, growth) => ({ species, growth, female: false, prime: false });
  const panel = buildPopulationEmbed(
    [dino('Tyrannosaurus', 0.9), dino('Dryosaurus', 0.9)],
    { caps: [{ species: 'Tyrannosaurus', cap: 5, locked: true }] },
  ).toJSON();

  check('the panel lists what is locked', /🔒 \*\*Locked:\*\* Tyrannosaurus/.test(panel.description ?? ''),
    panel.description);

  const rex = (panel.fields ?? []).find((f) => f.name.includes('Tyrannosaurus'));
  check('a locked species card is marked', (rex?.name ?? '').includes('🔒'), rex?.name);
  check('a capped species shows its cap', /\*\*1\*\* \/ 5/.test(rex?.value ?? ''), rex?.value);
  check('the adult threshold is shown per species', /50%\+/.test(rex?.value ?? ''), rex?.value);
}

// Lock notices land in chat as <RCON>, where they persist and wrap. They say
// what happened and why: "Rex LOCKED (5/5)" makes people ask what it means.
{
  const source = fs.readFileSync(path.join(root, 'src/species.ts'), 'utf8');
  const call = source.slice(source.indexOf('.announce(change.locked'),
    source.indexOf('.catch(() => undefined);', source.indexOf('.announce(change.locked')));

  check('a lock says it is locked, in words', /has been locked/.test(call));
  check('and says why, with the numbers', /population limit reached/.test(call)
    && /change\.count/.test(call) && /change\.cap/.test(call));
  check('and tells players what to do about it', /pick another species/.test(call));
  check('an unlock says it is unlocked', /has been unlocked/.test(call));
  check('and why it reopened', /population below limit/.test(call));
  // Only executable lines: the comment above the call quotes the old form on
  // purpose, so that a future reader knows what this replaced.
  const code = source.split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('the old shouty code form is gone', !/LOCKED \(/.test(code));
  check('but it is still recorded in a comment, so it stays replaced',
    /LOCKED \(/.test(source));
  // Non-ASCII is a real hazard for anything the bot sends in game, so the
  // source of these lines is held to printable ASCII plus whitespace.
  check('in-game lines stay plain ASCII',
    !/[^\x20-\x7E\s]/.test(call),
    (call.match(/[^\x20-\x7E\s]/g) ?? []).join(''));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
