// Points. The capping rule is the part that matters: without it, a bot that was
// down overnight pays everyone online for the whole outage on its first tick.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  awardFor, display, buildLeaderboardEmbed, buildBalanceEmbed,
  isWeekend, osloTime, describeWindow, windowInstance, weekendActive, setWeekendBonus, setWeekendWindow,
  weekendWindow, weekendBonus,
} = await load('points.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---- accrual ----------------------------------------------------------------

check('a minute at 60/hour is one point', near(awardFor(60_000, 60).points, 1),
  String(awardFor(60_000, 60).points));
check('half an hour at 60/hour is capped, not 30 points',
  awardFor(30 * 60_000, 60).points <= 5, String(awardFor(30 * 60_000, 60).points));
check('an overnight outage pays at most the cap',
  near(awardFor(8 * 3_600_000, 60).points, 5), String(awardFor(8 * 3_600_000, 60).points));
check('a zero gap pays nothing', awardFor(0, 60).points === 0);
check('a negative gap pays nothing, rather than taking points away',
  awardFor(-60_000, 60).points === 0, String(awardFor(-60_000, 60).points));
check('a zero rate pays nothing', awardFor(60_000, 0).points === 0);
check('a fractional rate is not rounded away',
  awardFor(60_000, 30).points > 0, String(awardFor(60_000, 30).points));

check('balances are floored, so no argument about rounding',
  display(41.9) === 41 && display(0.4) === 0);

// ---- storage ----------------------------------------------------------------

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'points.sqlite');
const db = new Database(file);
const A = '76561198000000001';
const B = '76561198000000002';

check('an unknown player reads as zero, not undefined',
  db.pointsFor(A).balance === 0 && db.pointsFor(A).minutes === 0);

db.addPoints(A, 10, 1);
db.addPoints(A, 5, 1);
check('points accumulate', db.pointsFor(A).balance === 15, String(db.pointsFor(A).balance));
check('minutes accumulate', db.pointsFor(A).minutes === 2);

db.awardOnline([A, B], 2.5, 1);
check('awarding many pays each of them',
  near(db.pointsFor(A).balance, 17.5) && near(db.pointsFor(B).balance, 2.5),
  `${db.pointsFor(A).balance} / ${db.pointsFor(B).balance}`);

db.setPoints(B, 100);
check('setting replaces rather than adds', db.pointsFor(B).balance === 100);

// A negative balance with a shop attached would be a bug worth preventing early.
db.setPoints(B, -50);
check('a balance cannot go negative', db.pointsFor(B).balance === 0,
  String(db.pointsFor(B).balance));

db.setPoints(A, 500);
db.setPoints(B, 900);
const top = db.topPoints(10);
check('the leaderboard is ordered by balance', top[0].steamId === B && top[1].steamId === A,
  top.map((r) => r.balance).join(', '));
check('the leaderboard respects its limit', db.topPoints(1).length === 1);

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

// ---- embeds -----------------------------------------------------------------

{
  const empty = buildLeaderboardEmbed([], () => 'x').toJSON();
  check('an empty leaderboard renders', /Nobody has earned/.test(empty.description ?? ''));

  const full = buildLeaderboardEmbed(
    Array.from({ length: 10 }, (_, n) => ({
      steamId: `7656119800000000${n}`, balance: 1000 - n, minutes: 120,
    })),
    (s) => `\`${s.slice(-4)}\``,
  ).toJSON();
  check('a full leaderboard stays within limits', JSON.stringify(full).length < 6000,
    `${JSON.stringify(full).length}`);
  check('the top three get medals', /🥇/.test(full.description ?? ''));

  // Rank four used to fall through to a bare number, which reads as a missing
  // icon rather than fourth place.
  check('fourth place has an icon too', /4️⃣/.test(full.description ?? ''),
    (full.description ?? '').split('\n')[3]);
  // Compared against rankIcon itself rather than a regex: the numeral emoji
  // genuinely begin with a digit, which fooled the first version of this check.
  const { rankIcon } = await import(pathToFileURL(path.join(root, 'dist/ranks.js')).href);
  const lines = (full.description ?? '').split('\n');
  check('every row carries its own rank marker',
    lines.every((line, n) => line.startsWith(rankIcon(n))),
    lines.find((line, n) => !line.startsWith(rankIcon(n))));

  const balance = buildBalanceEmbed(1234.9, 125, 60).toJSON();
  check('a balance is shown floored and grouped', /1,234/.test(balance.description ?? ''),
    balance.description);
  check('playtime reads in hours and minutes', /2h 5m/.test(balance.description ?? ''));
}

// ---- the weekend bonus -----------------------------------------------------
//
// A flat amount per hour rather than a multiplier. Tier multipliers already
// reach x3, so doubling at the weekend would have a Rex earning six times a
// Dryosaurus - widening the gap the tiers set rather than respecting it.

const WINDOW = { startDay: 5, startHour: 18, endDay: 1, endHour: 6 };
const oslo = (iso) => new Date(iso);

