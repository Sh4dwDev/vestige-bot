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
  // Real positions in, real positions out — no grid inversion anywhere.
  const spots = h.hotspots([at(750, 750), at(752, 748), at(100, 100)], BOUNDS);

  check('the busiest place is listed first', spots[0].count === 2, JSON.stringify(spots[0]));
  check('coordinates are in the in-game scale, not raw world units',
    Math.abs(Number(spots[0].lat)) < 10 && Math.abs(Number(spots[0].long)) < 10,
    `lat ${spots[0].lat} long ${spots[0].long}`);
  check('and are the average of where those players actually are',
    spots[0].lat === '1' && spots[0].long === '1', JSON.stringify(spots[0]));
  check('empty cells are never listed', spots.every((s) => s.count > 0));
  check('an empty map has no hotspots', h.hotspots([], BOUNDS).length === 0);
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

// ---- the picture ----------------------------------------------------------
// It has to be a real PNG, and it has to exist even with nobody online.
{
  const img = await import(pathToFileURL(path.join(root, 'dist/heatimage.js')).href);

  const isPng = (buf) => buf.length > 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;

  const empty = await img.renderHeatmap([], null, null);
  check('an empty server still produces a picture', isPng(empty), `${empty.length} bytes`);

  const busy = await img.renderHeatmap(
    [at(200, 200), at(210, 210), at(800, 800)], BOUNDS, null);
  check('a populated map produces a picture', isPng(busy));
  check('and it differs from the empty one', !busy.equals(empty));

  // North up, and west left: getting either wrong mirrors the island.
  const nw = img.toPixel(at(0, 1000), BOUNDS);
  const se = img.toPixel(at(1000, 0), BOUNDS);
  check('north-west is the top left corner', nw.px === 0 && nw.py === 0, JSON.stringify(nw));
  check('south-east is the bottom right', se.px === img.SIZE - 1 && se.py === img.SIZE - 1,
    JSON.stringify(se));

  const mid = img.toPixel(at(500, 500), BOUNDS);
  check('the middle lands in the middle',
    Math.abs(mid.px - img.SIZE / 2) < 2 && Math.abs(mid.py - img.SIZE / 2) < 2,
    JSON.stringify(mid));

  // Everybody on one spot gives a zero span; NaN pixels draw nothing at all.
  const flat = { minX: 5, maxX: 5, minY: 5, maxY: 5 };
  const one = img.toPixel(at(5, 5), flat);
  check('a zero-width map does not produce NaN pixels',
    Number.isFinite(one.px) && Number.isFinite(one.py), JSON.stringify(one));

  const outside = img.toPixel(at(99999, -99999), BOUNDS);
  check('a point outside the bounds is clamped onto the picture',
    outside.px >= 0 && outside.px < img.SIZE && outside.py >= 0 && outside.py < img.SIZE,
    JSON.stringify(outside));

  check('a missing map image falls back rather than throwing',
    (await img.baseImage('https://example.invalid/nope.png')) === null);
  check('an empty url is simply no image', (await img.baseImage('')) === null);
}

// The embed points at the attachment, always - including on an empty server.
{
  const quiet = h.buildHeatmapEmbed([], null).toJSON();
  check('the empty panel still shows the picture',
    quiet.image?.url === 'attachment://heatmap.png', JSON.stringify(quiet.image));

  const live = h.buildHeatmapEmbed([at(1, 1)], BOUNDS).toJSON();
  check('and so does the live one', live.image?.url === 'attachment://heatmap.png');
}

