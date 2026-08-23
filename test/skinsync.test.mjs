// Reapplying skins. The engine drops colours on relog, respawn and restart, so
// the bot repaints from its record — and the bugs here are all about the bot
// wrongly believing it has already done so.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { reapplySkins, skinNeedsReapply, forgetAllPainted } = await import(
  pathToFileURL(path.join(root, 'dist/skinsync.js')).href
);

const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const REX = { steam: '76561198000000001', species: 'Tyrannosaurus', growth: 1, female: false, prime: false };
const DRYO = { steam: '76561198000000001', species: 'Dryosaurus', growth: 1, female: false, prime: false };

/**
 * Records every call the bot sends.
 *
 * `paints` counts skinmany only. A repaint also sends `look`, which clears the
 * variation the fresh pawn came with — without it a skin lands on only part of
 * the animal — so counting raw calls would count one paint as two.
 */
function makeCtx(skins, patterns = {}) {
  const sent = [];
  const touches = { count: 0 };
  return {
    sent,
    get paints() { return sent.filter((c) => c.verb === 'skinmany').length; },
    touches,
    db: {
      skinFor: (steam, species) => skins[`${steam}|${species}`] ?? null,
      patternFor: (steam, species) => patterns[`${steam}|${species}`] ?? null,
      // Repainting keeps a look alive, so expiry only catches abandoned ones.
      touchSkin: () => { touches.count += 1; },
    },
    mod: {
      run: async (verb, steam, args) => {
        sent.push({ verb, steam, args });
        return { ok: true, msg: 'applied' };
      },
    },
  };
}

const skins = {
  '76561198000000001|Tyrannosaurus': { BodyColor: '#FF0000' },
  '76561198000000001|Dryosaurus': { BodyColor: '#00FF00' },
};

const quiet = () => {};

// ---- the basics ----------------------------------------------------------------

{
  forgetAllPainted();
  const ctx = makeCtx(skins);

  await reapplySkins(ctx, [REX], quiet);
  check('paints a player who has a saved look', ctx.paints === 1, String(ctx.paints));

  await reapplySkins(ctx, [REX], quiet);
  check('does not repaint every poll', ctx.paints === 1, String(ctx.paints));
}

{
  forgetAllPainted();
  const ctx = makeCtx({});
  await reapplySkins(ctx, [REX], quiet);
  check('a player with no saved look is left alone', ctx.sent.length === 0);
}

// ---- switching species -----------------------------------------------------------

{
  forgetAllPainted();
  const ctx = makeCtx(skins);

  await reapplySkins(ctx, [REX], quiet);
  await reapplySkins(ctx, [DRYO], quiet);

  check('switching species repaints', ctx.paints === 2, String(ctx.paints));
  check('and uses that species’ own colours',
    ctx.sent[1].args.colors !== ctx.sent[0].args.colors,
    `${ctx.sent[0].args.colors} vs ${ctx.sent[1].args.colors}`);
}

// ---- the reported bug ------------------------------------------------------------

{
  // A server restart: the poll fails, so the bot never sees them leave. Without
  // forgetting, it concludes they are still painted and they come back plain.
  forgetAllPainted();
  const ctx = makeCtx(skins);

  await reapplySkins(ctx, [REX], quiet);
  const afterFirst = ctx.paints;

  // ...server restarts, polls fail, then it recovers with the same player on...
  forgetAllPainted();
  await reapplySkins(ctx, [REX], quiet);

  check('repaints after the server was unreachable', ctx.paints === afterFirst + 1,
    `${afterFirst} then ${ctx.sent.length}`);
}

{
  // Dying replaces the pawn, and the kill feed tells us.
  forgetAllPainted();
  const ctx = makeCtx(skins);

  await reapplySkins(ctx, [REX], quiet);
  skinNeedsReapply(REX.steam);
  await reapplySkins(ctx, [REX], quiet);

  check('repaints after a death', ctx.paints === 2, String(ctx.paints));
}

{
  // Leaving and returning, where the bot does observe the gap.
  forgetAllPainted();
  const ctx = makeCtx(skins);

  await reapplySkins(ctx, [REX], quiet);
  await reapplySkins(ctx, [], quiet);
  await reapplySkins(ctx, [REX], quiet);

  check('repaints after they were seen offline', ctx.paints === 2, String(ctx.paints));
}

// ---- patterns ---------------------------------------------------------------------

