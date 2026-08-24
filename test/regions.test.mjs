// The Active Region.
//
// The rules decide who gets paid, so they are pure and tested here without a
// server: who is inside, who is idle, who accrues, and that nobody is paid
// twice however many times an event is finished.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  REGIONS, regionsFor, setRegionOverride, regionById, inside, distanceTo,
  pickRegion, tickEvent, qualified, payOut, startEvent, finishEvent,
  activeEvent, saveEvent, buildStartEmbed, buildEndEmbed, CHECK_SECONDS,
  AFK_MINUTES, DEFAULTS, scheduleNext, nextEventAt,
  addRegion, removeRegion, customRegions, slugFor,
} = await load('regions.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'region.sqlite');
const db = new Database(file);
const ctx = { db };

const A = '76561198000000001';
const B = '76561198000000002';

const region = { id: 'test', name: 'Test', x: 0, y: 0, radius: 100_000, enabled: true };
const at = (steam, x, y) => ({ steam, species: 'Rex', growth: 1, female: false, prime: false, x, y });

// ---- geometry ---------------------------------------------------------------

{
  check('somebody at the centre is inside', inside(region, at(A, 0, 0)));
  check('just inside the edge counts', inside(region, at(A, 99_000, 0)));
  check('just outside does not', !inside(region, at(A, 101_000, 0)));
  check('diagonal distance is real distance, not a box',
    !inside(region, at(A, 80_000, 80_000)), 'that corner is 113k away');

  // A stored or dead dinosaur reports no position and must never count.
  check('somebody with no position is never inside',
    !inside(region, { steam: A, species: 'Rex', growth: 1, female: false, prime: false }));

  check('distance is measured from the centre',
    Math.round(distanceTo(region, 30_000, 40_000)) === 50_000);
}

// ---- picking ----------------------------------------------------------------

{
  const list = [
    { ...region, id: 'one' }, { ...region, id: 'two' }, { ...region, id: 'three' },
  ];
  check('a region is picked', pickRegion(list, null, 0)?.id === 'one');

  // No immediate repeat, which is the whole point of remembering the last one.
  const after = pickRegion(list, 'one', 0);
  check('the last one is not picked again', after?.id !== 'one', after?.id);

  // Unless it is the only one, where refusing would mean never running.
  const alone = [{ ...region, id: 'only' }];
  check('a lone region repeats rather than stalling',
    pickRegion(alone, 'only', 0)?.id === 'only');

  check('disabled regions are never picked',
    pickRegion([{ ...region, id: 'off', enabled: false }], null, 0) === null);
  check('an empty list is not an error', pickRegion([], null, 0) === null);
}

// ---- accruing ---------------------------------------------------------------

const baseEvent = (over = {}) => ({
  eventId: 'AR-test',
  regionId: 'test',
  regionName: 'Test',
  startedAt: 0,
  endsAt: 60 * 60_000,
  reward: 300,
  requiredMinutes: 15,
  minPlayers: 2,
  participants: {},
  rewarded: false,
  lastCheck: 0,
  ...over,
});

{
  const first = tickEvent(baseEvent(), region, [at(A, 0, 0)], 30_000);
  check('the first sighting credits nothing',
    (first.event.participants[A]?.seconds ?? 0) === 0,
    JSON.stringify(first.event.participants[A]));
  check('but it is remembered', first.event.participants[A] !== undefined);
  check('and reported as an entry', first.entered.includes(A));

  const second = tickEvent(first.event, region, [at(A, 5_000, 0)], 60_000);
  check('the second sighting credits the gap',
    second.event.participants[A]?.seconds === 30,
    String(second.event.participants[A]?.seconds));
  check('and is not a second entry', !second.entered.includes(A));
}

{
  // Outside the region accrues nothing, however long they stand there.
  const away = tickEvent(baseEvent(), region, [at(A, 500_000, 0)], 30_000);
  check('somebody outside is not a participant',
    away.event.participants[A] === undefined);

  // No Steam account is no identity and nothing can be paid to it.
  const anon = tickEvent(baseEvent(), region,
    [{ species: 'Rex', growth: 1, female: false, prime: false, x: 0, y: 0 }], 30_000);
  check('somebody unlinked is skipped',
    Object.keys(anon.event.participants).length === 0);
}

{
  // Resting, hiding and eating must all still count. Only somebody who has not
  // moved at all for a long stretch stops accruing.
  let state = tickEvent(baseEvent(), region, [at(A, 0, 0)], 0).event;
  state = tickEvent(state, region, [at(A, 0, 0)], 30_000).event;
  check('standing still briefly still accrues',
    (state.participants[A]?.seconds ?? 0) > 0);

  // Now push past the AFK window with no movement at all.
  const idleAt = (AFK_MINUTES * 60_000) + 60_000;
  const idle = tickEvent(state, region, [at(A, 0, 0)], idleAt);
  check('no movement for a long stretch stops the clock', idle.afk.includes(A));
  check('and nothing more is credited',
    idle.event.participants[A]?.seconds === state.participants[A]?.seconds);

  // Moving again resumes it.
  const moved = tickEvent(idle.event, region, [at(A, 50_000, 0)], idleAt + 30_000);
  check('moving again resumes accrual', !moved.afk.includes(A));
}

{
  // Leaving keeps the time and reports the edge.
  let state = tickEvent(baseEvent(), region, [at(A, 0, 0)], 0).event;
  state = tickEvent(state, region, [at(A, 1_000, 0)], 60_000).event;
  const before = state.participants[A]?.seconds ?? 0;

  const gone = tickEvent(state, region, [at(A, 900_000, 0)], 90_000);
  check('leaving is reported', gone.left.includes(A));
  check('and the time is kept', gone.event.participants[A]?.seconds === before,
    String(gone.event.participants[A]?.seconds));

  // Coming back is a fresh entry, and the time carries on from where it was.
  const back = tickEvent(gone.event, region, [at(A, 0, 0)], 120_000);
  check('coming back is a new entry', back.entered.includes(A));
  check('with the old time intact', back.event.participants[A]?.seconds === before);
}

// ---- qualifying and paying --------------------------------------------------

{
  const event = baseEvent({
    participants: {
      [A]: { seconds: 15 * 60, movedAt: 0 },
      [B]: { seconds: 5 * 60, movedAt: 0 },
    },
  });

  check('somebody with the time qualifies', qualified(event).includes(A));
  check('somebody short does not', !qualified(event).includes(B));
}

{
  // Fewer than the minimum pays nobody, so an event nobody joined cannot be
  // farmed by one person.
  const event = baseEvent({ participants: { [A]: { seconds: 20 * 60, movedAt: 0 } } });
  const payout = payOut(ctx, event, () => undefined);
  check('one qualifier below the minimum pays nobody', payout.paid.length === 0);
  check('and says the minimum was not met', payout.enough === false);
  check('no points moved', db.pointsFor(A).balance === 0);
}

{
  const event = baseEvent({
    participants: {
      [A]: { seconds: 20 * 60, movedAt: 0 },
      [B]: { seconds: 16 * 60, movedAt: 0 },
    },
  });

  const payout = payOut(ctx, event, () => undefined);
  check('two qualifiers are paid', payout.paid.length === 2, JSON.stringify(payout.paid));
  check('the points land', db.pointsFor(A).balance === 300 && db.pointsFor(B).balance === 300);

  // The whole reason `rewarded` exists: a restart, a repeated finish, or two
  // callers must not pay the same event twice.
  const again = payOut(ctx, { ...event, rewarded: true }, () => undefined);
  check('a second payout is refused', again.paid.length === 0);
  check('and balances do not move', db.pointsFor(A).balance === 300);
}

{
  // A test event reports who would have qualified and pays nobody.
  const event = baseEvent({
    dryRun: true,
    participants: {
      [A]: { seconds: 20 * 60, movedAt: 0 },
      [B]: { seconds: 20 * 60, movedAt: 0 },
    },
  });
  const before = db.pointsFor(A).balance;
  const payout = payOut(ctx, event, () => undefined);
  check('a test event pays nobody', payout.paid.length === 0 && payout.dryRun === true);
  check('and moves no points', db.pointsFor(A).balance === before);
}

// ---- the lifecycle ----------------------------------------------------------

{
  saveEvent(ctx, null);
  addRegion(ctx, {
    id: 'lifecycle', name: 'Lifecycle', x: 0, y: 0, radius: 100_000, enabled: true,
  });
  const started = startEvent(ctx, { regionId: 'lifecycle', minutes: 5 }, 1_000);
  check('an event starts', started.ok === true, started.ok ? '' : started.reason);
  check('and is the active one', activeEvent(ctx)?.eventId === started.event.eventId);

  // Two at once would split everybody, which is the opposite of the point.
  const second = startEvent(ctx, {}, 2_000);
  check('a second is refused while one runs', second.ok === false);

  const payout = finishEvent(ctx, started.event, () => undefined);
  check('finishing clears it', activeEvent(ctx) === null);
  check('nobody qualified in five seconds', payout.paid.length === 0);
  check('and the next one is scheduled', nextEventAt(ctx) > 0);

  // Tidied up, or it counts against the custom-region checks further down.
  removeRegion(ctx, 'lifecycle');
}

{
  const missing = startEvent(ctx, { regionId: 'nosuchplace' }, 1_000);
  check('an unknown region is refused', missing.ok === false);
  saveEvent(ctx, null);
}

// ---- regions and overrides --------------------------------------------------

{
  // Nothing ships. Invented coordinates that look like data get used like
  // data, and an event on a made-up centre sends people to an empty patch.
  check('no regions ship with the feature', REGIONS.length === 0);

  addRegion(ctx, {
    id: 'basin', name: 'Basin', x: 10_000, y: 20_000, radius: 100_000, enabled: true,
  });
  setRegionOverride(ctx, 'basin', { x: 12_345, y: 67_890 });
  const moved = regionById(ctx, 'basin');
  check('a region can be moved', moved?.x === 12_345 && moved?.y === 67_890);

  // Otherwise the old position returns if the name is ever reused.
  removeRegion(ctx, 'basin');
  addRegion(ctx, {
    id: 'basin', name: 'Basin', x: 999, y: 888, radius: 100_000, enabled: true,
  });
  check('removing clears its override too', regionById(ctx, 'basin')?.x === 999,
    String(regionById(ctx, 'basin')?.x));
  removeRegion(ctx, 'basin');

  db.setSetting('region_overrides', 'not json');
  check('unreadable overrides are survivable', Array.isArray(regionsFor(ctx)));
}

// ---- regions of your own ----------------------------------------------------
//
// The shipped five are a starting point, not the map. The areas a server
// actually gathers in already have names, and those are the ones people will
// travel to.

{
  check('a name becomes a readable id', slugFor('North Plains') === 'north-plains');
  check('punctuation and doubles collapse', slugFor("The  Devil's Pass!") === 'the-devil-s-pass');
  check('a nonsense name yields nothing to save', slugFor('!!!') === '');

  addRegion(ctx, {
    id: 'north-plains', name: 'North Plains', x: 500_000, y: 500_000,
    radius: 120_000, enabled: true,
  });

  check('a custom region is kept', customRegions(ctx).length === 1);
  check('and appears alongside the built-in ones',
    regionsFor(ctx).some((r) => r.id === 'north-plains'));
  check('with its own centre', regionById(ctx, 'north-plains')?.x === 500_000);

  // It has to be pickable, or adding one achieves nothing.
  check('and it can be chosen for an event',
    pickRegion(regionsFor(ctx), null, 0.99) !== null);

  // Adding the same name again edits rather than duplicating.
  addRegion(ctx, {
    id: 'north-plains', name: 'North Plains', x: 1_000, y: 2_000,
    radius: 90_000, enabled: true,
  });
  check('adding it twice moves it rather than duplicating',
    customRegions(ctx).length === 1 && regionById(ctx, 'north-plains')?.x === 1_000);

  // move works on a custom one exactly as on a built-in.
  setRegionOverride(ctx, 'north-plains', { x: 7_777 });
  check('a custom region can be moved too',
    regionById(ctx, 'north-plains')?.x === 7_777);

  check('a custom region can be removed', removeRegion(ctx, 'north-plains') === true);
  check('and is gone', !regionsFor(ctx).some((r) => r.id === 'north-plains'));

  check('removing something that does not exist is refused',
    removeRegion(ctx, 'never-existed') === false);

  // A broken list must be survivable rather than throwing on every read.
  db.setSetting('region_custom', 'not json');
  check('unreadable custom regions read as empty', regionsFor(ctx).length === 0);
  db.setSetting('region_custom', '');
}

// ---- what people see --------------------------------------------------------

{
  const event = baseEvent();
  const start = buildStartEmbed(event).toJSON();
  check('the start embed names the region', /Test/.test(start.title ?? ''));
  check('and says what is needed', /15/.test(start.description ?? ''));
  // The promise of the feature: it must not leak positions.
  check('and promises no locations are shown',
    /No exact locations/.test(JSON.stringify(start.fields ?? [])));

  const short = buildEndEmbed(event, { paid: [], reward: 300, enough: false, dryRun: false },
    [60, 90]).toJSON();
  check('too few players is said plainly',
    /No rewards/.test(JSON.stringify(short.fields ?? [])));

  const paid = buildEndEmbed(event, { paid: [A, B], reward: 300, enough: true, dryRun: false },
    [60, 90]).toJSON();
  check('a payout reports the count', /2/.test(JSON.stringify(paid.fields ?? [])));
  check('and when the next one is', /60/.test(JSON.stringify(paid.fields ?? [])));
  check('both fit Discord limits',
    [start, short, paid].every((e) => JSON.stringify(e).length < 6000
      && (e.fields ?? []).every((f) => f.value.length <= 1024)));
}

check('the check interval is sane', CHECK_SECONDS >= 10 && CHECK_SECONDS <= 120);
check('the default gap is a real wait',
  DEFAULTS.gapMinMinutes >= 30 && DEFAULTS.gapMaxMinutes > DEFAULTS.gapMinMinutes);

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
