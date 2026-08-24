// Skin colour handling. The sRGB to linear conversion is the whole game here:
// the engine stores FLinearColor, every colour picker gives sRGB, and writing
// one as the other produces washed-out dinosaurs that look like a bug.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const {
  PARTS, PRESETS, parseHex, toLinear, hexToLinear, hexToInt,
  toSrgb, linearToHex, encodeColours, BUILT_IN, patternLetter, PATTERN_CHOICES,
  completeLook,
} = await import(pathToFileURL(path.join(root, 'dist/skins.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const near = (a, b, tol = 1e-4) => Math.abs(a - b) < tol;

// ---- parsing -------------------------------------------------------------------

check('reads a full hex code', parseHex('#FFFFFF').r === 1);
check('works without the hash', parseHex('000000').r === 0);
check('expands shorthand', near(parseHex('#F00').r, 1) && parseHex('#F00').g === 0);
check('is case insensitive', near(parseHex('#8c3b1e').r, parseHex('#8C3B1E').r));
check('ignores surrounding space', parseHex('  #FFFFFF  ') !== null);

check('rejects nonsense', parseHex('not a colour') === null);
check('rejects a wrong length', parseHex('#FFFF') === null);
check('rejects non-hex characters', parseHex('#GGGGGG') === null);

// ---- the conversion ------------------------------------------------------------

check('black stays black', toLinear(0) === 0);
check('white stays white', near(toLinear(1), 1));

// The classic mistake: mid grey is 0.5 in sRGB but ~0.214 linear. Writing 0.5
// straight through lands roughly twice as bright as the picker showed.
check('mid grey converts, rather than passing through',
  near(toLinear(0.5), 0.2140, 1e-3), String(toLinear(0.5)));
check('conversion always darkens the midtones', toLinear(0.5) < 0.5);
check('the toe of the curve is linear', near(toLinear(0.04), 0.04 / 12.92));
check('it is monotonic', toLinear(0.2) < toLinear(0.6) && toLinear(0.6) < toLinear(0.9));

{
  const linear = hexToLinear('#8C3B1E');
  check('hex converts to linear', linear !== null && linear.r < 140 / 255,
    JSON.stringify(linear));
  check('every channel lands in range',
    Object.values(hexToLinear('#FFFFFF')).every((v) => v >= 0 && v <= 1));
  check('a bad hex converts to nothing', hexToLinear('nope') === null);
}

check('embed colour is a plain integer', hexToInt('#FF0000') === 0xff0000);
check('a bad hex has no embed colour', hexToInt('zzz') === null);

// ---- the field list ------------------------------------------------------------

check('all ten colour fields are present', PARTS.length === 10, String(PARTS.length));
check('field names match the engine', PARTS.some((p) => p.field === 'BodyColor') &&
  PARTS.some((p) => p.field === 'ClawsColor'));
check('every part has a readable label', PARTS.every((p) => p.label && !p.label.includes('Color')));

// PatternIndex has its own command and is never written alongside colours,
// because out of range it drops the entire apply. SkinCode is the engine's own
// persistence and is never written at all.
check('the colour picker offers no pattern or skin code fields',
  !PARTS.some((p) => /Pattern|SkinCode/i.test(p.field)));

// ---- patterns -------------------------------------------------------------------

check('patterns are lettered like the game', patternLetter(0) === 'A' && patternLetter(2) === 'C');
check('the letters keep going', patternLetter(25) === 'Z');
check('past the alphabet falls back to a number rather than nonsense',
  patternLetter(26) === '#26', patternLetter(26));
check('a negative index is not lettered', patternLetter(-1) === '#-1');

check('the pattern menu fits Discord’s 25 choice cap', PATTERN_CHOICES <= 25,
  String(PATTERN_CHOICES));
check('enough patterns are offered to be useful', PATTERN_CHOICES >= 4);

// A pattern must never ride along with colours — that is the whole reason it
// has its own verb.
check('encoding colours never emits a pattern field',
  !encodeColours({ BodyColor: '#FFFFFF' }).includes('Pattern'));

// ---- round trip, for saving a live look as a preset ----------------------------

check('linear back to sRGB is the inverse', near(toSrgb(toLinear(0.5)), 0.5, 1e-6));

for (const hex of ['#000000', '#FFFFFF', '#8C3B1E', '#1F6F6B', '#7FBF2A']) {
  const c = hexToLinear(hex);
  check(`${hex} survives a round trip`, linearToHex(c.r, c.g, c.b) === hex.toUpperCase(),
    linearToHex(c.r, c.g, c.b));
}

// Reading a live skin can hand back values outside 0..1 — the engine allows
// HDR colours above 1.0 for glow.
check('an out-of-range channel clamps rather than producing nonsense hex',
  /^#[0-9A-F]{6}$/.test(linearToHex(4, -1, 0.5)), linearToHex(4, -1, 0.5));

// ---- the multi-colour wire format ----------------------------------------------

{
  const encoded = encodeColours({ BodyColor: '#FFFFFF', EyesColor: '#000000' });
  check('parts are pipe separated', encoded.split('|').length === 2, encoded);
  check('each part is field=r,g,b', /^BodyColor=1\.00000,1\.00000,1\.00000$/.test(
    encoded.split('|')[0]), encoded.split('|')[0]);
  check('values are converted, not raw sRGB',
    encodeColours({ BodyColor: '#808080' }).includes('0.21') , encodeColours({ BodyColor: '#808080' }));
  check('a bad colour is dropped rather than corrupting the whole string',
    encodeColours({ BodyColor: '#FFFFFF', EyesColor: 'nope' }).split('|').length === 1);
  check('nothing to encode is an empty string', encodeColours({}) === '');
}

// ---- the ready-made looks -------------------------------------------------------

{
  const looks = Object.entries(BUILT_IN);
  check('there are ready-made looks to pick from', looks.length >= 8, String(looks.length));

  check('every colour in every look is valid hex',
    looks.every(([, l]) => Object.values(l.colours).every((hex) => parseHex(hex) !== null)),
    looks.map(([n, l]) => `${n}:${Object.values(l.colours).filter((h) => !parseHex(h)).join(',')}`)
      .filter((s) => !s.endsWith(':')).join(' | '));

  const fields = new Set(PARTS.map((p) => p.field));
  check('every look only names real parts',
    looks.every(([, l]) => Object.keys(l.colours).every((f) => fields.has(f))),
    looks.flatMap(([, l]) => Object.keys(l.colours)).filter((f) => !fields.has(f)).join(','));

  check('each look sets a body colour, which is what reads at distance',
    looks.every(([, l]) => Boolean(l.colours.BodyColor)));

  check('each look sets enough parts to look deliberate',
    looks.every(([, l]) => Object.keys(l.colours).length >= 4),
    looks.map(([n, l]) => `${n}:${Object.keys(l.colours).length}`).join(' '));

  // Teeth, mouth and claws are barely visible; recolouring them reads as a
  // mistake rather than a style.
  check('looks leave the fiddly parts alone',
    looks.every(([, l]) => !l.colours.TeethColor && !l.colours.MouthColor && !l.colours.ClawsColor));

  check('every look encodes to the wire format',
    looks.every(([, l]) =>
      encodeColours(l.colours).split('|').length === Object.keys(l.colours).length));

  check('look names are unique', new Set(looks.map(([n]) => n)).size === looks.length);

  // The pattern decides which parts each colour lands on, so a look without one
  // is only half a look.
  check('every look names a pattern',
    looks.every(([, l]) => typeof l.pattern === 'number'),
    looks.filter(([, l]) => typeof l.pattern !== 'number').map(([n]) => n).join(','));

  // Kept low: how many patterns a species has is not discoverable, and the low
  // indices are the ones every species is most likely to have.
  check('patterns stay in the range every species is likely to have',
    looks.every(([, l]) => l.pattern >= 0 && l.pattern <= 3),
    looks.map(([n, l]) => `${n}:${l.pattern}`).join(' '));

  check('the looks are not all on one pattern',
    new Set(looks.map(([, l]) => l.pattern)).size > 1);

  // The pattern must never be encoded with the colours: out of range it makes
  // the client drop the whole apply.
  check('a look’s pattern never reaches the colour wire format',
    looks.every(([, l]) => !encodeColours(l.colours).includes('attern')));

  // Past 25 the picker cannot show them all at once, but it filters as you
  // type and saved presets are listed first, so an admin's own work is never
  // crowded out. This is a sanity bound, not the Discord limit.
  check('the built-in looks stay a browsable number', looks.length <= 40,
    String(looks.length));

  check('no look is an empty object', looks.every(([, c]) => Object.keys(c).length > 0));
}

check('every preset is a valid colour', PRESETS.every((p) => parseHex(p.hex) !== null));
check('presets fit in one autocomplete page', PRESETS.length <= 25, String(PRESETS.length));
check('preset names are unique', new Set(PRESETS.map((p) => p.name)).size === PRESETS.length);

// Patterns are validated per species. The server refuses an index a species
// does not have, and that refusal aborts the whole skin rebuild - so a pattern
// that is silently ignored means the colours did not land either. Reported
// live 2026-08-18: /admin skin apply said "Volcanic applied" and nothing on the
// Allosaurus changed, because pattern D was refused and never checked.
{
  const source = fs.readFileSync(path.join(root, 'src/commands.ts'), 'utf8');
  const apply = source.slice(source.indexOf("if (pattern !== undefined) {"));

  check('the pattern write is not fire and forget',
    !/run\('pattern'[^;]*\)\.catch\(\(\) => undefined\);/.test(apply));
  check('a refused pattern is reported rather than reported as success',
    /if \(!applied\.ok\)/.test(apply.slice(0, 1200)));
  check('and a refused pattern is not saved as though it worked',
    apply.indexOf('setPattern') > apply.indexOf('if (!applied.ok)'));
}

// ---- completing a palette ---------------------------------------------------
//
// Reported in play: "the orange part won't change with the presets". Every
// ready-made look defines six of the ten fields, so the other four kept
// whatever the dinosaur hatched with — and on a male Carnotaurus the one that
// shows is MaleDisplayColor, down the back and neck.

{
  const partial = {
    BodyColor: '#101010',
    MarkingsColor: '#202020',
    FlankColor: '#303030',
    UnderbellyColor: '#404040',
    Detail1Color: '#505050',
    EyesColor: '#606060',
  };
  const full = completeLook(partial);

  for (const { field } of PARTS) {
    check(`a completed look sets ${field}`, typeof full[field] === 'string', full[field]);
  }

  // Derived from the palette, not from a stock colour, or a look acquires a
  // mouth in somebody else's scheme.
  check('the male display follows the detail colour', full.MaleDisplayColor === '#505050');
  check('teeth follow the underbelly', full.TeethColor === '#404040');
  check('mouth and claws follow the markings',
    full.MouthColor === '#202020' && full.ClawsColor === '#202020');

  check('what was given is never overwritten',
    full.BodyColor === '#101010' && full.EyesColor === '#606060');
}

{
  // A palette that names all ten is already complete and must come back
  // unchanged.
  const whole = Object.fromEntries(PARTS.map(({ field }, n) =>
    [field, `#0000${String(n).padStart(2, '0')}`]));
  const same = completeLook(whole);
  check('a complete palette is untouched',
    PARTS.every(({ field }) => same[field] === whole[field]));
}

{
  // Body alone is enough to derive the four from. The other six are a
  // palette's own business — completing is about the fields nothing ever set,
  // not inventing a whole look from one colour.
  const sparse = completeLook({ BodyColor: '#ABCDEF' });
  check('body alone still fills the four that presets miss',
    ['MaleDisplayColor', 'TeethColor', 'MouthColor', 'ClawsColor']
      .every((field) => sparse[field] === '#ABCDEF'),
    JSON.stringify(sparse));
  check('and does not invent the ones a palette should name',
    sparse.MarkingsColor === undefined && sparse.EyesColor === undefined);

  check('and an empty one invents nothing',
    Object.keys(completeLook({})).length === 0);
}

{
  // The built-ins are the things people actually pick, so check the real ones.
  for (const [name, look] of Object.entries(BUILT_IN)) {
    const full = completeLook(look.colours);
    check(`${name} covers the male display once completed`,
      typeof full.MaleDisplayColor === 'string', name);
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
