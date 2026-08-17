// Points. The capping rule is the part that matters: without it, a bot that was
// down overnight pays everyone online for the whole outage on its first tick.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { awardFor, display, buildLeaderboardEmbed, buildBalanceEmbed } = await load('points.js');
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

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
