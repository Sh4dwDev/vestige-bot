// The contested point. The rules are the whole feature, so they are pure and
// tested here without a server: who is on it, who gains, and who wins.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  tickContest, inside, leader, advanceContest, saveContest, activeContest,
  buildContestEmbed, contestAnnounce,
} = await load('contest.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const MINUTE = 60_000;
const base = () => ({
  x: 100_000, y: 200_000, radius: 30_000,
  holdMs: 5 * MINUTE, reward: 750, name: 'The Hollow',
  startedAt: Date.now(), progress: {},
});

const at = (steam, x, y) => ({ steam, species: 'Rex', growth: 1, female: false, prime: false, x, y });

// ---- who counts as being on it ---------------------------------------------

{
  const c = base();
  check('somebody standing on it is inside', inside(c, at('a', 100_000, 200_000)));
  check('just inside the edge counts', inside(c, at('a', 129_000, 200_000)));
  check('just outside does not', !inside(c, at('a', 131_000, 200_000)));

  // A pawn that will not report a position still counts as playing elsewhere,
  // and must never be treated as standing on the point.
  check('a player with no position is never inside',
    !inside(c, { steam: 'a', species: 'Rex', growth: 1, female: false, prime: false }));
}

// ---- holding ----------------------------------------------------------------

{
  const c = base();
  const one = tickContest(c, [at('a', 100_000, 200_000)], MINUTE);
  check('one player alone gains time', one.contest.progress['a'] === MINUTE);
  check('and is not contested', one.contested === false);
  check('and has not won yet', one.winner === null);

  const two = tickContest(one.contest, [at('a', 100_000, 200_000)], 4 * MINUTE);
  check('holding long enough wins it', two.winner === 'a', JSON.stringify(two.winner));
}

{
  // The mechanic: standing there too is how you stop somebody.
  const c = base();
  const held = tickContest(c, [at('a', 100_000, 200_000)], 2 * MINUTE).contest;

  const fight = tickContest(held, [
    at('a', 100_000, 200_000),
    at('b', 105_000, 200_000),
  ], 3 * MINUTE);

  check('two on it is contested', fight.contested === true);
  check('and nobody gains while it is', fight.contest.progress['a'] === 2 * MINUTE);
  check('so nobody wins by waiting it out', fight.winner === null);
  check('and the challenger banks nothing either',
    fight.contest.progress['b'] === undefined);
}

{
  // Progress is kept when somebody leaves, deliberately: positions arrive every
  // few seconds and a death or a dropped read should not cost the whole hold.
  const c = base();
  const held = tickContest(c, [at('a', 100_000, 200_000)], 3 * MINUTE).contest;
  const away = tickContest(held, [at('a', 900_000, 900_000)], MINUTE);

  check('walking away does not wipe progress', away.contest.progress['a'] === 3 * MINUTE);
  check('but standing elsewhere gains nothing', away.holders.length === 0);

  const back = tickContest(away.contest, [at('a', 100_000, 200_000)], 2 * MINUTE);
  check('coming back finishes the job', back.winner === 'a');
}

{
  const c = base();
  const empty = tickContest(c, [], MINUTE);
  check('nobody on it changes nothing', Object.keys(empty.contest.progress).length === 0);
  check('and there is no winner', empty.winner === null);

  const far = tickContest(c, [at('a', 900_000, 900_000)], MINUTE);
  check('somebody across the island is not holding it', far.holders.length === 0);
}

{
  // Three people is still a stand-off, not a race.
  const c = base();
  const crowd = tickContest(c, [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000), at('c', 102_000, 200_000),
  ], 10 * MINUTE);
  check('a crowd freezes it just as two do', crowd.contested && crowd.winner === null);
}

// ---- the leader --------------------------------------------------------------

{
  const c = { ...base(), progress: { a: 2 * MINUTE, b: 4 * MINUTE } };
  check('the closest is the one with the most time', leader(c).steam === 'b');
  check('and nobody leads an untouched point', leader(base()) === null);
}

// ---- paying out --------------------------------------------------------------

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'contest.sqlite'));
  const ctx = { db };
  const S = '76561198000000777';

  db.savePreset('Champion', { colours: { BodyColor: '#FFD700' } }, 'staff');
  saveContest(ctx, { ...base(), skin: 'Champion', progress: { [S]: 4 * MINUTE } });

  const nothing = advanceContest(ctx, [at(S, 900_000, 900_000)], MINUTE);
  check('standing nowhere near it pays nothing', nothing.winner === null);
  check('and the contest is still running', activeContest(ctx) !== null);

  const won = advanceContest(ctx, [at(S, 100_000, 200_000)], 2 * MINUTE);
  check('holding it to the end pays out', won.winner === S);
  check('the points land', db.pointsFor(S).balance === 750,
    String(db.pointsFor(S).balance));
  check('the skin is granted too', db.ownsSkin(S, 'Champion'));

  // Left running, it would pay the same person again every few seconds.
  check('and the contest is cleared', activeContest(ctx) === null);
  check('so a second tick pays nothing',
    advanceContest(ctx, [at(S, 100_000, 200_000)], MINUTE) === null);

  db.close();
}

// ---- what people are told ----------------------------------------------------

{
  const c = base();
  const namer = (s) => (s === 'a' ? 'Shadow' : s);

  const quiet = buildContestEmbed(c, namer).toJSON();
  check('an untouched point says nobody is on it',
    /Nobody is on it/.test(quiet.description ?? ''));

  const fight = buildContestEmbed({ ...c, progress: { a: MINUTE } }, namer,
    { holders: ['a', 'b'], contested: true }).toJSON();
  check('a contested one says so', /Contested/.test(fight.description ?? ''));
  check('and names who is closest', /Shadow/.test(JSON.stringify(fight.fields ?? [])));

  // Goes out over RCON, which silently drops anything that is not ASCII.
  const line = contestAnnounce(c);
  check('the in-game line is plain ASCII', /^[\x20-\x7E]*$/.test(line), line);
  check('and gives coordinates somebody can navigate to',
    line.includes('Lat 200') && line.includes('Long 100'), line);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
