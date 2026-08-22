// How busy the server has been. Evrima keeps no history at all, so this is
// built entirely from readings the poll writes — which makes the bucketing the
// part worth pinning down: it is the only thing standing between a row of
// numbers and a claim about when the server is worth logging into.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { bucket, sparkline, buildPeakEmbed } = await load('peaks.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const NOW = new Date('2026-08-22T12:00:00.000Z');
const hoursAgo = (n) => new Date(NOW.getTime() - (n * 3600_000));
const at = (h, online) => ({ at: hoursAgo(h).toISOString(), online });

// ---- bucketing ------------------------------------------------------------

{
  const since = hoursAgo(24);
  const buckets = bucket([], since, 24, NOW);
  check('an empty history still produces every slot', buckets.length === 24);

  // Nothing recorded is not the same as nobody playing: the bot may have been
  // down. Drawing it as zero would state something untrue.
  check('slots with no readings stay unknown rather than zero',
    buckets.every((b) => b.peak === null));
}

{
  const since = hoursAgo(24);
  const buckets = bucket([at(23, 3), at(22, 7), at(1, 2)], since, 24, NOW);
  const filled = buckets.filter((b) => b.peak !== null);
  check('only the slots with readings are filled', filled.length === 3,
    String(filled.length));
  check('and the readings land oldest first',
    buckets.findIndex((b) => b.peak === 3) < buckets.findIndex((b) => b.peak === 2));
}

{
  // The whole reason for peak rather than mean: a server that hit twelve for
  // ten minutes and sat at one for the rest of the hour was busy.
  const since = hoursAgo(1);
  const buckets = bucket(
    [at(0.9, 1), at(0.8, 12), at(0.7, 1), at(0.6, 1)], since, 1, NOW);
  check('a slot reports its peak, not its average', buckets[0].peak === 12,
    String(buckets[0].peak));
}

{
  const since = hoursAgo(24);
  // Readings from before the window, and one from the future, must be ignored
  // rather than folded into the first or last slot.
  const buckets = bucket([at(48, 99), { at: new Date(NOW.getTime() + 60_000).toISOString(), online: 99 }],
    since, 24, NOW);
  check('readings outside the window are dropped',
    buckets.every((b) => b.peak === null));
}

{
  // A reading exactly at the end belongs in the last slot, not one past it.
  const since = hoursAgo(24);
  const buckets = bucket([{ at: NOW.toISOString(), online: 5 }], since, 24, NOW);
  check('a reading on the boundary lands in the last slot',
    buckets[23].peak === 5, JSON.stringify(buckets[23]));
}

// ---- the chart ------------------------------------------------------------

{
  const line = sparkline(bucket([], hoursAgo(24), 24, NOW));
  check('an empty week draws nothing rather than a flat floor',
    line.trim() === '', JSON.stringify(line));

  const busy = sparkline([
    { at: NOW, peak: 1 }, { at: NOW, peak: 4 }, { at: NOW, peak: 8 },
  ]);
  check('a bar per slot', busy.length === 3, JSON.stringify(busy));
  check('the busiest slot is the tallest block', busy.endsWith('█'), JSON.stringify(busy));
  check('and a quieter one is shorter', busy[0] !== busy[2]);

  // Scaled to the data, not to some imagined cap: a server peaking at six
  // scaled against a hundred is six identical flat lines.
  const small = sparkline([{ at: NOW, peak: 1 }, { at: NOW, peak: 6 }]);
  check('a small server still fills the chart', small.endsWith('█'), JSON.stringify(small));

  const gap = sparkline([{ at: NOW, peak: null }, { at: NOW, peak: 5 }]);
  check('an unknown slot is a gap, not a zero bar', gap[0] === ' ', JSON.stringify(gap));

  const zero = sparkline([{ at: NOW, peak: 0 }, { at: NOW, peak: 5 }]);
  check('a genuine zero draws the lowest bar, which is not a gap',
    zero[0] !== ' ' && zero[0] !== zero[1], JSON.stringify(zero));
}

// ---- the panels -----------------------------------------------------------

{
  const empty = buildPeakEmbed('day', null, bucket([], hoursAgo(24), 24, NOW), NOW).toJSON();
  check('with no history it says so rather than claiming zero players',
    /Nothing recorded/.test(empty.description ?? ''));

  const buckets = bucket([at(5, 9), at(4, 4)], hoursAgo(24), 24, NOW);
  const live = buildPeakEmbed('day', { online: 9, at: hoursAgo(5).toISOString() },
    buckets, NOW).toJSON();

  check('the peak is stated plainly', /\*\*9\*\*/.test(live.description ?? ''),
    live.description);
  check('and when it happened, in the reader’s own timezone',
    /<t:\d+:R>/.test(live.description ?? ''));
  check('the chart is in a code block so it lines up',
    (live.description ?? '').includes('```'));
  check('the day panel is titled for the day', /24 hours/.test(live.title ?? ''));

  const week = buildPeakEmbed('week', { online: 9, at: hoursAgo(5).toISOString() },
    bucket([at(5, 9)], hoursAgo(24 * 7), 7, NOW), NOW).toJSON();
  check('the week panel is titled for the week', /week/i.test(week.title ?? ''));
  check('and the two panels differ', week.title !== live.title);

  check('it fits inside an embed', JSON.stringify(live).length < 6000);
}

// ---- storage --------------------------------------------------------------

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'peaks.sqlite'));
  const ctx = { db };

  db.recordCount(3);
  db.recordCount(7);
  db.recordCount(1);

  const peak = db.peakSince(new Date(Date.now() - 3600_000));
  check('the busiest reading is found', peak?.online === 7, JSON.stringify(peak));
  check('every reading is kept', db.countsSince(new Date(Date.now() - 3600_000)).length === 3);
  check('nothing is found before the window',
    db.peakSince(new Date(Date.now() + 60_000)) === null);

  // Names, for the killfeed.
  db.rememberNames([{ steamId: '765', name: 'TheAbyssWalka' }]);
  check('an in-game name is remembered', db.gameName('765') === 'TheAbyssWalka');

  db.rememberNames([{ steamId: '765', name: 'Renamed' }]);
  check('and a rename replaces it', db.gameName('765') === 'Renamed');

  db.rememberNames([{ steamId: '766', name: '  ' }, { steamId: '', name: 'x' }]);
  check('a blank name is not stored', db.gameName('766') === null);
  check('somebody never seen has no name', db.gameName('nobody') === null);

  const removed = db.pruneCounts(new Date(Date.now() + 60_000));
  check('pruning clears what is past the horizon', removed === 3, String(removed));

  db.close();
  void ctx;
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
