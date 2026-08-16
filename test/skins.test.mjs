// Skin colour handling. The sRGB to linear conversion is the whole game here:
// the engine stores FLinearColor, every colour picker gives sRGB, and writing
// one as the other produces washed-out dinosaurs that look like a bug.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { PARTS, PRESETS, parseHex, toLinear, hexToLinear, hexToInt } = await import(
  pathToFileURL(path.join(root, 'dist/skins.js')).href
);

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

// PatternIndex aborts the whole apply if out of range, and SkinCode is the
// engine's own persistence — neither is ours to write.
check('the picker offers no pattern or skin code fields',
  !PARTS.some((p) => /Pattern|SkinCode/i.test(p.field)));

check('every preset is a valid colour', PRESETS.every((p) => parseHex(p.hex) !== null));
check('presets fit in one autocomplete page', PRESETS.length <= 25, String(PRESETS.length));
check('preset names are unique', new Set(PRESETS.map((p) => p.name)).size === PRESETS.length);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
