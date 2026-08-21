// Lining the map picture up with the world by standing on landmarks.
//
// The arithmetic worth pinning down is the axis handling: a coastal tip pins
// one axis and says nothing about the other, and the picture measures down from
// the top while the world measures north from the bottom. A sign slip in either
// place flips the map without failing anything else.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const c = await import(pathToFileURL(path.join(root, 'dist/calibrate.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// A world to check against: the picture covers -400k..400k in both directions.
const TRUTH = { minX: -400_000, maxX: 400_000, minY: -400_000, maxY: 400_000 };

/** Where somebody standing on `mark` would be, if TRUTH were the real world. */
const standOn = (mark) => ({
  id: mark.id,
  x: mark.fx === undefined ? 0 : TRUTH.minX + (mark.fx * (TRUTH.maxX - TRUTH.minX)),
  y: mark.fy === undefined ? 0 : TRUTH.minY + ((1 - mark.fy) * (TRUTH.maxY - TRUTH.minY)),
});

const hm = await import(pathToFileURL(path.join(root, 'dist/heatmap.js')).href);
// Whatever width the fallback assumes is what a single reading must carry over.
const SPAN = hm.DEFAULT_BOUNDS.maxX - hm.DEFAULT_BOUNDS.minX;

const dome = c.landmarkById('dome');
const north = c.landmarkById('north');
const south = c.landmarkById('south');
const west = c.landmarkById('west');
const east = c.landmarkById('east');

const near = (bounds, truth = TRUTH, slack = 1) =>
  ['minX', 'maxX', 'minY', 'maxY'].every((k) => Math.abs(bounds[k] - truth[k]) < slack);

// ---- the landmarks themselves ---------------------------------------------

check('every landmark pins at least one axis',
  c.LANDMARKS.every((m) => m.fx !== undefined || m.fy !== undefined));

check('every landmark sits inside the picture',
  c.LANDMARKS.every((m) => [m.fx, m.fy]
    .every((f) => f === undefined || (f > 0 && f < 1))));

check('the dome pins both axes, being a place rather than an edge',
  dome.fx !== undefined && dome.fy !== undefined);

check('there are two structures to stand on, not just one',
  c.LANDMARKS.filter((m) => m.fx !== undefined && m.fy !== undefined).length >= 2);

{
  // A pair of structures has to be far enough apart to measure a width with.
  // Two marks close together give a long lever on a short baseline, so a step
  // in the wrong place throws the scale badly.
  const pts = c.LANDMARKS.filter((m) => m.fx !== undefined && m.fy !== undefined);
  const apart = Math.max(...pts.flatMap((a) => pts.map((b) =>
    Math.hypot(a.fx - b.fx, a.fy - b.fy))));
  check('and far enough apart to measure a scale from', apart > 0.3, apart.toFixed(3));
}

check('a coastal tip pins one axis only',
  north.fx === undefined && north.fy !== undefined
  && west.fy === undefined && west.fx !== undefined);

check('the tips are the right way round in the picture',
  north.fy < south.fy && west.fx < east.fx,
  `north ${north.fy} south ${south.fy}, west ${west.fx} east ${east.fx}`);

// ---- solving ---------------------------------------------------------------

{
  // One reading cannot give the width of the world, but it must still move the
  // map — a calibration that visibly changes nothing reads as broken.
  const { bounds, exact, missing } = c.solve([standOn(dome)]);
  check('one reading produces usable bounds', bounds !== null);
  check('but is honest that nothing was measured', exact === false);
  check('and both axes are still working from an assumed width',
    missing.length === 2);

  // The whole point: the place that was stood on lands where it belongs.
  const here = standOn(dome);
  const fx = (here.x - bounds.minX) / (bounds.maxX - bounds.minX);
  const fy = 1 - ((here.y - bounds.minY) / (bounds.maxY - bounds.minY));
  check('the pinned landmark draws exactly where it sits in the picture',
    Math.abs(fx - dome.fx) < 1e-6 && Math.abs(fy - dome.fy) < 1e-6,
    `fx ${fx.toFixed(4)} vs ${dome.fx}, fy ${fy.toFixed(4)} vs ${dome.fy}`);

  check('and the assumed width is carried over unchanged',
    Math.abs((bounds.maxX - bounds.minX) - SPAN) < 1
    && Math.abs((bounds.maxY - bounds.minY) - SPAN) < 1,
    `${(bounds.maxX - bounds.minX).toFixed(0)} vs ${SPAN}`);
}