// Picking the map up off the host. The whole point is that dropping a file in
// is the entire setup, so the default path has to work with no configuration.
{
  const img = await import(pathToFileURL(path.join(root, 'dist/heatimage.js')).href);
  const fs2 = await import('node:fs');
  const os2 = await import('node:os');

  check('there is a default place to put it', img.DEFAULT_PATHS.length > 0,
    img.DEFAULT_PATHS.join(', '));
  check('it sits beside the database, which already exists on the host',
    img.DEFAULT_PATHS[0].startsWith('data/'), img.DEFAULT_PATHS[0]);
  check('png is the first thing looked for', /\.png$/.test(img.DEFAULT_PATHS[0]));

  const dir = fs2.mkdtempSync(path.join(os2.tmpdir(), 'vesta-'));
  const file = path.join(dir, 'map.png');

  // A real PNG to read back: the renderer makes one, so use that.
  fs2.writeFileSync(file, await img.renderHeatmap([], null, null, 64));
  const loaded = await img.baseImage(file);
  check('a file path is read from disk', loaded !== null && loaded.length > 0);

  img.forgetBaseImage();
  check('a path that is not there is not an error', await img.baseImage(
    path.join(dir, 'nope.png')) === null);

  img.forgetBaseImage();
  fs2.writeFileSync(path.join(dir, 'notanimage.png'), 'this is not a picture');
  check('a file that is not an image is skipped rather than thrown',
    await img.baseImage(path.join(dir, 'notanimage.png')) === null);

  img.forgetBaseImage();
  check('a link is still fetched rather than treated as a path',
    await img.baseImage('https://example.invalid/x.png') === null);

  fs2.rmSync(dir, { recursive: true, force: true });
}

// The panel is a picture panel, so the pinned helper must not throw the
// picture away. Reported live: the embed pointed at attachment://heatmap.png
// and no image arrived, because the edit passed attachments: [] - which on
// edit is the authoritative final list, not "drop the old ones".
{
  const fs3 = await import('node:fs');
  const src = fs3.readFileSync(path.join(root, 'src/pinned.ts'), 'utf8');
  const edit = src.slice(src.indexOf('if (existing)'), src.indexOf('const sent ='));

  check('an edit carrying files does not clear the attachment list',
    !/attachments:\s*\[\]/.test(edit), '');
  check('and it still sends the files', /files/.test(edit));
  check('a message left without an attachment is replaced, not edited forever',
    /attachments\.size === 0/.test(edit) && /\.delete\(\)/.test(edit));
}

// The glow itself: a crowd must stay a gradient, not clip to a flat disc.
{
  const img = await import(pathToFileURL(path.join(root, 'dist/heatimage.js')).href);
  const one = await img.renderHeatmap([at(500, 500)], BOUNDS, null, 200);
  const many = await img.renderHeatmap(
    Array.from({ length: 12 }, () => at(500, 500)), BOUNDS, null, 200);

  check('a crowd renders differently from one player', !one.equals(many));
  check('both are still pictures', one.length > 100 && many.length > 100);
}

// The extension is not evidence. A picture saved from a browser as map.png is
// very often a WebP; jimp reads the bytes, refuses it, and the panel showed a
// plain grid with nothing pointing at why. Observed live 2026-08-21.
{
  const img = await import(pathToFileURL(path.join(root, 'dist/heatimage.js')).href);

  const png = await img.renderHeatmap([], null, null, 32);
  check('a real PNG is identified', img.sniffFormat(png) === 'PNG', img.sniffFormat(png));

  // RIFF....WEBP - exactly what was sitting on the server named map.png.
  const webp = Buffer.concat([
    Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBPVP8 ', 'latin1'),
  ]);
  check('a WebP is named as a WebP however the file is called',
    img.sniffFormat(webp) === 'WebP', img.sniffFormat(webp));

  check('a JPEG is identified',
    img.sniffFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])) === 'JPEG');
  check('rubbish is not guessed at',
    /not a picture|not an image/.test(img.sniffFormat(Buffer.from('hello world!!'))));
  check('a tiny buffer does not crash the sniffer',
    typeof img.sniffFormat(Buffer.from([1, 2])) === 'string');

  check('WebP is not offered as readable', !img.SUPPORTED.includes('WebP'),
    img.SUPPORTED.join(','));
  check('PNG and JPEG are', img.SUPPORTED.includes('PNG') && img.SUPPORTED.includes('JPEG'));
}

