// Putting a line on somebody's screen.
//
// This exists because of a real bug: prime conditions stopped updating in game
// while /prime in Discord showed them changing correctly. The flags were fine.
// The persistent notice is the same widget the game draws the prime checklist
// in, so any bot notice evicted it until a condition next changed.
//
// So the thing worth testing is which channel each notice takes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { tell, tellEveryone, noticeStyle, setNoticeStyle } = await load('tell.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'tell.sqlite');
const db = new Database(file);

const S = '76561198000000001';

function makeCtx({ online = [S], modThrows = false, rconThrows = false } = {}) {
  const persistent = [];
  const banners = [];
  return {
    db,
    persistent,
    banners,
    mod: {
      notify: async (steam, text) => {
        if (modThrows) throw new Error('unreachable');
        persistent.push({ steam, text });
        return true;
      },
    },
    rcon: {
      directMessage: async (steam, text) => {
        if (rconThrows) throw new Error('unreachable');
        banners.push({ steam, text });
      },
      players: async () => online.map((steamId) => ({ steamId, name: steamId })),
    },
  };
}

// ---- the default ------------------------------------------------------------

{
  const ctx = makeCtx();
  // The whole point: the default must not squat the prime widget.
  check('the banner is the default', noticeStyle(ctx) === 'banner');

  await tell(ctx, S, 'hello');
  check('an ordinary notice takes the banner', ctx.banners.length === 1);
  check('and leaves the prime widget alone', ctx.persistent.length === 0,
    JSON.stringify(ctx.persistent));
}

// ---- taking the slot on purpose ---------------------------------------------

{
  const ctx = makeCtx();
  await tell(ctx, S, 'cleanup in 10 minutes', { persist: true });
  check('persist takes the persistent widget', ctx.persistent.length === 1);
  check('and does not also send a banner', ctx.banners.length === 0);
}

// ---- the setting ------------------------------------------------------------

{
  const ctx = makeCtx();
  setNoticeStyle(ctx, 'persistent');
  check('the style can be changed', noticeStyle(ctx) === 'persistent');

  await tell(ctx, S, 'hello');
  check('and then ordinary notices are persistent too', ctx.persistent.length === 1);

  setNoticeStyle(ctx, 'banner');
  check('and changed back', noticeStyle(ctx) === 'banner');

  // A nonsense value must not silently become persistent and reintroduce the
  // bug this whole module exists for.
  db.setSetting('notice_style', 'nonsense');
  check('an unrecognised setting falls back to the banner',
    noticeStyle(ctx) === 'banner');
  setNoticeStyle(ctx, 'banner');
}

// ---- failing safely ---------------------------------------------------------

{
  const ctx = makeCtx({ rconThrows: true });
  let threw = false;
  try {
    check('a failed banner reports false', (await tell(ctx, S, 'hi')) === false);
  } catch {
    threw = true;
  }
  check('and never throws at the caller', !threw);
}

{
  const ctx = makeCtx({ modThrows: true });
  check('a failed persistent notice reports false',
    (await tell(ctx, S, 'hi', { persist: true })) === false);
}

// ---- everybody --------------------------------------------------------------

{
  const ctx = makeCtx({ online: [S, '76561198000000002', '76561198000000003'] });
  const told = await tellEveryone(ctx, 'cleanup in 10 minutes', { persist: true });

  check('everybody online is told', told === 3, String(told));
  check('each on the persistent widget', ctx.persistent.length === 3);
  // There is no broadcast form of the persistent notice; it is a client RPC on
  // one controller, so this must genuinely be per player.
  check('and each addressed individually',
    new Set(ctx.persistent.map((p) => p.steam)).size === 3);
}

{
  const ctx = makeCtx({ online: [] });
  check('an empty server is not an error',
    (await tellEveryone(ctx, 'nobody here')) === 0);
}

{
  // Half the server seeing a cleanup warning beats none of it.
  const ctx = makeCtx({ online: [S, '76561198000000002'], rconThrows: true });
  check('a server that will not answer counts zero rather than throwing',
    (await tellEveryone(ctx, 'hi')) === 0);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
