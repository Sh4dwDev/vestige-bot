// Daily play streaks and the weekly board. Both are calendar code, so the
// cases that matter are the boundaries: midnight, a missed day, and the week
// rolling over while nobody was looking.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  osloDay, dayBefore, nextStreak, streakBonus, streakNotice, recordPlay,
  setStreaksEnabled, setStreakRewards, DEFAULT_STEP, DEFAULT_CAP, isMilestone, MILESTONES,
} = await load('streaks.js');
const { Database, weekKey } = await load('db.js');
const { buildWeeklyEmbed, PODIUM, closeWeek, setWeeklySkin, setWeeklyEnabled, HELD_BY_WEEKLY }
  = await load('weekly.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const A = '76561198000000001';
const B = '76561198000000002';
const C = '76561198000000003';

const fresh = () => new Database(
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'streak.sqlite'));

// ---- the calendar -----------------------------------------------------------

{
  // Oslo, not UTC. At 00:30 Oslo in summer it is still 22:30 the previous day in
  // UTC, and a player on at that moment must be credited with the new day, not
  // yesterday, or they lose a run they are in the middle of extending.
  check('the day is Oslo, not UTC',
    osloDay(new Date('2026-08-24T22:30:00Z')) === '2026-08-25',
    osloDay(new Date('2026-08-24T22:30:00Z')));
  check('and the same instant is still the 24th in UTC',
    new Date('2026-08-24T22:30:00Z').toISOString().slice(0, 10) === '2026-08-24');

  check('yesterday is yesterday', dayBefore('2026-08-25') === '2026-08-24');
  check('across a month boundary', dayBefore('2026-09-01') === '2026-08-31');
  check('and across a year boundary', dayBefore('2027-01-01') === '2026-12-31');
}

// ---- what a day does --------------------------------------------------------

{
  const first = nextStreak(null, '2026-08-25');
  check('a first ever day starts a streak',
    first.kind === 'extended' && first.state.streak === 1 && first.state.best === 1);
  check('and is not counted as a broken one',
    first.kind === 'extended' && first.broken === false);

  const same = nextStreak({ lastDay: '2026-08-25', streak: 3, best: 5 }, '2026-08-25');
  check('playing twice in a day only counts once', same.kind === 'counted', same.kind);

  const next = nextStreak({ lastDay: '2026-08-25', streak: 3, best: 5 }, '2026-08-26');
  check('the day after continues it',
    next.kind === 'extended' && next.state.streak === 4, JSON.stringify(next));
  check('and the best is kept when it is not beaten',
    next.kind === 'extended' && next.state.best === 5);

  const beaten = nextStreak({ lastDay: '2026-08-25', streak: 5, best: 5 }, '2026-08-26');
  check('a new best is recorded', beaten.kind === 'extended' && beaten.state.best === 6);

  // Missing a day resets to one rather than to nothing. Somebody coming back
  // after a week is on day one, and telling them they are on zero is how you
  // lose them a second time.
  const missed = nextStreak({ lastDay: '2026-08-20', streak: 9, best: 9 }, '2026-08-25');
  check('missing a day starts again at one',
    missed.kind === 'extended' && missed.state.streak === 1, JSON.stringify(missed));
  check('but the best run is remembered',
    missed.kind === 'extended' && missed.state.best === 9);
  check('and it is reported as broken, so the wording can differ',
    missed.kind === 'extended' && missed.broken === true);
}

{
  check('the bonus grows with the streak', streakBonus(3, 40, 400) === 120);
  // Without a cap a streak of ninety pays more for logging in than an evening
  // of playing, and the nudge becomes the whole game.
  check('and stops at the cap', streakBonus(90, 40, 400) === 400);
  check('a zero step pays nothing', streakBonus(5, 0, 400) === 0);

  // Only milestones are announced. The game draws these as a full-width banner
  // and one every evening is wallpaper by the third; day one is the least
  // interesting of the lot.
  check('day one is not worth interrupting anybody for', !isMilestone(1));
  check('nor day two', !isMilestone(2));
  check('but the milestones are', MILESTONES.every((d) => isMilestone(d)),
    MILESTONES.join(', '));
  check('and the gaps grow as the run does',
    MILESTONES.every((d, i) => i === 0 || d > MILESTONES[i - 1]));

  check('the notice is short, because the banner is one line',
    streakNotice(7, 280).length < 40, streakNotice(7, 280));
  check('and says both the run and the reward',
    streakNotice(7, 280).includes('7') && streakNotice(7, 280).includes('280'),
    streakNotice(7, 280));
}