{
  const { bounds, exact, missing } = c.solve([standOn(north), standOn(south)]);
  check('two tips on the same axis settle that axis', bounds !== null);
  check('but the map is not exact until the other axis is measured too',
    exact === false);
  check('and the other axis is named as the one still assumed',
    missing.length === 1 && missing[0] === 'east to west', JSON.stringify(missing));

  // Latitude was measured from two real points, so it must be right even
  // though longitude is still a guess.
  check('the measured axis is recovered exactly',
    Math.abs(bounds.minY - TRUTH.minY) < 1 && Math.abs(bounds.maxY - TRUTH.maxY) < 1,
    JSON.stringify(bounds));
}

{
  const { bounds, exact } = c.solve([standOn(dome), standOn(north), standOn(west)]);
  check('the dome and two tips recover the world exactly',
    bounds !== null && near(bounds), JSON.stringify(bounds));
  check('and that is reported as measured, not assumed', exact === true);
}

{
  const { bounds } = c.solve([standOn(north), standOn(south), standOn(east), standOn(west)]);
  check('four tips recover it too, with no landmark pinning both axes',
    bounds !== null && near(bounds), JSON.stringify(bounds));
}

{
  const { bounds } = c.solve([standOn(dome), standOn(north), standOn(west)]);
  check('north ends up above south', bounds.maxY > bounds.minY);
  check('west ends up left of east', bounds.maxX > bounds.minX);
}

{
  // Standing at the northern tip is further north than the southern tip. If
  // the top-to-bottom flip were dropped this would still solve, but inverted.
  const flipped = { minX: -400_000, maxX: 400_000, minY: 400_000, maxY: -400_000 };
  const { bounds } = c.solve([standOn(dome), standOn(north), standOn(west)]);
  check('and the picture is not solved upside down', !near(bounds, flipped, 1000));
}

// ---- the awkward cases -----------------------------------------------------

{
  const { exact, missing } = c.solve([standOn(north), standOn(north)]);
  check('two visits to one tip is one constraint, not two', exact === false);
  check('so that axis is still reported as assumed',
    missing.includes('north to south'));
}

{
  const { bounds } = c.solve([
    { id: 'nowhere', x: 1, y: 2 },
    standOn(dome), standOn(north), standOn(west),
  ]);
  check('an unknown landmark is ignored rather than throwing', bounds !== null);
}

check('no readings at all is not an error', c.solve([]).bounds === null);

{
  // Nobody stands exactly on the mark. A few thousand units out should shift
  // the answer a little, not throw the map away.
  const sloppy = standOn(dome);
  sloppy.x += 3_000;
  sloppy.y -= 3_000;

  const { bounds } = c.solve([sloppy, standOn(north), standOn(west)]);
  check('being slightly off the mark skews rather than breaks',
    bounds !== null && near(bounds, TRUTH, 60_000), JSON.stringify(bounds));
}

// ---- what to do next -------------------------------------------------------

{
  const needed = c.stillNeeded([standOn(dome)]);
  check('something is suggested while an axis is open', needed.length > 0);
  check('and it never suggests one already recorded',
    !needed.some((m) => m.id === 'dome'));
}

check('nothing is suggested once the map is lined up',
  c.stillNeeded([standOn(dome), standOn(north), standOn(west)]).length === 0);

{
  const needed = c.stillNeeded([standOn(north), standOn(south)]);
  check('with latitude settled it only suggests east-to-west landmarks',
    needed.length > 0 && needed.every((m) => m.fx !== undefined),
    needed.map((m) => m.id).join(','));
}

// ---- storing readings ------------------------------------------------------

{
  // A stand-in for the settings table.
  const store = new Map();
  const ctx = {
    db: {
      getSetting: (k) => store.get(k) ?? '',
      setSetting: (k, v) => store.set(k, v),
    },
  };

  const lake = { id: 'dome', x: -40_643.9, y: 113_184.4 };
  c.applyReading(ctx, lake);
  check('a reading is remembered', c.storedReadings(ctx).length === 1);

  const again = c.applyReading(ctx, { id: 'dome', x: -44_465, y: -143_644 });
  check('calibrating the same landmark replaces rather than stacks',
    again.readings.length === 1, JSON.stringify(again.readings));
  check('and it is the newer reading that survives',
    c.storedReadings(ctx)[0].y === -143_644);

  check('a solved map is marked manual, so the panel stops widening it',
    store.get('heatmap_manual') === '1');

  // The bug this guards: forgetting the bounds but keeping the readings meant
  // the next calibration silently rebuilt exactly the same wrong map.
  c.clearReadings(ctx);
  check('clearing readings really empties them', c.storedReadings(ctx).length === 0);

  check('a reading with no landmark is dropped rather than stored as junk',
    c.storedReadings({
      db: { getSetting: () => '[{"id":"dome"}]', setSetting: () => {} },
    }).length === 0);

  check('unreadable stored readings are not fatal',
    c.storedReadings({
      db: { getSetting: () => 'not json', setSetting: () => {} },
    }).length === 0);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
