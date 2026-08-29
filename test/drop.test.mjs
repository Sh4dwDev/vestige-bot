// The Drop: a race to find something. The rules that matter are where it lands,
// when hints sharpen, and who is judged to have found it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  placeDrop, blur, hintText, dropStep, warming, startDrop, claimDrop,
  activeDrop, saveDrop, HINT_PRECISION, HINT_EVERY_MS,
  buildDropStatusEmbed, nearestLine,
} = await load('drop.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const NOW = 1_800_000_000_000;
const A = '76561198000000001';
const B = '76561198000000002';

const at = (steam, x, y) => ({ steam, species: 'Rex', growth: 1, female: false, prime: false, x, y });

const fresh = () => new Database(
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'drop.sqlite'));

const base = (over = {}) => ({
  x: 0, y: 0, radius: 12_000, reward: 1000,
  startedAt: NOW, endsAt: NOW + (20 * 60_000),
  hintsGiven: 1, lastHintAt: NOW, ...over,
});

// ---- where it lands ---------------------------------------------------------

{
  // Between two players, because a random point on the map can be the sea, a
  // cliff, or the corner nobody plays in, and a prize nobody can reach is worse
  // than no event.
  const spot = placeDrop([at(A, 0, 0), at(B, 100_000, 0)], () => 0.5);
  check('it lands between two players',
    spot.x > 0 && spot.x < 100_000, JSON.stringify(spot));

  // With one player it still has to be a journey rather than under their feet.
  const solo = placeDrop([at(A, 0, 0)], () => 0.5);
  const away = Math.hypot(solo.x, solo.y);
  check('one player gets a trip, not a spot on their head',
    away >= 250_000 && away <= 500_000, String(Math.round(away)));

  check('nobody online means nowhere to put it', placeDrop([], () => 0.5) === null);
  check('and a player the server cannot locate does not count',
    placeDrop([{ steam: A }], () => 0.5) === null);
}

// ---- the hints --------------------------------------------------------------

{
  // A hint names an area, and says how wide that area is. Leaving people to
  // work out the slack in a rounded number turns a search into an argument.
  check('coordinates are blurred to the stated precision',
    blur(123_400, 50) === 100 && blur(176_000, 50) === 200,
    `${blur(123_400, 50)} / ${blur(176_000, 50)}`);

  const drop = base({ x: 123_400, y: 61_000 });

  // Given as a range, not a centre and a tolerance. "Within 200 of Lat 400" was
  // wrong as well as unclear: rounding to the nearest 200 puts the real spot a
  // hundred either side, so it overstated the box by double.
  const bounds = (text) => text.match(/-?\d+(\.\d+)?/g).map(Number);

  const first = bounds(hintText(drop, 0));
  const last = bounds(hintText(drop, HINT_PRECISION.length - 1));
  check('the first hint is a wide box', first[1] - first[0] === HINT_PRECISION[0],
    hintText(drop, 0));
  check('and the last is a tight one',
    last[1] - last[0] === HINT_PRECISION[HINT_PRECISION.length - 1],
    hintText(drop, HINT_PRECISION.length - 1));
  check('every bound is a whole number, like the HUD shows',
    [...first, ...last].every((n) => Number.isInteger(n)),
    `${hintText(drop, 0)} / ${hintText(drop, HINT_PRECISION.length - 1)}`);

  // The property that matters: a hint that does not contain the drop sends the
  // whole server to the wrong place. Checked across the map rather than on one
  // example, because this is rounding code.
  let misses = 0;
  for (let n = 0; n < 2000; n += 1) {
    const spot = base({
      x: Math.round((Math.random() - 0.5) * 1_200_000),
      y: Math.round((Math.random() - 0.5) * 1_200_000),
    });
    const lat = Math.round(spot.y / 1000);
    const long = Math.round(spot.x / 1000);

    for (let i = 0; i < HINT_PRECISION.length; i += 1) {
      const [latLow, latHigh, longLow, longHigh] = bounds(hintText(spot, i));
      if (lat < latLow || lat > latHigh || long < longLow || long > longHigh) misses += 1;
    }
  }
  check('every hint contains the drop, everywhere on the map', misses === 0,
    `${misses} miss(es) in 8000`);

  check('and asking past the end does not crash',
    typeof hintText(drop, 99) === 'string', hintText(drop, 99));
}

{
  const drop = base();
  check('nothing happens before a hint is due',
    dropStep(drop, [], NOW + 1000).kind === 'waiting');

  const due = dropStep(drop, [], NOW + HINT_EVERY_MS);
  check('then a hint goes out', due.kind === 'hint', due.kind);
  check('and it is recorded, so it is not repeated',
    due.kind === 'hint' && due.drop.hintsGiven === 2 && due.drop.lastHintAt === NOW + HINT_EVERY_MS);

  // Once the area is as tight as it gets, it stops narrowing rather than
  // eventually announcing the exact spot.
  const spent = base({ hintsGiven: HINT_PRECISION.length, lastHintAt: NOW });
  check('hints stop once they are as sharp as they get',
    dropStep(spent, [], NOW + HINT_EVERY_MS).kind === 'waiting');
}

