// Points for hatching a nest.
//
// The child is a fact — a prime flag says they were nested in. The parent is a
// guess from where people were standing, so that guess is what gets tested
// hardest: who counts, who does not, and that a passing predator is never
// mistaken for a parent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  parentsOf, hatchlingCandidates, grownUp, runNesting, forgetChecked,
  nestingSettings, setNestingEnabled, setNestingPoints, setNestingCondition,
  setNestingRadius, parentNotice, nestAnnounce, MAX_PARENTS, DEFAULT_CONDITION,
} = await load('nesting.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'nest.sqlite');
const db = new Database(file);

const BABY = '76561198000000001';
const MUM = '76561198000000002';
const DAD = '76561198000000003';
const STRANGER = '76561198000000004';

const at = (steam, species, growth, x, y) => ({ steam, species, growth, female: false, prime: false, x, y });

// ---- who counts as a parent -------------------------------------------------

{
  const baby = at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000);

  const found = parentsOf(baby, [
    baby,
    at(MUM, 'Tyrannosaurus', 1, 105_000, 200_000),
  ], 20);
  check('an adult of the same species standing there is a parent',
    found.length === 1 && found[0] === MUM, JSON.stringify(found));

  check('the hatchling is never its own parent', !found.includes(BABY));
}

{
  const baby = at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000);

  // A predator standing over a hatchling is the opposite of a parent.
  const wrongSpecies = parentsOf(baby, [
    baby, at(MUM, 'Allosaurus', 1, 101_000, 200_000),
  ], 20);
  check('a different species is never a parent', wrongSpecies.length === 0);

  const juvenile = parentsOf(baby, [
    baby, at(MUM, 'Tyrannosaurus', 0.5, 101_000, 200_000),
  ], 20);
  check('a juvenile cannot have nested anybody', juvenile.length === 0);

  const faraway = parentsOf(baby, [
    baby, at(MUM, 'Tyrannosaurus', 1, 900_000, 900_000),
  ], 20);
  check('somebody across the island is not a parent', faraway.length === 0);

  const noPosition = parentsOf(
    { steam: BABY, species: 'Tyrannosaurus', growth: 0.05, female: false, prime: false },
    [at(MUM, 'Tyrannosaurus', 1, 101_000, 200_000)],
    20,
  );
  check('a hatchling with no position cannot be attributed', noPosition.length === 0);
}

{
  // Nesting is a group activity: a mate guarding the nest genuinely helped.
  const baby = at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000);
  const both = parentsOf(baby, [
    baby,
    at(MUM, 'Tyrannosaurus', 1, 101_000, 200_000),
    at(DAD, 'Tyrannosaurus', 0.9, 102_000, 200_000),
  ], 20);
  check('both parents are paid', both.length === 2, JSON.stringify(both));

  // But a crowd is not a payout each.
  const crowd = parentsOf(baby, [
    baby,
    ...Array.from({ length: 8 }, (_, n) =>
      at(`7656119800000010${n}`, 'Tyrannosaurus', 1, 100_500 + (n * 100), 200_000)),
  ], 20);
  check('a crowd is capped', crowd.length === MAX_PARENTS, String(crowd.length));

  // And the cap keeps whoever was actually on the nest.
  const near = at(MUM, 'Tyrannosaurus', 1, 100_100, 200_000);
  const ordered = parentsOf(baby, [
    baby,
    at('76561198000000090', 'Tyrannosaurus', 1, 119_000, 200_000),
    at('76561198000000091', 'Tyrannosaurus', 1, 118_000, 200_000),
    at('76561198000000092', 'Tyrannosaurus', 1, 117_000, 200_000),
    near,
  ], 20);
  check('the closest is kept when the cap bites', ordered.includes(MUM), JSON.stringify(ordered));
}

// ---- who is worth asking about ----------------------------------------------

{
  const players = [
    at(BABY, 'Tyrannosaurus', 0.05, 1000, 1000),
    at(MUM, 'Tyrannosaurus', 1, 1000, 1000),
  ];

  check('only the small one is a candidate',
    hatchlingCandidates(players, 0.2, new Set()).length === 1);
  check('and not once already asked',
    hatchlingCandidates(players, 0.2, new Set([BABY])).length === 0);

  // Otherwise the set grows forever and a second nest is never paid for.
  check('growing up clears the memory',
    grownUp([at(BABY, 'Tyrannosaurus', 0.9, 1000, 1000)], 0.2, new Set([BABY]))
      .includes(BABY));
  check('but staying small does not',
    grownUp([at(BABY, 'Tyrannosaurus', 0.05, 1000, 1000)], 0.2, new Set([BABY]))
      .length === 0);
  check('and logging off clears it too, so the next life counts',
    grownUp([], 0.2, new Set([BABY])).includes(BABY));
}

