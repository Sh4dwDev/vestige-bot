// Reapplying skins. The engine drops colours on relog, respawn and restart, so
// the bot repaints from its record — and the bugs here are all about the bot
// wrongly believing it has already done so.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { reapplySkins, skinNeedsReapply, forgetAllPainted } = await import(
  pathToFileURL(path.join(root, 'dist/skinsync.js')).href
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const REX = { steam: '76561198000000001', species: 'Tyrannosaurus', growth: 1, female: false, prime: false };
const DRYO = { steam: '76561198000000001', species: 'Dryosaurus', growth: 1, female: false, prime: false };

/** Records every skinmany the bot sends. */
function makeCtx(skins, patterns = {}) {
  const sent = [];
  return {
    sent,
    db: {
      skinFor: (steam, species) => skins[`${steam}|${species}`] ?? null,
      patternFor: (steam, species) => patterns[`${steam}|${species}`] ?? null,
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
  check('paints a player who has a saved look', ctx.sent.length === 1, String(ctx.sent.length));

  await reapplySkins(ctx, [REX], quiet);
  check('does not repaint every poll', ctx.sent.length === 1, String(ctx.sent.length));
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

  check('switching species repaints', ctx.sent.length === 2, String(ctx.sent.length));
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
  const afterFirst = ctx.sent.length;

  // ...server restarts, polls fail, then it recovers with the same player on...
  forgetAllPainted();
  await reapplySkins(ctx, [REX], quiet);

  check('repaints after the server was unreachable', ctx.sent.length === afterFirst + 1,
    `${afterFirst} then ${ctx.sent.length}`);
}

{
  // Dying replaces the pawn, and the kill feed tells us.
  forgetAllPainted();
  const ctx = makeCtx(skins);

  await reapplySkins(ctx, [REX], quiet);
  skinNeedsReapply(REX.steam);
  await reapplySkins(ctx, [REX], quiet);

  check('repaints after a death', ctx.sent.length === 2, String(ctx.sent.length));
}

{
  // Leaving and returning, where the bot does observe the gap.
  forgetAllPainted();
  const ctx = makeCtx(skins);

  await reapplySkins(ctx, [REX], quiet);
  await reapplySkins(ctx, [], quiet);
  await reapplySkins(ctx, [REX], quiet);

  check('repaints after they were seen offline', ctx.sent.length === 2, String(ctx.sent.length));
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

  check('a failed paint is retried rather than marked done', ctx.sent.length === 1,
    String(ctx.sent.length));
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

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
