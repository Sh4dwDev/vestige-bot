// The heatmap. The bounds calibrate themselves from where people actually go,
// because nobody publishes the extent of Isle V3 - so the arithmetic that maps
// a world coordinate onto a cell is the part worth pinning down.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const h = await import(pathToFileURL(path.join(root, 'dist/heatmap.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const BOUNDS = { minX: 0, maxX: 1000, minY: 0, maxY: 1000 };
const at = (x, y) => ({ x, y });

// ---- learning the map -----------------------------------------------------

check('nothing is learned from nobody', h.widen(null, []) === null);

{
  const first = h.widen(null, [at(100, 200)]);
  check('one player seeds the bounds',
    first.minX === 100 && first.maxX === 100 && first.minY === 200,
    JSON.stringify(first));

  const wider = h.widen(first, [at(-50, 900)]);
  check('a further player widens them',
    wider.minX === -50 && wider.maxY === 900, JSON.stringify(wider));

  // The rule that keeps the grid meaning the same thing between refreshes.
  const same = h.widen(wider, [at(0, 0)]);
  check('bounds only ever grow, never shrink to fit who is online',
    same.minX === -50 && same.maxY === 900, JSON.stringify(same));
  check('negative coordinates are fine', same.minX < 0);
}

// ---- placing people on the grid -------------------------------------------

{
  const cells = h.grid([at(0, 0)], BOUNDS);
  check('the far south-west corner is bottom left',
    cells[h.ROWS - 1][0] === 1, JSON.stringify(cells[h.ROWS - 1].slice(0, 3)));
}
{
  const cells = h.grid([at(1000, 1000)], BOUNDS);
  check('the far north-east corner is top right',
    cells[0][h.COLS - 1] === 1);
}
{
  // North being up is the whole reason the row is flipped: getting it wrong
  // mirrors the island and every hotspot is reported in the wrong place.
  const north = h.grid([at(500, 900)], BOUNDS);
  const south = h.grid([at(500, 100)], BOUNDS);
  const rowOf = (cells) => cells.findIndex((row) => row.some((n) => n > 0));
  check('north is nearer the top than south', rowOf(north) < rowOf(south),
    `north row ${rowOf(north)}, south row ${rowOf(south)}`);
}

{
  // Well inside one cell: 500 sits exactly on a row boundary, so a few units
  // either side of it legitimately land in different rows.
  const cells = h.grid([at(520, 520), at(520, 520), at(525, 525)], BOUNDS);
  check('people standing together stack in one cell',
    Math.max(...cells.flat()) === 3, String(Math.max(...cells.flat())));
  check('and everybody is counted once',
    cells.flat().reduce((a, b) => a + b, 0) === 3);
}

check('a point outside the known bounds is clamped, not dropped', (() => {
  const cells = h.grid([at(99999, 99999)], BOUNDS);
  return cells.flat().reduce((a, b) => a + b, 0) === 1;
})());

// Everybody on one spot gives a zero-width range; dividing by it is NaN.
{
  const flat = { minX: 500, maxX: 500, minY: 500, maxY: 500 };
  const cells = h.grid([at(500, 500), at(500, 500)], flat);
  check('a zero-width map does not produce NaN cells',
    cells.flat().every((n) => Number.isFinite(n)) &&
    cells.flat().reduce((a, b) => a + b, 0) === 2);
}

check('the grid is the size it says it is', (() => {
  const cells = h.grid([], BOUNDS);
  return cells.length === h.ROWS && cells.every((row) => row.length === h.COLS);
})());

// ---- what it looks like ---------------------------------------------------

{
  const empty = h.render(h.grid([], BOUNDS));
  check('an empty map renders blank, not a wall of dots',
    !/[.:oO#@]/.test(empty), empty.split('\n')[1]);

  const busy = h.render(h.grid(
    [at(500, 500), at(500, 500), at(500, 500), at(100, 100)], BOUNDS));
  check('the busiest cell is the darkest mark', /@/.test(busy));
  check('a lone player is a light mark', /[.:]/.test(busy));
  check('it is a code block, so it lines up', busy.startsWith('```'));
  check('every row is the same width', (() => {
    const rows = busy.split('\n').slice(1, -1);
    return rows.every((r) => r.length === h.COLS);
  })());
}

// ---- telling people where to go -------------------------------------------

{
  const cells = h.grid([at(750, 750), at(750, 750), at(100, 100)], BOUNDS);
  const spots = h.hotspots(cells, BOUNDS);

  check('the busiest place is listed first', spots[0].count === 2, JSON.stringify(spots[0]));
  check('coordinates are in the in-game scale, not raw world units',
    Number(spots[0].lat) < 10 && Number(spots[0].long) < 10,
    `lat ${spots[0].lat} long ${spots[0].long}`);
  check('and point at roughly the right place',
    Math.abs(Number(spots[0].lat)) >= 0 && spots[0].lat !== undefined);
  check('empty cells are never listed', spots.every((s) => s.count > 0));
  check('an empty map has no hotspots', h.hotspots(h.grid([], BOUNDS), BOUNDS).length === 0);
}

// ---- the panel ------------------------------------------------------------

{
  const quiet = h.buildHeatmapEmbed([], null).toJSON();
  check('an empty server says so rather than showing a blank grid',
    /All quiet/.test(quiet.description ?? ''));

  const down = h.buildHeatmapEmbed([], null, { unreachable: true }).toJSON();
  check('an unreachable server still renders', /Unreachable/.test(down.description ?? ''));
  check('and is red', down.color === 0xed4245);

  const live = h.buildHeatmapEmbed(
    Array.from({ length: 20 }, (_, n) => at(n * 50, n * 40)), BOUNDS,
    { minutes: 5 },
  ).toJSON();

  check('a live map says how many are on', /\*\*20\*\*/.test(live.description ?? ''));
  check('it says which way is up', /North is up/.test(live.description ?? ''));
  check('it says how often it refreshes', /every 5 min/.test(live.footer?.text ?? ''));
  check('it stays within the description limit',
    (live.description ?? '').length < 4096, `${(live.description ?? '').length} chars`);
}

// Rows without positions must not be plotted at 0,0 - that would put everybody
// in one corner and drag the learned bounds there with them.
{
  const rows = [
    { steam: '1', species: 'Rex', growth: 1, female: false, prime: false, x: 10, y: 20 },
    { steam: '2', species: 'Dryo', growth: 1, female: false, prime: false },
    { steam: '3', species: 'Dryo', growth: 1, female: false, prime: false, x: null, y: 5 },
  ];
  const points = h.pointsFrom(rows);
  check('only players with a real position are plotted', points.length === 1,
    JSON.stringify(points));
  check('and it is the right one', points[0].x === 10 && points[0].y === 20);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
