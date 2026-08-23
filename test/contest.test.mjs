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
  buildContestEmbed, contestAnnounce, winnersAnnounce, enterNotice, leaveNotice,
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
//
// Reported live: a one-minute contest was won one second after it started.
// Positions arrive once a minute, so being seen on it once says only that you
// arrived at some point in the last minute - and crediting that first sighting
// paid a full minute for walking past. Time is only credited between two
// sightings now, which rounds a hold up to the next whole tick rather than
// handing it out for turning up.

{
  const c = base();
  const first = tickContest(c, [at('a', 100_000, 200_000)], MINUTE);
  check('the first sighting credits nothing', first.contest.progress['a'] === undefined,
    JSON.stringify(first.contest.progress));
  check('but it is remembered for next time', first.contest.present.includes('a'));
  check('and nobody has won on one tick', first.winner === null);

  const second = tickContest(first.contest, [at('a', 100_000, 200_000)], MINUTE);
  check('the second sighting credits the gap', second.contest.progress['a'] === MINUTE);
}

{
  // The exact reported failure: one tick of a 60s poll on a 60s hold.
  const short = { ...base(), holdMs: MINUTE };
  const once = tickContest(short, [at('a', 100_000, 200_000)], MINUTE);
  check('a one-minute hold is not won by the first tick', once.winner === null);

  const twice = tickContest(once.contest, [at('a', 100_000, 200_000)], MINUTE);
  check('it takes standing there across two readings', twice.winner === 'a');
}

{
  const c = base();
  let state = tickContest(c, [at('a', 100_000, 200_000)], MINUTE).contest;
  for (let n = 0; n < 5; n += 1) {
    state = tickContest(state, [at('a', 100_000, 200_000)], MINUTE).contest;
  }
  const done = tickContest(state, [at('a', 100_000, 200_000)], MINUTE);
  check('holding long enough still wins it', done.winner === 'a');
}

{
  // The mechanic: standing there too is how you stop somebody.
  const c = base();
  let held = tickContest(c, [at('a', 100_000, 200_000)], MINUTE).contest;
  held = tickContest(held, [at('a', 100_000, 200_000)], 2 * MINUTE).contest;

  const fight = tickContest(held, [
    at('a', 100_000, 200_000),
    at('b', 105_000, 200_000),
  ], 3 * MINUTE);

  check('two on it is contested', fight.contested === true);
  check('and nobody gains while it is', fight.contest.progress['a'] === 2 * MINUTE);
  check('so nobody wins by waiting it out', fight.winner === null);
  check('and the challenger banks nothing either',
    fight.contest.progress['b'] === undefined);

  // Both were there, so neither has to re-establish presence when one leaves.
  const alone = tickContest(fight.contest, [at('a', 100_000, 200_000)], MINUTE);
  check('the survivor carries straight on',
    alone.contest.progress['a'] === 3 * MINUTE, JSON.stringify(alone.contest.progress));
}

{
  // Progress is kept when somebody leaves, deliberately: positions arrive every
  // minute and a death or a dropped read should not cost the whole hold.
  const c = base();
  let held = tickContest(c, [at('a', 100_000, 200_000)], MINUTE).contest;
  held = tickContest(held, [at('a', 100_000, 200_000)], 3 * MINUTE).contest;
  const away = tickContest(held, [at('a', 900_000, 900_000)], MINUTE);

  check('walking away does not wipe progress', away.contest.progress['a'] === 3 * MINUTE);
  check('but standing elsewhere gains nothing', away.holders.length === 0);
  check('and leaving means being seen again before it counts',
    away.contest.present.length === 0);

  let back = tickContest(away.contest, [at('a', 100_000, 200_000)], MINUTE).contest;
  check('so the tick after coming back is still nothing',
    back.progress['a'] === 3 * MINUTE);
  back = tickContest(back, [at('a', 100_000, 200_000)], 2 * MINUTE).contest;
  check('and then it resumes', back.progress['a'] === 5 * MINUTE);
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

  // Even somebody who had been holding it alone stops gaining.
  let solo = tickContest(base(), [at('a', 100_000, 200_000)], MINUTE).contest;
  solo = tickContest(solo, [at('a', 100_000, 200_000)], MINUTE).contest;
  const joined = tickContest(solo, [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000),
  ], 10 * MINUTE);
  check('a rival arriving freezes an existing hold',
    joined.contest.progress['a'] === MINUTE, JSON.stringify(joined.contest.progress));
}

// ---- shared points ----------------------------------------------------------
//
// Asked for directly: "if 2 out of 3 players form a group is in the radius
// those two players both win?" A shared point drops the freeze, so everybody
// standing there gains together and everybody who lasts is paid in full.

{
  const c = { ...base(), shared: true };
  let state = tickContest(c, [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000),
  ], MINUTE).contest;

  const two = tickContest(state, [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000),
  ], MINUTE);
  check('a shared point is never contested', two.contested === false);
  check('and everybody on it gains',
    two.contest.progress['a'] === MINUTE && two.contest.progress['b'] === MINUTE,
    JSON.stringify(two.contest.progress));

  // Two of three: the third is stood elsewhere and gets nothing.
  state = two.contest;
  for (let n = 0; n < 4; n += 1) {
    state = tickContest(state, [
      at('a', 100_000, 200_000), at('b', 101_000, 200_000), at('c', 900_000, 900_000),
    ], MINUTE).contest;
  }
  const done = tickContest(state, [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000), at('c', 900_000, 900_000),
  ], MINUTE);

  check('both of the pair win it', done.winners.length === 2
    && done.winners.includes('a') && done.winners.includes('b'),
    JSON.stringify(done.winners));
  check('the one who stayed away does not', !done.winners.includes('c'));
  check('and winner still names one of them, for callers that want a single',
    done.winners.includes(done.winner));
}

