// The mod bridge against a fake mod that speaks the same NDJSON protocol,
// reached over a real in-process SFTP server. No game server needed.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ssh2 from 'ssh2';

const { Server, utils } = ssh2;
const { STATUS_CODE, OPEN_MODE } = utils.sftp;

const root = path.resolve(import.meta.dirname, '..');
const { ModBridge } = await import(pathToFileURL(path.join(root, 'dist/bridge.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---- minimal SFTP server backed by a real directory -------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evrima-bridge-'));
const modDir = path.join(tmp, 'Saved');
fs.mkdirSync(modDir);

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;

const server = new Server({ hostKeys: [privateKey] }, (client) => {
  client
    .on('authentication', (auth) => {
      if (auth.method === 'password' && auth.username === 'test' && auth.password === 'test') auth.accept();
      else if (auth.method === 'none') auth.reject(['password']);
      else auth.reject();
    })
    .on('ready', () => {
      client.on('session', (acceptSession) => {
        acceptSession().on('sftp', (acceptSftp) => attach(acceptSftp()));
      });
    })
    .on('error', () => {});
});

function attach(sftp) {
  const handles = new Map();
  let next = 0;

  const resolve = (given) => {
    const rel = String(given).replace(/^\/+/, '');
    const full = path.resolve(tmp, rel);
    return full === tmp || full.startsWith(tmp + path.sep) ? full : null;
  };
  const makeHandle = (value) => {
    const id = next++;
    handles.set(id, value);
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(id, 0);
    return buf;
  };
  const read = (h) => handles.get(h.readUInt32BE(0));
  const attrs = (st) => ({
    mode: (st.isDirectory() ? S_IFDIR : S_IFREG) | 0o644,
    uid: 0, gid: 0, size: st.size,
    atime: Math.floor(st.atimeMs / 1000), mtime: Math.floor(st.mtimeMs / 1000),
  });

  const stat = (reqid, given) => {
    const target = resolve(given);
    if (!target) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    try { sftp.attrs(reqid, attrs(fs.statSync(target))); }
    catch { sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE); }
  };

  sftp.on('REALPATH', (reqid, given) => {
    const rel = String(given) === '.' ? '' : String(given).replace(/^\/+/, '');
    sftp.name(reqid, [{ filename: `/${rel}`, longname: `/${rel}`, attrs: {} }]);
  });
  sftp.on('STAT', stat);
  sftp.on('LSTAT', stat);
  sftp.on('FSTAT', (reqid, h) => {
    const entry = read(h);
    try { sftp.attrs(reqid, attrs(fs.statSync(entry.path))); }
    catch { sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE); }
  });
  sftp.on('OPEN', (reqid, filename, flags) => {
    const target = resolve(filename);
    if (!target) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
    const writing = flags & (OPEN_MODE.WRITE | OPEN_MODE.APPEND | OPEN_MODE.CREAT | OPEN_MODE.TRUNC);
    try { sftp.handle(reqid, makeHandle({ fd: fs.openSync(target, writing ? 'w' : 'r'), path: target })); }
    catch { sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE); }
  });
  sftp.on('READ', (reqid, h, offset, length) => {
    const entry = read(h);
    const buf = Buffer.alloc(length);
    const n = fs.readSync(entry.fd, buf, 0, length, offset);
    if (n === 0) return sftp.status(reqid, STATUS_CODE.EOF);
    sftp.data(reqid, buf.subarray(0, n));
  });
  sftp.on('WRITE', (reqid, h, offset, data) => {
    const entry = read(h);
    fs.writeSync(entry.fd, data, 0, data.length, offset);
    sftp.status(reqid, STATUS_CODE.OK);
  });
  sftp.on('CLOSE', (reqid, h) => {
    const entry = read(h);
    if (entry?.fd !== undefined) { try { fs.closeSync(entry.fd); } catch {} }
    handles.delete(h.readUInt32BE(0));
    sftp.status(reqid, STATUS_CODE.OK);
  });
  sftp.on('OPENDIR', (reqid, given) => {
    const target = resolve(given);
    if (!target || !fs.existsSync(target)) return sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
    sftp.handle(reqid, makeHandle({ dir: target, sent: false }));
  });
  sftp.on('READDIR', (reqid, h) => {
    const entry = read(h);
    if (entry.sent) return sftp.status(reqid, STATUS_CODE.EOF);
    entry.sent = true;
    sftp.name(reqid, fs.readdirSync(entry.dir).map((name) => {
      const st = fs.statSync(path.join(entry.dir, name));
      return { filename: name, longname: `${st.isDirectory() ? 'd' : '-'}rw-r--r-- 1 u u ${st.size} ${name}`, attrs: attrs(st) };
    }));
  });
  sftp.on('REMOVE', (reqid, given) => {
    const target = resolve(given);
    try { fs.unlinkSync(target); sftp.status(reqid, STATUS_CODE.OK); }
    catch { sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE); }
  });
  sftp.on('RENAME', (reqid, from, to) => {
    const src = resolve(from);
    const dst = resolve(to);
    // Many real SFTP servers refuse to clobber, so mirror that.
    if (fs.existsSync(dst)) return sftp.status(reqid, STATUS_CODE.FAILURE);
    try { fs.renameSync(src, dst); sftp.status(reqid, STATUS_CODE.OK); }
    catch { sftp.status(reqid, STATUS_CODE.FAILURE); }
  });
  sftp.on('MKDIR', (reqid, given) => {
    fs.mkdirSync(resolve(given), { recursive: true });
    sftp.status(reqid, STATUS_CODE.OK);
  });
}

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

// ---- fake mod ---------------------------------------------------------------

