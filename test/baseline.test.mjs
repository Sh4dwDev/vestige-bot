// Resetting a skin.
//
// Two bugs shipped here at once and neither could be seen from Discord: the
// reset sent `pattern` and `colours` where the mod reads `index` and `colors`,
// so it always reported failure and never put anything back. And it only ever
// restored colours, while the thing that made a dinosaur look different — the
// variation — was cleared by the skin and never returned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { captureBaseline, restoreBaseline, applyLookIndexes } = await load('skins.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'base.sqlite');
const db = new Database(file);
const S = '76561198000000001';

/** Stands in for the mod, recording what it was asked to do. */
function makeCtx(overrides = {}) {
  const sent = [];
  return {
    sent,
    db,
    mod: {
      run: async (verb, steam, args) => {
        sent.push({ verb, args });
        if (overrides[verb]) return overrides[verb];
        return { ok: true, msg: 'ok' };
      },
    },
  };
}

// ---- capturing --------------------------------------------------------------

{
  const ctx = makeCtx({
    skinget: {
      ok: true,
      msg: 'read',
      data: { BodyColor: [0.5, 0.25, 0.125], PatternIndex: 2 },
    },
    look: { ok: true, msg: 'read', data: { pattern: 2, theme: 1, variation: 8 } },
  });

  await captureBaseline(ctx, S, 'Tyrannosaurus');
  const saved = db.baselineFor(S, 'Tyrannosaurus');

  check('the original colours are kept', saved !== null && 'BodyColor' in saved.colours);
  check('so is the pattern', saved?.pattern === 2, String(saved?.pattern));
  // The whole point of this pass: a skin clears these, so a reset that does not
  // know them cannot undo it.
  check('and the theme and variation', saved?.theme === 1 && saved?.variation === 8,
    JSON.stringify(saved));

  // Painting twice must not make the first paint look like the original.
  const second = makeCtx({
    skinget: { ok: true, msg: 'read', data: { BodyColor: [1, 1, 1], PatternIndex: 5 } },
    look: { ok: true, msg: 'read', data: { pattern: 5, theme: 0, variation: 0 } },
  });
  await captureBaseline(second, S, 'Tyrannosaurus');
  check('a second capture does not overwrite the first',
    db.baselineFor(S, 'Tyrannosaurus').pattern === 2);
  check('and does not even ask the server', second.sent.length === 0);
}

// ---- restoring --------------------------------------------------------------

{
  const ctx = makeCtx();
  const outcome = await restoreBaseline(ctx, S, 'Tyrannosaurus');
  check('a captured dinosaur can be reset', outcome === 'restored', outcome);

  const colours = ctx.sent.find((c) => c.verb === 'skinmany');
  check('the colours are sent under the name the mod reads',
    colours !== undefined && typeof colours.args.colors === 'string',
    JSON.stringify(colours?.args));
  check('and not under the one it ignores',
    colours !== undefined && colours.args.colours === undefined);

  const pattern = ctx.sent.find((c) => c.verb === 'pattern');
  check('the pattern likewise', pattern?.args.index === 2, JSON.stringify(pattern?.args));

  const look = ctx.sent.find((c) => c.verb === 'look');
  check('the variation it hatched with is put back',
    look?.args.variation === 8 && look?.args.theme === 1, JSON.stringify(look?.args));
}

{
  const ctx = makeCtx();
  check('a dinosaur nobody captured says so, rather than failing',
    (await restoreBaseline(ctx, S, 'Dryosaurus')) === 'no-baseline');
  check('and nothing is sent for it', ctx.sent.length === 0);
}

{
  const ctx = makeCtx({ skinmany: { ok: false, msg: 'not spawned in' } });
  check('a refused paint is reported as a failure, not a success',
    (await restoreBaseline(ctx, S, 'Tyrannosaurus')) === 'failed');
}

// ---- applying ---------------------------------------------------------------

{
  // Reported in play: "some parts of the dinos the skin changer doesn't
  // change". Colours cannot reach the variation, so a skin has to clear it.
  const ctx = makeCtx();
  await applyLookIndexes(ctx, S, {});
  const look = ctx.sent.find((c) => c.verb === 'look');
  check('applying a skin clears the variation and theme',
    look?.variation !== undefined || (look?.args.variation === 0 && look?.args.theme === 0),
    JSON.stringify(look?.args));

  const chosen = makeCtx();
  await applyLookIndexes(chosen, S, { theme: 3, variation: 2 });
  const asked = chosen.sent.find((c) => c.verb === 'look');
  check('a skin that wants a particular one gets it',
    asked?.args.theme === 3 && asked?.args.variation === 2, JSON.stringify(asked?.args));
}

{
  // A look that fails to send must not take the paint down with it.
  const ctx = makeCtx({ look: { ok: false, msg: 'not on a dinosaur' } });
  check('a refused look is reported without throwing',
    (await applyLookIndexes(ctx, S, {})) === false);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