{
  // Somebody who turns up at the last second has not done the time.
  const c = { ...base(), shared: true, holdMs: 2 * MINUTE };
  let state = tickContest(c, [at('a', 100_000, 200_000)], MINUTE).contest;
  state = tickContest(state, [at('a', 100_000, 200_000)], MINUTE).contest;
  const late = tickContest(state, [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000),
  ], MINUTE);
  check('a latecomer does not ride along', late.winners.length === 1
    && late.winners[0] === 'a', JSON.stringify(late.winners));
}

{
  // The default is unchanged: a rival still freezes it.
  const solo = tickContest(base(), [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000),
  ], MINUTE);
  check('an ordinary point still freezes with two on it', solo.contested === true);
}

// ---- crossing the boundary --------------------------------------------------
//
// There is nothing in the world to stand next to - spawning a nest as a marker
// came back "spawned nothing usable" from the engine - so the on-screen notice
// IS the boundary. It has to fire on the edges only: one repeated every poll
// would be worse than none.

{
  const c = base();
  const arrived = tickContest(c, [at('a', 100_000, 200_000)], MINUTE);
  check('walking on is an entry', arrived.entered.includes('a'));
  check('and nothing has been left', arrived.left.length === 0);

  const stayed = tickContest(arrived.contest, [at('a', 100_000, 200_000)], MINUTE);
  check('standing still is not a second entry', stayed.entered.length === 0,
    JSON.stringify(stayed.entered));

  const gone = tickContest(stayed.contest, [at('a', 900_000, 900_000)], MINUTE);
  check('walking off is a departure', gone.left.includes('a'));
  check('and staying away is not a second one',
    tickContest(gone.contest, [at('a', 900_000, 900_000)], MINUTE).left.length === 0);

  // Dying or logging out is a departure too: they stop being reported at all.
  const vanished = tickContest(stayed.contest, [], MINUTE);
  check('dying or logging off counts as leaving', vanished.left.includes('a'));
}

{
  // Each player is tracked separately, or one arrival would silence another's.
  const c = base();
  const one = tickContest(c, [at('a', 100_000, 200_000)], MINUTE);
  const two = tickContest(one.contest, [
    at('a', 100_000, 200_000), at('b', 101_000, 200_000),
  ], MINUTE);
  check('a second arrival is reported on its own',
    two.entered.length === 1 && two.entered[0] === 'b', JSON.stringify(two.entered));
  check('and the one already there is not re-announced', !two.entered.includes('a'));
}

{
  const c = base();
  const first = enterNotice(c, 0);
  check('the arrival notice says what to do',
    /5m 0s/.test(first) && /750/.test(first), first);
  check('coming back says what is already banked',
    /2m 0s/.test(enterNotice(c, 2 * MINUTE)), enterNotice(c, 2 * MINUTE));

  const off = leaveNotice(c, 2 * MINUTE);
  check('leaving says the time is kept', /kept/.test(off), off);
  check('leaving with nothing banked does not promise anything',
    !/kept/.test(leaveNotice(c, 0)), leaveNotice(c, 0));

  // These render through the mod, which swallows anything outside ASCII
  // silently rather than refusing it.
  for (const [what, line] of [
    ['the arrival notice', first],
    ['the departure notice', off],
  ]) {
    check(`${what} is plain ASCII`, /^[ -~]*$/.test(line), line);
  }
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

  // First sighting establishes presence and pays nothing.
  advanceContest(ctx, [at(S, 100_000, 200_000)], MINUTE);
  const won = advanceContest(ctx, [at(S, 100_000, 200_000)], 2 * MINUTE);
  check('holding it to the end pays out', won.winner === S);
  check('the points land', db.pointsFor(S).balance === 750,
    String(db.pointsFor(S).balance));
  check('the skin is granted too', db.ownsSkin(S, 'Champion'));

  // Left running, it would pay the same person again every few seconds.
  check('and the contest is cleared', activeContest(ctx) === null);
  check('one winner is still reported as one', won.winners.length === 1);
  check('so a second tick pays nothing',
    advanceContest(ctx, [at(S, 100_000, 200_000)], MINUTE) === null);

  db.close();
}

{
  // Shared payouts are in full each, not split: a group event that pays a
  // fraction is a worse deal for turning up with friends.
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'shared.sqlite'));
  const ctx = { db };
  const A = '76561198000000001';
  const B = '76561198000000002';

  saveContest(ctx, { ...base(), shared: true, holdMs: MINUTE });
  advanceContest(ctx, [at(A, 100_000, 200_000), at(B, 101_000, 200_000)], MINUTE);
  const won = advanceContest(ctx, [at(A, 100_000, 200_000), at(B, 101_000, 200_000)], MINUTE);

  check('both are paid', won.winners.length === 2, JSON.stringify(won.winners));
  check('and each gets the whole reward, not a share',
    db.pointsFor(A).balance === 750 && db.pointsFor(B).balance === 750,
    `${db.pointsFor(A).balance}/${db.pointsFor(B).balance}`);
  check('and it ends once, not once per winner', activeContest(ctx) === null);

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
  check('a shared one invites the group rather than warning them off',
    /Everybody/.test(contestAnnounce({ ...c, shared: true })));

  const group = winnersAnnounce(c, ['Shadow', 'Rex', 'Ash']);
  check('the group announce names all of them and says each',
    /Shadow, Rex and Ash/.test(group) && /each/.test(group), group);
  check('and it stays ASCII for RCON', /^[ -~]*$/.test(group), group);
  check('one winner reads as one', !/each/.test(winnersAnnounce(c, ['Shadow'])));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