// ---- paying out --------------------------------------------------------------

/** A server where the hatchling was nested unless told otherwise. */
function makeCtx({ nested = true, throws = false } = {}) {
  const notices = [];
  return {
    db,
    notices,
    mod: {
      prime: async () => {
        if (throws) throw new Error('not spawned in');
        return { conditions: { [String(DEFAULT_CONDITION)]: nested } };
      },
      notify: async (steam, text) => { notices.push({ steam, text }); return true; },
    },
    // Notices go through tell(), which defaults to the brief banner rather than
    // the persistent widget — that widget is the game's prime checklist, and
    // squatting it is the bug tell() exists to avoid.
    rcon: {
      directMessage: async (steam, text) => { notices.push({ steam, text }); },
      players: async () => [],
    },
  };
}

const quiet = () => {};

{
  const ctx = makeCtx();
  setNestingEnabled(ctx, true);
  setNestingPoints(ctx, 400);
  setNestingRadius(ctx, 20);
  forgetChecked();

  const players = [
    at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000),
    at(MUM, 'Tyrannosaurus', 1, 101_000, 200_000),
  ];

  const out = await runNesting(ctx, players, quiet);
  check('a hatched nest pays', out.length === 1, JSON.stringify(out));
  check('the parent gets the points', db.pointsFor(MUM).balance === 400,
    String(db.pointsFor(MUM).balance));
  check('the hatchling is not paid, only the parents',
    db.pointsFor(BABY).balance === 0);
  check('and the parent is told on their own screen',
    ctx.notices.some((n) => n.steam === MUM && /400/.test(n.text)),
    JSON.stringify(ctx.notices));

  // The whole point of the checked set: this must not pay every minute of
  // their childhood.
  const again = await runNesting(ctx, players, quiet);
  check('the same hatchling never pays twice', again.length === 0);
  check('and the balance does not move', db.pointsFor(MUM).balance === 400);
}

{
  // Somebody who spawned in as a juvenile is not a nest.
  const ctx = makeCtx({ nested: false });
  forgetChecked();
  const before = db.pointsFor(MUM).balance;

  const out = await runNesting(ctx, [
    at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000),
    at(MUM, 'Tyrannosaurus', 1, 101_000, 200_000),
  ], quiet);

  check('a juvenile who was not nested pays nobody', out.length === 0);
  check('and no points move', db.pointsFor(MUM).balance === before);
}

{
  // A read that fails must not pay, and must not retry forever either.
  const ctx = makeCtx({ throws: true });
  forgetChecked();
  const before = db.pointsFor(MUM).balance;

  const out = await runNesting(ctx, [
    at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000),
    at(MUM, 'Tyrannosaurus', 1, 101_000, 200_000),
  ], quiet);

  check('a failed read pays nobody', out.length === 0);
  check('and does not throw out of the poll', db.pointsFor(MUM).balance === before);
}

{
  // The parents can be dead or gone by the time the poll comes round.
  const ctx = makeCtx();
  forgetChecked();
  const out = await runNesting(ctx, [
    at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000),
  ], quiet);
  check('a hatchling alone pays nobody', out.length === 0);
}

{
  const ctx = makeCtx();
  setNestingEnabled(ctx, false);
  forgetChecked();
  const out = await runNesting(ctx, [
    at(BABY, 'Tyrannosaurus', 0.05, 100_000, 200_000),
    at(MUM, 'Tyrannosaurus', 1, 101_000, 200_000),
  ], quiet);
  check('switched off, nothing happens at all', out.length === 0);
  setNestingEnabled(ctx, true);
}

// ---- settings and wording ----------------------------------------------------

{
  const ctx = makeCtx();
  check('the condition index is a setting, not a constant',
    (setNestingCondition(ctx, 9), nestingSettings(ctx).condition === 9));
  setNestingCondition(ctx, DEFAULT_CONDITION);

  // These render through the mod, which drops anything outside ASCII silently.
  const notice = parentNotice('Tyrannosaurus', 400);
  check('the parent notice is plain ASCII', /^[\x20-\x7E]*$/.test(notice), notice);
  check('and leads with the number', /^\+400/.test(notice), notice);

  const line = nestAnnounce('Tyrannosaurus', 2, 400);
  check('the announce is plain ASCII', /^[\x20-\x7E]*$/.test(line), line);
  check('and reads correctly for one parent',
    /1 parent /.test(nestAnnounce('Rex', 1, 400)), nestAnnounce('Rex', 1, 400));
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