// ---- finding it -------------------------------------------------------------

{
  const drop = base();

  check('standing on it finds it',
    dropStep(drop, [at(A, 5_000, 5_000)], NOW + 1000).kind === 'found');
  check('and standing outside it does not',
    dropStep(drop, [at(A, 40_000, 0)], NOW + 1000).kind === 'waiting');

  // Finding it beats the clock. Telling somebody standing on the drop that they
  // were a second late would be indefensible.
  const late = dropStep(drop, [at(A, 0, 0)], drop.endsAt + 1);
  check('finding it as time runs out still counts', late.kind === 'found', late.kind);

  check('and an empty island just expires',
    dropStep(drop, [], drop.endsAt + 1).kind === 'expired');
}

{
  // Warm notices: once each, and only for the last stretch, so the notice tells
  // somebody their next thirty seconds matter rather than walking them in.
  const drop = base();
  const close = at(A, 20_000, 0);

  const first = warming(drop, [close, at(B, 500_000, 0)]);
  check('somebody close is told', first.steam.length === 1 && first.steam[0] === A,
    JSON.stringify(first.steam));
  check('and somebody far away is not', !first.steam.includes(B));

  const again = warming(first.drop, [close]);
  check('and they are not told twice', again.steam.length === 0, JSON.stringify(again.steam));
}

// ---- starting and paying ----------------------------------------------------

{
  const db = fresh();
  const ctx = { db };
  db.savePreset('Trophy', { colours: { BodyColor: '#AA0000' } }, 'staff');

  const nobody = startDrop(ctx, [], { reward: 1000, minutes: 20, radius: 12 }, NOW, () => 0.5);
  check('it refuses to drop onto an empty island', nobody.ok === false, JSON.stringify(nobody));

  const started = startDrop(
    ctx, [at(A, 0, 0), at(B, 100_000, 0)],
    { reward: 1000, minutes: 20, radius: 12, skin: 'Trophy' }, NOW, () => 0.5);
  check('it starts when somebody is on', started.ok === true);
  check('the radius is stored in world units, not HUD units',
    started.ok && started.drop.radius === 12_000, String(started.ok && started.drop.radius));
  check('the opening announcement counts as the first hint',
    started.ok && started.drop.hintsGiven === 1);
  check('and it is saved', activeDrop(ctx) !== null);

  const second = startDrop(ctx, [at(A, 0, 0)], { reward: 1, minutes: 5, radius: 12 }, NOW, () => 0.5);
  check('two at once is refused', second.ok === false, JSON.stringify(second));

  claimDrop(ctx, started.drop, A);
  check('the finder is paid', db.pointsFor(A).balance === 1000, String(db.pointsFor(A).balance));
  check('and keeps the skin', db.ownsSkin(A, 'Trophy'));
  check('and it is cleared, so it cannot be claimed twice', activeDrop(ctx) === null);

  saveDrop(ctx, null);
  db.close();
}

// ---- the staff view ---------------------------------------------------------

{
  // It exists to answer one question: does this need a nudge. A bare distance
  // does not answer it, and "1 hint(s) given" answers nothing at all.
  const drop = base({ x: 499_000, y: 193_000, hintsGiven: 1 });

  check('a distance is given against the radius that matters',
    nearestLine(drop, 295).includes('295') && nearestLine(drop, 295).includes('12'),
    nearestLine(drop, 295));
  check('and standing on it says so',
    nearestLine(drop, 4).includes('about to be found'), nearestLine(drop, 4));
  check('a long way off says that plainly',
    nearestLine(drop, 295).includes('nowhere near'), nearestLine(drop, 295));
  check('and an empty server is not reported as distance zero',
    nearestLine(drop, null).includes('Nobody'), nearestLine(drop, null));

  const embed = buildDropStatusEmbed(drop, 295).data;
  const field = (part) => embed.fields.find((f) => f.name.includes(part));

  check('hints are counted, not pluralised badly',
    field('Hints').value.includes('**1** of 4')
    && !field('Hints').value.includes('(s)'), field('Hints').value);
  check('and the next one is a timestamp the reader can act on',
    /<t:\d+:R>/.test(field('Hints').value), field('Hints').value);
  check('the end is a timestamp too', /<t:\d+:R>/.test(field('Ends').value),
    field('Ends').value);
  check('the location is in the description, where it is read first',
    embed.description.includes('Lat 193') && embed.description.includes('Long 499'),
    embed.description);

  // Once the hints run out there is no next one to promise.
  const spent = buildDropStatusEmbed(base({ hintsGiven: HINT_PRECISION.length }), 50).data;
  const hints = spent.fields.find((f) => f.name.includes('Hints')).value;
  check('a spent hint list does not promise another',
    hints.includes('as sharp as they get') && !/<t:\d+:R>/.test(hints), hints);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
