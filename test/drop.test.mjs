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
  buildDropStatusEmbed, nearestLine, bearingWord, distanceWord, scentLine,
  rememberGround, knownGround, forgetGround, markDrop, MARKER_CLASS,
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

const at = (steam, x, y, z) => ({ steam, species: 'Rex', growth: 1, female: false, prime: false, x, y, ...(z === undefined ? {} : { z }) });

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

// ---- ground, and marking the spot -------------------------------------------

{
  forgetGround();

  // Only positions with a height are worth banking: the height is the entire
  // reason to bank them. There is no way to ask the engine what the terrain is
  // at an arbitrary point.
  rememberGround([at(A, 0, 0), at(B, 100_000, 0, 60)]);
  check('a position without a height is not banked', knownGround().length === 1,
    JSON.stringify(knownGround()));
  check('and the one with a height is', knownGround()[0].z === 60);

  // Samples close together are the same place; banking every poll would fill
  // the buffer with one clearing.
  rememberGround([at(B, 110_000, 0, 61)]);
  check('a spot next to one already banked is not banked twice',
    knownGround().length === 1, String(knownGround().length));

  rememberGround([at(B, 900_000, 0, 70)]);
  check('somewhere genuinely different is', knownGround().length === 2);

  forgetGround();
}

{
  forgetGround();

  // Cold start: nothing banked, so it falls back to the old placement and has
  // no height. The drop still works, there is just nothing to spawn on it.
  const cold = placeDrop([at(A, 0, 0, 50), at(B, 400_000, 0, 60)], () => 0.5);
  check('with nothing banked it still places a drop', cold !== null);
  check('but without a height, so nothing is spawned', cold.z === undefined,
    JSON.stringify(cold));

  rememberGround([at(A, 0, 0, 50), at(B, 900_000, 400_000, 120)]);

  // Warm: it prefers real ground, and not underneath whoever is playing.
  const warm = placeDrop([at(A, 0, 0, 50), at(B, 20_000, 0, 51)], () => 0.5);
  check('once ground is banked it lands on some', warm.z === 120, JSON.stringify(warm));
  check('and far from everybody currently online',
    Math.hypot(warm.x, warm.y) > 150_000, JSON.stringify(warm));

  forgetGround();
}

{
  // The marker only goes down where the height is known. A mound at a guessed
  // height is inside a hillside or hanging in the air, and a marker in the
  // wrong place is worse than none because people trust it.
  const calls = [];
  const ctx = { mod: { run: async (verb, steam, args) => { calls.push({ verb, args }); return { ok: true }; } } };

  check('a drop with no height is not marked',
    (await markDrop(ctx, base())) === false && calls.length === 0);

  const marked = await markDrop(ctx, base({ x: 5_000, y: 6_000, z: 70 }));
  check('one with a height is', marked === true);
  check('and it is spawned exactly there',
    calls[0].args.x === 5_000 && calls[0].args.y === 6_000 && calls[0].args.z === 70,
    JSON.stringify(calls[0].args));
  check('using the class the mod is proven able to spawn',
    calls[0].args.class === MARKER_CLASS, calls[0].args.class);

  // A refused spawn must not take the event down with it.
  const refusing = { mod: { run: async () => ({ ok: false, msg: 'no' }) } };
  check('a refused spawn is reported, not thrown',
    (await markDrop(refusing, base({ z: 70 }))) === false);

  const throwing = { mod: { run: async () => { throw new Error('unreachable'); } } };
  check('and an unreachable server is survivable',
    (await markDrop(throwing, base({ z: 70 }))) === false);
}

// ---- bearings, which is what players actually get ---------------------------

{
  // North is a SMALLER Lat: the world's Y grows southward. That sign was wrong
  // for a long time in the map code and survived every other fix because it is
  // invisible while nobody moves. Here it would send the whole server the wrong
  // way, confidently.
  check('north is a smaller Lat', bearingWord(0, -100) === 'north', bearingWord(0, -100));
  check('south is a larger Lat', bearingWord(0, 100) === 'south', bearingWord(0, 100));
  check('east is a larger Long', bearingWord(100, 0) === 'east', bearingWord(100, 0));
  check('west is a smaller Long', bearingWord(-100, 0) === 'west', bearingWord(-100, 0));
  check('and the diagonals agree',
    bearingWord(100, -100) === 'north-east' && bearingWord(-100, 100) === 'south-west',
    `${bearingWord(100, -100)} / ${bearingWord(-100, 100)}`);
  check('standing exactly on it is not a direction',
    bearingWord(0, 0) === 'right here', bearingWord(0, 0));

  // Every angle must produce one of the eight words, never undefined.
  const words = new Set();
  for (let deg = 0; deg < 360; deg += 1) {
    const rad = (deg * Math.PI) / 180;
    words.add(bearingWord(Math.sin(rad) * 100, -Math.cos(rad) * 100));
  }
  check('every angle names a point of the compass', words.size === 8 && !words.has(undefined),
    [...words].join(', '));
}

{
  // The first hint is a bearing and nothing else, so people commit to a
  // direction and still have to search.
  check('the first hint gives no distance', distanceWord(500, 0) === '');
  check('later ones do', distanceWord(500, 1).length > 0, distanceWord(500, 1));
  check('and it sharpens as it closes',
    distanceWord(500, 3) !== distanceWord(50, 3), `${distanceWord(500, 3)} / ${distanceWord(50, 3)}`);

  const drop = base({ x: 200_000, y: -100_000 });
  const player = { steam: A, species: 'Rex', growth: 1, female: false, prime: false,
    x: -300_000, y: 400_000 };

  check('a player is told which way to go, not a coordinate',
    scentLine(drop, player, 1).includes('north-east')
    && !/Lat|Long|\d{2,}/.test(scentLine(drop, player, 1)),
    scentLine(drop, player, 1));

  check('somebody on top of it is told to look around',
    scentLine(drop, { ...player, x: 202_000, y: -101_000 }, 1).includes('right here'),
    scentLine(drop, { ...player, x: 202_000, y: -101_000 }, 1));

  check('and a player the server cannot locate gets nothing rather than a guess',
    scentLine(drop, { steam: A }, 1) === null);

  check('the line is plain ASCII, since the banner drops anything else',
    /^[ -~]*$/.test(scentLine(drop, player, 2)), scentLine(drop, player, 2));
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
