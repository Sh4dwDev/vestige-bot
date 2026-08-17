// Periodic cleanup. The scheduler must fire the sweep once per cycle and warn
// first — a corpse someone is eating is about to vanish.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);
const cleanup = await import(pathToFileURL(path.join(root, 'dist/cleanup.js')).href);
const { isDue, nextRestart, TICK_MS } =
  await import(pathToFileURL(path.join(root, 'dist/restarts.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'cl.sqlite');
const db = new Database(file);
const ctx = { db, rcon: { wipeCorpses: async () => {}, announce: async () => {} } };

check('cleaning up is off until someone asks for it',
  cleanupSettingsOf().enabled === false);
check('the default interval is three hours',
  cleanupSettingsOf().hours === cleanup.DEFAULT_HOURS && cleanup.DEFAULT_HOURS === 3,
  String(cleanup.DEFAULT_HOURS));

cleanup.setCleanupEnabled(ctx, true);
cleanup.setCleanupHours(ctx, 6);
check('the setting survives a read back',
  cleanupSettingsOf().enabled === true && cleanupSettingsOf().hours === 6);

cleanup.setCleanupEnabled(ctx, false);
check('it can be turned off again', cleanupSettingsOf().enabled === false);
check('turning it off keeps the interval', cleanupSettingsOf().hours === 6);

// A stored nonsense value must not produce a schedule of zero-hour steps, which
// would wipe on every tick.
db.setSetting('cleanup_hours', 'abc');
check('a corrupt interval falls back to the default',
  cleanupSettingsOf().hours === cleanup.DEFAULT_HOURS);
db.setSetting('cleanup_hours', '0');
check('a zero interval falls back too, rather than wiping constantly',
  cleanupSettingsOf().hours === cleanup.DEFAULT_HOURS);

// Clock alignment: shared with restarts so the two are predictable together.
{
  const next = cleanup.nextCleanup(new Date('2026-08-16T01:00:00Z'), 3);
  check('the schedule lands on the clock', next.toISOString() === '2026-08-16T03:00:00.000Z',
    next.toISOString());
}

// Firing at all. This is a regression test for a real bug: the schedulers
// waited for "minutes <= 0", but the next slot is always strictly in the
// future, so the moment the clock reached it the answer jumped a whole
// interval ahead and the sweep never ran once.
{
  const slot = nextRestart(new Date('2026-08-16T01:00:00Z'), 3); // 03:00
  const at = (iso) => isDue(new Date(iso), slot);

  check('a slot an hour out is not due', at('2026-08-16T02:00:00Z') === false);
  check('a slot a minute out is not due yet', at('2026-08-16T02:59:00Z') === false);
  check('a slot one tick out IS due', at('2026-08-16T02:59:45Z') === true,
    `tick is ${TICK_MS}ms`);
  check('a slot reached exactly is due', at('2026-08-16T03:00:00Z') === true);

  // The bug in one line: with the old test, nothing in a whole cycle fired.
  let fired = 0;
  for (let t = 0; t < 3 * 60 * 60_000; t += TICK_MS) {
    const now = new Date(Date.parse('2026-08-16T00:00:01Z') + t);
    if (isDue(now, nextRestart(now, 3))) fired += 1;
  }
  check('walking a whole cycle in 20s ticks fires the sweep', fired >= 1, `${fired} time(s)`);
  check('and does not fire repeatedly', fired <= 2, `${fired} time(s)`);
}

// Colliding with a restart. Wiping twenty seconds before the world goes down
// achieves nothing, and the two warnings would stack in the same line.
{
  const at3 = new Date('2026-08-16T03:00:00Z');
  check('a cleanup landing on a restart is skipped',
    cleanup.collidesWithRestart(at3, at3, true) === true);
  check('a cleanup well clear of one runs',
    cleanup.collidesWithRestart(at3, new Date('2026-08-16T06:00:00Z'), true) === false);
  check('a cleanup a minute before a restart is still skipped',
    cleanup.collidesWithRestart(at3, new Date('2026-08-16T03:01:00Z'), true) === true);
  check('with restarts off, nothing is skipped',
    cleanup.collidesWithRestart(at3, at3, false) === false);

  // The real pairing: cleanup every 3h against restarts every 6h collide at
  // midnight, 06:00, 12:00 and 18:00 — half of all cleanup cycles.
  let skipped = 0;
  let ran = 0;
  for (let h = 0; h < 24; h += 3) {
    const slot = new Date(Date.UTC(2026, 7, 16, h));
    const restart = nextRestart(new Date(slot.getTime() - 1), 6);
    if (cleanup.collidesWithRestart(slot, restart, true)) skipped += 1; else ran += 1;
  }
  check('3h cleanup against 6h restarts skips exactly the shared slots',
    skipped === 4 && ran === 4, `${skipped} skipped, ${ran} ran`);
}

// The sweep itself.
{
  let wiped = 0;
  const ok = await cleanup.wipeNow(
    { rcon: { wipeCorpses: async () => { wiped += 1; } } }, () => {});
  check('wiping asks the server to clear corpses', ok === true && wiped === 1);
}
{
  const ok = await cleanup.wipeNow(
    { rcon: { wipeCorpses: async () => { throw new Error('down'); } } }, () => {});
  check('an unreachable server reports failure rather than throwing', ok === false);
}

// AI clearing. ToggleAI is a toggle, not a setter, and the reply is the only
// readout of where it landed. Real replies, captured live 2026-08-17.
check('the reply is read as On', cleanup.aiStateFromReply('[ts] AI spawns are now On') === true);
check('the reply is read as Off', cleanup.aiStateFromReply('[ts] AI spawns are now Off') === false);
check('an unrecognised reply is not guessed at',
  cleanup.aiStateFromReply('[ts] something else') === null);

/** A fake server that tracks AI state the way the real one reports it. */
function fakeAI(startOn, breakAfter = Infinity) {
  const state = { on: startOn, flips: 0 };
  return {
    state,
    rcon: {
      toggleAI: async () => {
        state.flips += 1;
        if (state.flips > breakAfter) throw new Error('down');
        state.on = !state.on;
        return `[ts] AI spawns are now ${state.on ? 'On' : 'Off'}`;
      },
    },
  };
}

{
  const ai = fakeAI(true);
  const result = await cleanup.clearAI(ai, () => {});
  check('with AI running, clearing cycles it off and back on',
    result === 'cleared' && ai.state.flips === 2, `${result}, ${ai.state.flips} flips`);
  check('and AI is left running afterwards', ai.state.on === true);
}

{
  // A blind "flip twice" would switch AI ON for five seconds on a server that
  // runs without it.
  const ai = fakeAI(false);
  const result = await cleanup.clearAI(ai, () => {});
  check('with AI already off, it reports there is nothing to clear',
    result === 'disabled', result);
  check('and AI is left off, not switched on for five seconds',
    ai.state.on === false);
  check('the revert is immediate', ai.state.flips === 2, `${ai.state.flips} flips`);
}

{
  const ai = fakeAI(true, 1);
  const result = await cleanup.clearAI(ai, () => {});
  check('failing to toggle back on is reported, not swallowed', result === 'inverted');
}
{
  const ai = fakeAI(false, 1);
  const result = await cleanup.clearAI(ai, () => {});
  check('failing to revert an accidental switch-on is reported too',
    result === 'inverted', result);
}
{
  const result = await cleanup.clearAI(
    { rcon: { toggleAI: async () => { throw new Error('down'); } } }, () => {});
  check('a server that is down leaves AI untouched', result === 'failed');
}

check('AI clearing is on unless it is turned off', cleanupSettingsOf().clearAI === true);
cleanup.setCleanupAI(ctx, false);
check('and it can be turned off', cleanupSettingsOf().clearAI === false);
cleanup.setCleanupAI(ctx, true);
check('and back on', cleanupSettingsOf().clearAI === true);

function cleanupSettingsOf() {
  return cleanup.cleanupSettings(ctx);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
