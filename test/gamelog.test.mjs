// Forwarding the game's own command log.
//
// The lines here are real, copied from TheIsle.log on the live server, because
// the format belongs to the game — a test written against an invented shape
// would pass happily while the feature forwarded nothing at all.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  parseCommandLines, buildGameLogEmbed, gameLogEnabled, setGameLogEnabled,
  runGameLog, GAME_LOG_PATH,
} = await load('gamelog.js');
const { setAuditChannel } = await load('auditlog.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Verbatim from the server, 2026-08-23.
const REAL_ANNOUNCE = '[2026.08.23-14.50.16:447][523]LogTheIsleCommandData: [2026.08.23-14.50.16] RCON Command Used [Announce] : Server cleanup in 10 minutes to keep performance smooth.';
const REAL_POLL = '[2026.08.23-14.46.56:364][443]LogTheIsleCommandData: [2026.08.23-14.46.56] RCON Command Used [Get Player List] : ';
const UNRELATED = '[2026.08.23-14.17.13:188][  0]LogWorld: Bringing up level for play took: 0.771196';
const ODD = '[2026.08.23-14.50.16:447][523]LogTheIsleCommandData: something new happened';

// ---- parsing ----------------------------------------------------------------

{
  const lines = parseCommandLines(REAL_ANNOUNCE);
  check('a real command line is picked up', lines.length === 1, JSON.stringify(lines));
  check('the command is pulled out', lines[0]?.command === 'Announce', lines[0]?.command);
  check('and the source', lines[0]?.source === 'RCON', lines[0]?.source);
  check('and what was passed with it',
    /cleanup in 10 minutes/.test(lines[0]?.args ?? ''), lines[0]?.args);
  // The embed carries a timestamp already; the game's own would be duplication.
  check('the repeated timestamp is stripped',
    !/^\[2026/.test(lines[0]?.text ?? ''), lines[0]?.text);
}

{
  // The bot asks for this every minute. Forwarding it buries everything else.
  check('the player-list poll is dropped', parseCommandLines(REAL_POLL).length === 0);
  check('ordinary engine logging is ignored', parseCommandLines(UNRELATED).length === 0);
  check('an empty chunk is not an error', parseCommandLines('').length === 0);
}

{
  const many = parseCommandLines([REAL_ANNOUNCE, REAL_POLL, UNRELATED, REAL_ANNOUNCE].join('\n'));
  check('a chunk of mixed lines keeps only the real ones', many.length === 2,
    String(many.length));
}

{
  // A shape the game changes, or a source that is not RCON. Forwarding it raw
  // beats dropping it: a log that discards what it does not understand is
  // worse than one that occasionally shows something odd.
  const odd = parseCommandLines(ODD);
  check('an unrecognised shape is still forwarded', odd.length === 1, JSON.stringify(odd));
  check('and keeps its text', /something new/.test(odd[0]?.text ?? ''));
}

// ---- the embed --------------------------------------------------------------

{
  const [line] = parseCommandLines(REAL_ANNOUNCE);
  const json = buildGameLogEmbed(line).toJSON();
  check('the embed names the command', /Announce/.test(json.title ?? ''), json.title);
  check('and says where it came from', /RCON/.test(json.description ?? ''), json.description);
  check('and shows the arguments', /cleanup/.test(JSON.stringify(json.fields ?? [])));
  check('it fits Discord limits',
    JSON.stringify(json).length < 6000
    && (json.fields ?? []).every((f) => f.value.length <= 1024));

  const [raw] = parseCommandLines(ODD);
  const rawJson = buildGameLogEmbed(raw).toJSON();
  check('an unparsed line still renders something readable',
    /something new/.test(rawJson.description ?? ''), rawJson.description);
}

// ---- running ----------------------------------------------------------------

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'gamelog.sqlite');
const db = new Database(file);

function makeCtx(tail) {
  const sent = [];
  return {
    db,
    sent,
    mod: { tailFile: async () => tail },
    client: {
      channels: {
        fetch: async () => ({
          isTextBased: () => true,
          send: async (payload) => { sent.push(payload); return { id: 'm' }; },
        }),
      },
    },
  };
}

const quiet = () => {};

{
  const ctx = makeCtx({ text: REAL_ANNOUNCE, at: 500, rotated: false });
  setAuditChannel(ctx, '999');

  check('nothing is forwarded while it is switched off',
    (await runGameLog(ctx, ctx.client, quiet)) === 0);

  setGameLogEnabled(ctx, true);
  check('and it reads back as on', gameLogEnabled(ctx));

  const sent = await runGameLog(ctx, ctx.client, quiet);
  check('a command line is forwarded', sent === 1, String(sent));
  check('nobody is pinged by it',
    JSON.stringify(ctx.sent[0]?.allowedMentions) === JSON.stringify({ parse: [] }));
}

{
  // Without a channel there is nowhere to put it.
  const ctx = makeCtx({ text: REAL_ANNOUNCE, at: 900, rotated: false });
  setGameLogEnabled(ctx, true);
  setAuditChannel(ctx, null);
  check('with no staff channel nothing is forwarded',
    (await runGameLog(ctx, ctx.client, quiet)) === 0);
  setAuditChannel(ctx, '999');
}

{
  // A server restart truncates the log. Seeking past the end of a fresh file
  // would silently forward nothing ever again.
  const ctx = makeCtx({ text: REAL_ANNOUNCE, at: 50, rotated: true });
  setGameLogEnabled(ctx, true);
  const sent = await runGameLog(ctx, ctx.client, quiet);
  check('a rotated log still forwards', sent === 1, String(sent));
}

{
  const ctx = makeCtx({ text: '', at: 900, rotated: false });
  setGameLogEnabled(ctx, true);
  check('an unchanged log sends nothing', (await runGameLog(ctx, ctx.client, quiet)) === 0);
}

{
  // Unreachable server: a log tail must never be worth failing a poll over.
  const ctx = makeCtx(null);
  setGameLogEnabled(ctx, true);
  let threw = false;
  try {
    await runGameLog(ctx, ctx.client, quiet);
  } catch {
    threw = true;
  }
  check('an unreadable log never throws', !threw);
}

{
  // A burst must not turn into thirty messages at once.
  const ctx = makeCtx({
    text: Array.from({ length: 30 }, () => REAL_ANNOUNCE).join('\n'),
    at: 5000,
    rotated: false,
  });
  setGameLogEnabled(ctx, true);
  const sent = await runGameLog(ctx, ctx.client, quiet);
  check('a burst is capped per pass', sent === 10, String(sent));
}

check('the log path is the dedicated server default',
  GAME_LOG_PATH === '/TheIsle/Saved/Logs/TheIsle.log', GAME_LOG_PATH);

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
