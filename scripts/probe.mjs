// Sends one command straight to the mod over SFTP and waits for its result.
//
// The bot normally does this, but the bot runs on a host this machine cannot
// reach — so diagnosing anything mod-side meant asking somebody in game to
// press a button and describe what happened. This talks to the same inbox the
// bot uses.
//
//   node scripts/probe.mjs <verb> <steamId> [key=value ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import SftpClient from 'ssh2-sftp-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

const [verb, steam, ...rest] = process.argv.slice(2);
if (!verb || !steam) {
  console.error('usage: node scripts/probe.mjs <verb> <steamId> [key=value ...]');
  process.exit(2);
}

const args = Object.fromEntries(rest.map((pair) => {
  const at = pair.indexOf('=');
  return [pair.slice(0, at), pair.slice(at + 1)];
}));

const savedDir = `/${env.MOD_DIR.replace(/^\/+|\/+$/g, '')}`;
const id = `probe-${Date.now().toString(36)}`;
const line = JSON.stringify({ id, ts: Math.floor(Date.now() / 1000), verb, steam, args });

const client = new SftpClient();
await client.connect({
  host: env.SFTP_HOST,
  port: Number(env.SFTP_PORT ?? 22),
  username: env.SFTP_USER,
  password: env.SFTP_PASSWORD,
  readyTimeout: 20_000,
});

try {
  const inbox = `${savedDir}/inbox.ndjson`;
  const existing = await client.get(inbox).catch(() => null);
  const prefix = Buffer.isBuffer(existing) ? existing.toString('utf8') : '';

  // Same two-step the mod's own writer uses: it polls every 3s and would
  // happily read a file that is still being filled.
  const tmp = `${inbox}.uploading`;
  await client.put(Buffer.from(prefix + line + '\n', 'utf8'), tmp);
  try { await client.delete(inbox); } catch { /* not there */ }
  await client.rename(tmp, inbox);
  console.log(`-> ${verb} ${steam} ${JSON.stringify(args)}`);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const body = await client.get(`${savedDir}/results.ndjson`).catch(() => null);
    if (!Buffer.isBuffer(body)) continue;

    const hit = body.toString('utf8').split(/\r?\n/)
      .filter((l) => l.includes(id))
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find(Boolean);

    if (hit) {
      console.log(`<- ok=${hit.ok} ${hit.msg}`);
      if (hit.data !== undefined) console.log(JSON.stringify(hit.data, null, 2));
      process.exit(hit.ok ? 0 : 1);
    }
  }
  console.error('no answer in 30s');
  process.exit(1);
} finally {
  await client.end();
}
