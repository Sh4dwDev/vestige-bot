// Restart scheduling. Every subtle scheduler bug is a boundary: exactly on the
// hour, or across midnight. Both are checked here rather than discovered at 3am.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { nextRestart, minutesUntil, buildRestartEmbed, WARNINGS } = await load('restarts.js');
const { buildStatusEmbed } = await load('status.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const at = (iso) => new Date(iso);
const iso = (d) => d.toISOString();

// ---- six-hourly, the default -----------------------------------------------

check('midnight schedules the 06:00 slot',
  iso(nextRestart(at('2026-08-16T00:00:00Z'), 6)) === '2026-08-16T06:00:00.000Z',
  iso(nextRestart(at('2026-08-16T00:00:00Z'), 6)));

check('a minute before a slot picks that slot',
  iso(nextRestart(at('2026-08-16T05:59:00Z'), 6)) === '2026-08-16T06:00:00.000Z');

// The important one: exactly on the hour must move forward, or the scheduler
// would sit on a restart it has already done and fire warnings forever.
check('exactly on a slot moves to the next one',
  iso(nextRestart(at('2026-08-16T06:00:00Z'), 6)) === '2026-08-16T12:00:00.000Z',
  iso(nextRestart(at('2026-08-16T06:00:00Z'), 6)));

check('late evening rolls over midnight',
  iso(nextRestart(at('2026-08-16T23:30:00Z'), 6)) === '2026-08-17T00:00:00.000Z',
  iso(nextRestart(at('2026-08-16T23:30:00Z'), 6)));

check('rolls over a month boundary',
  iso(nextRestart(at('2026-08-31T23:45:00Z'), 6)) === '2026-09-01T00:00:00.000Z');

{
  // A full day of six-hourly slots must be exactly the four expected times.
  const slots = new Set();
  for (let m = 0; m < 24 * 60; m += 7) {
    const now = new Date(Date.UTC(2026, 7, 16, 0, m));
    slots.add(iso(nextRestart(now, 6)).slice(11, 16));
  }
  check('a whole day only ever yields the four slots',
    [...slots].sort().join(',') === '00:00,06:00,12:00,18:00',
    [...slots].sort().join(','));
}

// ---- other intervals --------------------------------------------------------

check('hourly works', iso(nextRestart(at('2026-08-16T09:20:00Z'), 1)) === '2026-08-16T10:00:00.000Z');
check('four-hourly works', iso(nextRestart(at('2026-08-16T09:20:00Z'), 4)) === '2026-08-16T12:00:00.000Z');
check('daily lands on midnight',
  iso(nextRestart(at('2026-08-16T09:20:00Z'), 24)) === '2026-08-17T00:00:00.000Z');

check('a nonsense interval does not hang or return the past',
  nextRestart(at('2026-08-16T09:20:00Z'), 0).getTime() > at('2026-08-16T09:20:00Z').getTime());

// ---- countdown --------------------------------------------------------------

check('minutes round up, so "1 minute" never shows as 0',
  minutesUntil(at('2026-08-16T05:59:30Z'), at('2026-08-16T06:00:00Z')) === 1,
  String(minutesUntil(at('2026-08-16T05:59:30Z'), at('2026-08-16T06:00:00Z'))));

check('a full hour out reads as 60',
  minutesUntil(at('2026-08-16T05:00:00Z'), at('2026-08-16T06:00:00Z')) === 60);

check('past the restart is zero or negative',
  minutesUntil(at('2026-08-16T06:00:01Z'), at('2026-08-16T06:00:00Z')) <= 0);

check('warnings are ordered longest-first and all positive',
  WARNINGS.every((w, n) => w > 0 && (n === 0 || w < WARNINGS[n - 1])),
  WARNINGS.join(', '));

// ---- embeds -----------------------------------------------------------------

{
  const early = buildRestartEmbed(60, at('2026-08-16T06:00:00Z')).toJSON();
  const late = buildRestartEmbed(1, at('2026-08-16T06:00:00Z')).toJSON();

  check('an early warning is calm', /Scheduled restart/.test(early.title ?? ''));
  check('a late warning is urgent', /imminent/i.test(late.title ?? ''));
  check('urgency is colour coded', early.color !== late.color);
  check('the time is a Discord timestamp, which renders in every timezone',
    /<t:\d+:R>/.test(early.description ?? ''));
}

{
  const up = buildStatusEmbed({ online: 12, max: 100 }, at('2026-08-16T06:00:00Z')).toJSON();
  const down = buildStatusEmbed({ online: null, max: 100 }, null).toJSON();
  const unknown = buildStatusEmbed({ online: 3, max: null }, null).toJSON();

  check('online shows the count against capacity', /12 \/ 100/.test(up.description ?? ''),
    up.description);
  check('online shows the next restart', /Next restart/.test(up.description ?? ''));
  check('offline still renders', /Offline/.test(down.description ?? ''));
  check('offline is red', down.color === 0xed4245);
  check('an unknown capacity does not print "/0"', !/\/\s*0/.test(unknown.description ?? ''),
    unknown.description);
  check('status embeds stay within the 6000 char limit',
    JSON.stringify(up).length < 6000 && JSON.stringify(down).length < 6000);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