{
  // An out-of-range pattern makes the client drop the whole rebuild, so it must
  // never share a write with the colours.
  forgetAllPainted();
  const ctx = makeCtx(skins, { '76561198000000001|Tyrannosaurus': 2 });

  await reapplySkins(ctx, [REX], quiet);

  const verbs = ctx.sent.map((s) => s.verb);
  check('the pattern is reapplied too', verbs.includes('pattern'), verbs.join(','));
  check('it is sent separately from the colours',
    verbs.filter((v) => v === 'pattern').length === 1 && verbs.includes('skinmany'),
    verbs.join(','));
  check('and it goes first, so a bad one cannot take the colours with it',
    verbs.indexOf('pattern') < verbs.indexOf('skinmany'), verbs.join(','));
  check('no colour write mentions the pattern',
    ctx.sent.filter((s) => s.verb === 'skinmany')
      .every((s) => !JSON.stringify(s.args).includes('Pattern')));
}

{
  forgetAllPainted();
  const ctx = makeCtx(skins);
  await reapplySkins(ctx, [REX], quiet);
  check('nobody without a saved pattern gets one',
    !ctx.sent.some((s) => s.verb === 'pattern'), ctx.sent.map((s) => s.verb).join(','));
}

// ---- failure handling -------------------------------------------------------------

{
  forgetAllPainted();
  const ctx = makeCtx(skins);
  ctx.mod.run = async () => ({ ok: false, msg: 'not spawned in yet' });

  await reapplySkins(ctx, [REX], quiet);
  ctx.mod.run = async (verb, steam, args) => {
    ctx.sent.push({ verb, steam, args });
    return { ok: true, msg: 'applied' };
  };
  await reapplySkins(ctx, [REX], quiet);

  check('a failed paint is retried rather than marked done', ctx.paints === 1,
    String(ctx.paints));
}

{
  forgetAllPainted();
  const ctx = makeCtx(skins);
  ctx.mod.run = async () => { throw new Error('server unreachable'); };

  let threw = false;
  try {
    await reapplySkins(ctx, [REX], quiet);
  } catch {
    threw = true;
  }
  check('an unreachable server does not throw out of the poll', !threw);
}

{
  // A row with no steam id (older mod payload) must not crash the sweep.
  forgetAllPainted();
  const ctx = makeCtx(skins);
  await reapplySkins(ctx, [{ species: 'Tyrannosaurus', growth: 1, female: false, prime: false }], quiet);
  check('a row with no steam id is skipped', ctx.sent.length === 0);
}

// A look belongs to a dinosaur, not to the player. Dying has to clear it, or a
// skin set once follows someone onto every Allosaurus they ever spawn.
{
  const db = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 's.sqlite'));
  db.setSkin('76561198000000001', 'Allosaurus', 'BodyColor=1,0,0');
  db.setSkin('76561198000000001', 'Tyrannosaurus', 'BodyColor=0,1,0');

  check('a look is saved', db.skinFor('76561198000000001', 'Allosaurus') !== null);

  db.clearSkin('76561198000000001', 'Allosaurus');
  check('dying as one species clears that look',
    db.skinFor('76561198000000001', 'Allosaurus') === null);
  check('and leaves their other species alone',
    db.skinFor('76561198000000001', 'Tyrannosaurus') !== null);

  db.close();
}

// Expiry. Reported live: a colour set days earlier was still being applied to a
// new dinosaur on reconnect. Clearing on death is not enough, because a death
// is only cleared when it is DETECTED - log off with the animal alive and the
// look sits there indefinitely.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-'));
  const db = new Database(path.join(dir, 'x.sqlite'));

  db.setSkin('76561198000000001', 'Allosaurus', { BodyColor: '#FF0000' });
  db.setSkin('76561198000000001', 'Tyrannosaurus', { BodyColor: '#00FF00' });

  check('a fresh look is kept', db.expireSkins(60_000) === 0);
  check('and reads back', db.skinFor('76561198000000001', 'Allosaurus') !== null);

  // Let both age past a one second window.
  await new Promise((r) => setTimeout(r, 1100));

  // Only one of them is being worn.
  db.touchSkin('76561198000000001', 'Tyrannosaurus');

  const gone = db.expireSkins(1000);
  check('the one nobody wore is forgotten', gone === 1, `${gone} removed`);
  check('and it is gone for good',
    db.skinFor('76561198000000001', 'Allosaurus') === null);
  check('the one being worn survives, because touching resets the clock',
    db.skinFor('76561198000000001', 'Tyrannosaurus') !== null);

  check('expiring an empty table is not an error', db.expireSkins(1000) >= 0);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