const fakeMod = { enabled: true, seen: [] };

const modTimer = setInterval(() => {
  if (!fakeMod.enabled) return;
  const inbox = path.join(modDir, 'inbox.ndjson');
  if (!fs.existsSync(inbox)) return;

  const processing = path.join(modDir, 'inbox.processing');
  try { fs.renameSync(inbox, processing); } catch { return; }
  const body = fs.readFileSync(processing, 'utf8');
  fs.rmSync(processing, { force: true });

  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let cmd;
    try { cmd = JSON.parse(line); } catch { continue; }
    fakeMod.seen.push(cmd);

    const result = { id: cmd.id, ts: 0, verb: cmd.verb, steam: cmd.steam, ok: true, msg: `${cmd.verb} ok` };
    if (cmd.verb === 'list') {
      result.data = [{ slot: 'rex', species: 'Tyrannosaurus', storedAt: 1786800000 }];
      result.msg = '1 of 3 slots used';
    }
    if (cmd.verb === 'store') result.msg = `stored your Allosaurus in ${cmd.args.slot}`;
    fs.appendFileSync(path.join(modDir, 'results.ndjson'), JSON.stringify(result) + '\n');
  }
}, 200);

// ---- tests ------------------------------------------------------------------

const bridge = new ModBridge({
  host: '127.0.0.1', port, username: 'test', password: 'test', modDir: 'Saved',
});

try {
  await bridge.check();
  check('finds the mod directory', true);

  const list = await bridge.run('list', '76561198000000042');
  check('list returns slots', list.ok && list.data?.[0]?.slot === 'rex', JSON.stringify(list.data));

  const sent = fakeMod.seen.at(-1);
  check('command carries verb and steam id', sent.verb === 'list' && sent.steam === '76561198000000042');
  check('command has a correlation id', typeof sent.id === 'string' && sent.id.length > 0, sent.id);

  const store = await bridge.run('store', '76561198000000042', { slot: 'my-rex' });
  check('store passes its slot through', fakeMod.seen.at(-1).args.slot === 'my-rex');
  check('store returns the mod message', /my-rex/.test(store.msg), store.msg);

  const slay = await bridge.run('slay', '76561198000000042');
  check('slay round-trips', slay.ok && slay.verb === 'slay');

  // Two at once must both arrive: the bridge does read-append-write on one file.
  const before = fakeMod.seen.length;
  await Promise.all([
    bridge.run('list', '76561198000000042'),
    bridge.run('delete', '76561198000000042', { slot: 'gone' }),
  ]);
  const delivered = fakeMod.seen.slice(before);
  const verbs = new Set(delivered.map((c) => c.verb));
  check('concurrent commands are not lost', verbs.has('list') && verbs.has('delete'),
    `got ${[...verbs].join(', ')}`);

  // Counting physical writes would be wrong: the transport reconnects and
  // resends when SFTP stalls, which is legitimate and happens under load. What
  // must hold is that a resend reuses its correlation id — that is what lets
  // the mod dedupe it instead of storing a dinosaur twice.
  check('a resend reuses its id, so the mod can dedupe it',
    new Set(delivered.map((c) => c.id)).size === 2,
    `${delivered.length} write(s), ${new Set(delivered.map((c) => c.id)).size} distinct id(s)`);

  // With the mod down, this must fail cleanly rather than hang.
  fakeMod.enabled = false;
  const started = Date.now();
  let message = '';
  await bridge.run('delete', '76561198000000042', { slot: 'ghost' }).catch((err) => { message = err.message; });
  check('times out cleanly when the mod is silent', /did not answer/.test(message),
    `${((Date.now() - started) / 1000).toFixed(1)}s`);

  const missing = new ModBridge({
    host: '127.0.0.1', port, username: 'test', password: 'test', modDir: 'NotThere',
  });
  let checkErr = '';
  await missing.check().catch((err) => { checkErr = err.message; });
  check('a wrong MOD_DIR is reported clearly', /MOD_DIR not found/.test(checkErr), checkErr.slice(0, 60));
  await missing.close();
} finally {
  clearInterval(modTimer);
  await bridge.close();
  server.close();
}

// ---- notification text -----------------------------------------------------
// Verified live 2026-08-17: an ASCII line arrives on screen, and the same line
// with an em dash is swallowed with no error and no reply. So this fold is not
// cosmetic, it is the difference between a notice and silence.
{
  const { toPlainAscii } = await import(
    pathToFileURL(path.join(root, 'dist/bridge.js')).href);

  check('an em dash becomes a hyphen',
    toPlainAscii('Travelling in 45s — hold still') === 'Travelling in 45s - hold still',
    toPlainAscii('Travelling in 45s — hold still'));
  check('an en dash becomes a hyphen too', toPlainAscii('a – b') === 'a - b');
  check('curly double quotes are straightened',
    toPlainAscii('“hold”') === '"hold"');
  check('curly single quotes are straightened',
    toPlainAscii('‘still’') === "'still'");
  check('an ellipsis is spelled out', toPlainAscii('wait…') === 'wait...');
  check('a non-breaking space becomes a real one', toPlainAscii('a b') === 'a b');
  check('an emoji is dropped rather than sent and swallowed',
    toPlainAscii('go \u{1F996} now') === 'go  now',
    JSON.stringify(toPlainAscii('go \u{1F996} now')));
  check('plain ASCII is left exactly alone',
    toPlainAscii('Travelling in 45s - hold still') === 'Travelling in 45s - hold still');
  check('the result is always printable ASCII',
    /^[\x20-\x7E]*$/.test(toPlainAscii('mixed — … \u{1F996} café')));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