// ---- recording --------------------------------------------------------------

{
  const db = fresh();
  const ctx = { db };
  const day = new Date('2026-08-25T18:00:00Z');

  const first = recordPlay(ctx, [A, B], day);
  check('everybody online is credited', first.length === 2, JSON.stringify(first));
  check('and paid the first day', db.pointsFor(A).balance === DEFAULT_STEP,
    String(db.pointsFor(A).balance));

  const again = recordPlay(ctx, [A, B], new Date('2026-08-25T20:00:00Z'));
  check('the same day pays nothing more', again.length === 0);
  check('and the balance does not move', db.pointsFor(A).balance === DEFAULT_STEP);

  const tomorrow = recordPlay(ctx, [A], new Date('2026-08-26T18:00:00Z'));
  check('the next day pays more', tomorrow[0].streak === 2,
    JSON.stringify(tomorrow));
  check('and day two is paid but not announced',
    tomorrow[0].bonus > 0 && tomorrow[0].milestone === false, JSON.stringify(tomorrow));
  check('and it adds up', db.pointsFor(A).balance === DEFAULT_STEP * 3,
    String(db.pointsFor(A).balance));

  // Switched off it must do nothing at all, not silently keep counting.
  setStreaksEnabled(ctx, false);
  check('switched off, nothing is recorded',
    recordPlay(ctx, [C], new Date('2026-08-27T18:00:00Z')).length === 0);
  check('and nobody is paid', db.pointsFor(C).balance === 0);

  setStreaksEnabled(ctx, true);
  setStreakRewards(ctx, 10, 25);
  const capped = recordPlay(ctx, [A], new Date('2026-08-27T18:00:00Z'));
  check('a configured cap is honoured', capped[0].bonus === 25, JSON.stringify(capped));

  db.close();
}

// ---- the week ---------------------------------------------------------------

{
  check('a week key looks like a week', /^\d{4}-W\d{2}$/.test(weekKey(new Date())),
    weekKey(new Date()));

  // Monday starts a new week; the Sunday before is the old one. Getting this
  // wrong pays the podium a day early or a day late.
  const sunday = weekKey(new Date('2026-08-23T12:00:00Z'));
  const monday = weekKey(new Date('2026-08-24T12:00:00Z'));
  check('Monday begins a new week', sunday !== monday, `${sunday} -> ${monday}`);
  check('and the rest of that week matches Monday',
    weekKey(new Date('2026-08-27T12:00:00Z')) === monday);
}

{
  const db = fresh();

  db.addPoints(A, 500);
  db.addPoints(B, 900);
  db.addPoints(A, 200);

  check('earnings are counted for the week', db.weeklyFor(A) === 700,
    String(db.weeklyFor(A)));

  // The important one. Spending is an addPoints with a negative amount, and
  // counting it would mean buying a skin dropped you down the board.
  db.addPoints(A, -600);
  check('spending does not reduce what you earned', db.weeklyFor(A) === 700,
    String(db.weeklyFor(A)));
  check('but it does come off the balance', db.pointsFor(A).balance === 100,
    String(db.pointsFor(A).balance));

  const top = db.weeklyTop(weekKey(), 10);
  check('the board is ordered by earnings', top[0].steamId === B, JSON.stringify(top));
  check('and somebody who earned nothing is not on it',
    top.every((r) => r.steamId !== C));

  check('rank is counted against the field', db.weeklyRank(A).rank === 2,
    JSON.stringify(db.weeklyRank(A)));
  check('and the leader is first', db.weeklyRank(B).rank === 1);

  db.close();
}