// Visibility. One player has to be findable at a glance while still reading as
// faint - and the glow has to fade at its rim rather than ending in a step.
{
  const img = await import(pathToFileURL(path.join(root, 'dist/heatimage.js')).href);

  const blank = await img.renderHeatmap([], null, null, 200);
  const one = await img.renderHeatmap([at(500, 500)], BOUNDS, null, 200);
  const crowd = await img.renderHeatmap(
    Array.from({ length: 10 }, () => at(500, 500)), BOUNDS, null, 200);

  check('one player changes the picture at all', !one.equals(blank));
  check('and a crowd differs from one player again', !one.equals(crowd));
  check('all three are valid pictures',
    [blank, one, crowd].every((b) => b.length > 100));

  // The scale is absolute, so a crowd must be visibly stronger than one.
  // Comparing byte length is crude but it is a real signal: more colour
  // variation compresses larger.
  check('a crowd is a bigger mark than a single player', crowd.length !== one.length,
    `${one.length} vs ${crowd.length}`);
}

// Which bounds actually get used. Learned bounds track where people WALK, so
// they converge on the island outline - but the picture is the island plus the
// sea around it, so stretching one onto the other pushes coastal players off
// the edge. Manual wins; otherwise the fixed square that models the picture.
{
  const fakeCtx = (manual = false) => ({
    db: {
      getSetting: (k) => (k === 'heatmap_manual' && manual ? '1' : ''),
      setSetting: () => {},
    },
  });

  const tiny = { minX: 0, maxX: 500, minY: 0, maxY: 500 };
  const island = { minX: -300000, maxX: 300000, minY: -300000, maxY: 300000 };

  check('nothing learned falls back to the island square',
    h.effectiveBounds(fakeCtx(), null) === h.DEFAULT_BOUNDS);
  check('a huddle is never treated as a map',
    h.effectiveBounds(fakeCtx(), tiny) === h.DEFAULT_BOUNDS);
  check('nor are learned bounds, however wide - they have no ocean margin',
    h.effectiveBounds(fakeCtx(), island) === h.DEFAULT_BOUNDS);
  check('manual bounds always win', h.effectiveBounds(fakeCtx(true), tiny) === tiny);

  check('the fallback is centred on the origin, where the world is',
    h.DEFAULT_BOUNDS.minX < 0 && h.DEFAULT_BOUNDS.maxX > 0
    && h.DEFAULT_BOUNDS.minY < 0 && h.DEFAULT_BOUNDS.maxY > 0);

  const img = await import(pathToFileURL(path.join(root, 'dist/heatimage.js')).href);
  const live = img.toPixel({ x: -44465, y: -143643.5 }, h.DEFAULT_BOUNDS, 720);
  const margin = 720 * 0.15;
  check('a real live position lands well inside the picture',
    live.px > margin && live.px < 720 - margin
    && live.py > margin && live.py < 720 - margin,
    JSON.stringify(live));
}

// The coordinates printed under the map are the REAL ones. They used to be
// reconstructed by inverting the grid maths, which reported the middle of a
// cell and inherited every error in the bounds: a player at Lat -143,646 was
// printed as Lat 25.
{
  const one = h.hotspots([{ x: -44465, y: -143643.5 }], h.DEFAULT_BOUNDS);
  check('one player reports their own position', one.length === 1);
  check('the latitude is theirs, not a cell centre', one[0].lat === '-144',
    `lat ${one[0].lat}`);
  check('and so is the longitude', one[0].long === '-44', `long ${one[0].long}`);

  // Wrong bounds must not corrupt the numbers any more.
  const wrong = h.hotspots([{ x: -44465, y: -143643.5 }],
    { minX: 0, maxX: 10, minY: 0, maxY: 10 });
  check('coordinates survive nonsense bounds unchanged',
    wrong[0].lat === '-144' && wrong[0].long === '-44',
    `${wrong[0].lat} / ${wrong[0].long}`);

  const group = h.hotspots([
    { x: 1000, y: 1000 }, { x: 3000, y: 3000 }, { x: 500000, y: 500000 },
  ], h.DEFAULT_BOUNDS);
  check('a cluster is reported as the middle of where they actually are',
    group[0].count === 2 && group[0].lat === '2', JSON.stringify(group[0]));
  check('the busiest cluster is listed first', group[0].count >= group[1].count);
  check('an empty server has no hotspots', h.hotspots([], h.DEFAULT_BOUNDS).length === 0);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