{
  // Times given in UTC; the window is Norwegian, so these differ by the offset.
  check('Friday before six is still a weekday',
    !isWeekend(oslo('2026-08-21T15:00:00Z'), WINDOW));
  check('Friday evening starts it', isWeekend(oslo('2026-08-21T16:30:00Z'), WINDOW));
  check('Saturday counts', isWeekend(oslo('2026-08-22T10:00:00Z'), WINDOW));
  check('so does late Sunday', isWeekend(oslo('2026-08-23T21:00:00Z'), WINDOW));
  check('Monday before six still counts', isWeekend(oslo('2026-08-24T03:30:00Z'), WINDOW));
  check('Monday after six does not', !isWeekend(oslo('2026-08-24T05:00:00Z'), WINDOW));
  check('midweek is never in it', !isWeekend(oslo('2026-08-19T10:00:00Z'), WINDOW));
}

{
  // Norway moves twice a year. A fixed +1 would shift the whole window for half
  // the year, so the zone is read through Intl instead.
  const winter = oslo('2026-01-16T17:30:00Z');   // 18:30 Oslo, CET
  const summer = oslo('2026-08-21T16:30:00Z');   // 18:30 Oslo, CEST
  check('the window holds in winter', isWeekend(winter, WINDOW));
  check('and in summer', isWeekend(summer, WINDOW));
  check('the same UTC hour is not in both',
    isWeekend(oslo('2026-01-16T16:30:00Z'), WINDOW) === false,
    'winter 17:30 Oslo');
}

{
  const t = osloTime(oslo('2026-08-22T10:00:00Z'));
  check('Oslo time is read as Oslo, not UTC', t.day === 6 && t.hour === 12,
    `day ${t.day} hour ${t.hour}`);
}

{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-wk-'));
  const db = new Database(path.join(dir, 'wk.sqlite'));
  const ctx = { db };

  check('there is a bonus by default', weekendBonus(ctx) > 0);
  check('and it defaults to Friday evening', weekendWindow(ctx).startDay === 5);

  setWeekendBonus(ctx, 0);
  check('zero turns it off entirely', weekendActive(ctx, oslo('2026-08-22T10:00:00Z')) === false);

  setWeekendBonus(ctx, 30);
  check('and setting it back turns it on',
    weekendActive(ctx, oslo('2026-08-22T10:00:00Z')) === true);
  check('but only inside the window',
    weekendActive(ctx, oslo('2026-08-19T10:00:00Z')) === false);

  setWeekendWindow(ctx, { startDay: 3, startHour: 0, endDay: 4, endHour: 0 });
  check('a custom window is honoured',
    weekendActive(ctx, oslo('2026-08-19T10:00:00Z')) === true, 'Wednesday');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  // The window is defined in Oslo, but nobody reading it is necessarily there.
  // Discord renders <t:...> in the reader's own timezone, which is the only
  // form that is right for everybody at once.
  const tuesday = new Date('2026-08-25T12:00:00Z');
  const saturday = new Date('2026-08-29T12:00:00Z');

  check('the window is sent as Discord timestamps, not a named zone',
    /^<t:\d+:F> to <t:\d+:F>, every week$/.test(describeWindow(WINDOW, tuesday)),
    describeWindow(WINDOW, tuesday));
  check('and names no timezone of its own',
    !/CET|CEST|Norwegian|Oslo/.test(describeWindow(WINDOW, tuesday)),
    describeWindow(WINDOW, tuesday));

  const oslo = (ms) => new Date(ms).toLocaleString('en-GB',
    { timeZone: 'Europe/Oslo', weekday: 'short', hour: '2-digit', minute: '2-digit' });

  const upcoming = windowInstance(WINDOW, tuesday);
  check('midweek points at the window still to come',
    /^Fri,? 18:00$/.test(oslo(upcoming.start)) && /^Mon,? 06:00$/.test(oslo(upcoming.end)),
    `${oslo(upcoming.start)} -> ${oslo(upcoming.end)}`);

  // Mid-window it must show the one running now, not next week's.
  const running = windowInstance(WINDOW, saturday);
  check('and inside it, the one currently running',
    running.start < saturday.getTime() && running.end > saturday.getTime(),
    `${new Date(running.start).toISOString()} -> ${new Date(running.end).toISOString()}`);

  // The clocks go back inside this window, so it is 61 hours long, not 60.
  // Resolving both ends separately is what gets this right; adding a duration
  // to the start would not.
  const clockChange = windowInstance(WINDOW, new Date('2026-10-24T12:00:00Z'));
  check('a window spanning a daylight saving change keeps both ends correct',
    (clockChange.end - clockChange.start) / 3_600_000 === 61,
    String((clockChange.end - clockChange.start) / 3_600_000));

  const on = buildBalanceEmbed(100, 60, 60,
    { bonus: 30, active: true, window: WINDOW }).toJSON();
  check('an active bonus is announced on the balance',
    /Weekend bonus is on/.test(on.description ?? ''));

  const off = buildBalanceEmbed(100, 60, 60,
    { bonus: 30, active: false, window: WINDOW }).toJSON();
  check('and when it is not on, it says when it will be, in the reader own timezone',
    /<t:\d+:F> to <t:\d+:F>/.test(off.description ?? ''), off.description ?? '');

  const none = buildBalanceEmbed(100, 60, 60).toJSON();
  check('a server without one says nothing about it',
    !/[Ww]eekend/.test(none.description ?? ''));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