{
  const rows = [
    { steamId: A, points: 900 },
    { steamId: B, points: 700 },
    { steamId: C, points: 100 },
  ];
  const names = (id) => ({ [A]: 'Shadow', [B]: 'Serval', [C]: 'nak3' })[id] ?? id;

  const live = buildWeeklyEmbed('2026-W35', rows, names);
  check('the board names people, not Steam IDs',
    live.data.description.includes('Shadow') && !live.data.description.includes(A),
    live.data.description);
  check('and says spending will not push them down',
    JSON.stringify(live.data.fields).includes('earned this week'));

  const final = buildWeeklyEmbed('2026-W35', rows, names, { final: true, skin: 'Albino' });
  check('a finished week names the prize',
    JSON.stringify(final.data.fields).includes('Albino'));
  check(`and only the top ${PODIUM} are said to keep it`,
    JSON.stringify(final.data.fields).includes(String(PODIUM)));

  const empty = buildWeeklyEmbed('2026-W35', [], names);
  check('an empty week is an invitation, not an error',
    empty.data.description.includes('wide open'), empty.data.description);
}

// ---- closing a week ---------------------------------------------------------

{
  const db = fresh();
  const ctx = { db };
  db.savePreset('Albino', { colours: { BodyColor: '#EEEEEE' } }, 'staff');
  setWeeklyEnabled(ctx, true);
  setWeeklySkin(ctx, 'Albino');

  // Two real weeks, so the second close has a board of its own to read.
  const monday = new Date('2026-08-24T12:00:00Z');
  const nextMonday = new Date('2026-08-31T12:00:00Z');
  const week1 = weekKey(monday);
  const week2 = weekKey(nextMonday);
  const D = '76561198000000005';
  const BUYER = '76561198000000009';

  db.addWeekly(A, 900, monday);
  db.addWeekly(B, 700, monday);
  db.addWeekly(C, 500, monday);
  db.addWeekly('76561198000000004', 100, monday);

  // No channel configured, so nothing is posted; the client is never used.
  const client = { channels: { fetch: async () => null } };
  const said = [];
  const closed = await closeWeek(ctx, client, week1, (m) => said.push(m));

  check('the podium is paid', closed.winners.length === PODIUM,
    JSON.stringify(closed.winners.map((w) => w.steamId)));
  check('and it is the top three', closed.winners[0].steamId === A);
  check('the skin is granted to all of them',
    db.ownsSkin(A, 'Albino') && db.ownsSkin(B, 'Albino') && db.ownsSkin(C, 'Albino'));
  check('and not to fourth place', !db.ownsSkin('76561198000000004', 'Albino'));
  check('nobody loses anything on the first week', closed.lost.length === 0);

  // The guard that matters. A restart mid-close must not hand the same podium a
  // second prize, so the week is marked closed before anything is granted.
  const again = await closeWeek(ctx, client, week1, (m) => said.push(m));
  check('closing the same week twice does nothing', again === null, JSON.stringify(again));

  // Week two: C drops off, D takes their place. The skin is a loan held while
  // you are up there, not a possession.
  db.addWeekly(A, 900, nextMonday);
  db.addWeekly(B, 700, nextMonday);
  db.addWeekly(D, 5000, nextMonday);

  // Somebody who owns the same skin for their own reasons must not lose it when
  // the podium changes. This is the case that would make people furious.
  db.grantSkin(BUYER, 'Albino', 'shop');

  const next = await closeWeek(ctx, client, week2, (m) => said.push(m));
  check('a new winner gets it', db.ownsSkin(D, 'Albino'),
    JSON.stringify(next.winners.map((w) => w.steamId)));
  check('somebody still on the podium keeps it', db.ownsSkin(A, 'Albino'));
  check('somebody who dropped off gives it back', !db.ownsSkin(C, 'Albino'),
    JSON.stringify(next.lost));
  check('and that is reported', next.lost.includes(C), JSON.stringify(next.lost));

  check('but a bought copy is untouched', db.ownsSkin(BUYER, 'Albino'));
  check('because only weekly grants are ever reclaimed',
    !db.skinOwnersFrom('Albino', HELD_BY_WEEKLY).includes(BUYER),
    JSON.stringify(db.skinOwnersFrom('Albino', HELD_BY_WEEKLY)));

  // A week nobody played is not an error.
  const quiet = await closeWeek(ctx, client, '1999-W01', (m) => said.push(m));
  check('an empty week closes cleanly', quiet !== null && quiet.winners.length === 0,
    JSON.stringify(quiet));

  db.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
