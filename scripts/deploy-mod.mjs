// Deploys the DinoStorage mod over SFTP.
//
//   node scripts/deploy-mod.mjs            upload
//   node scripts/deploy-mod.mjs --reload   upload and hot reload
//   node scripts/deploy-mod.mjs --log      tail UE4SS.log
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import SftpClient from 'ssh2-sftp-client';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_MOD = path.join(ROOT, 'mod', 'DinoStorage');
const args = process.argv.slice(2);
const has = (flag) => args.includes(`--${flag}`);

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    .split(/\r?\n/)
    .map((line) => /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

// MOD_DIR points at the mod's Saved folder; the mod root is its parent.
const savedDir = `/${env.MOD_DIR.replace(/^\/+|\/+$/g, '')}`;
const modDir = savedDir.replace(/\/Saved$/i, '');
const ue4ssDir = modDir.replace(/\/Mods\/DinoStorage$/i, '');

const client = new SftpClient();
await client.connect({
  host: env.SFTP_HOST,
  port: Number(env.SFTP_PORT ?? 22),
  username: env.SFTP_USER,
  password: env.SFTP_PASSWORD,
  readyTimeout: 20_000,
});

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

async function putAtomic(target, body) {
  // A plain put creates the file then fills it, and the mod polls every 3s —
  // it can read an empty file in between and silently swallow the command.
  const tmp = `${target}.uploading`;
  await client.put(body, tmp);
  try { await client.delete(target); } catch { /* not there */ }
  await client.rename(tmp, target);
}

try {
  if (has('log')) {
    for (const candidate of [`${ue4ssDir}/UE4SS.log`, `${ue4ssDir}/../UE4SS.log`]) {
      try {
        const buf = await client.get(candidate);
        console.log(buf.toString('utf8').split(/\r?\n/).slice(-40).join('\n'));
        break;
      } catch { /* try the next layout */ }
    }
  } else {
    const files = walk(LOCAL_MOD);

    // A UTF-8 BOM makes Lua fail to parse on line 1, which kills the tick loop
    // — and the tick loop is what performs hot reloads, so only a full server
    // restart recovers it. Refuse rather than ship one.
    for (const rel of files) {
      if (!rel.endsWith('.lua')) continue;
      const body = fs.readFileSync(path.join(LOCAL_MOD, rel));
      if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
        throw new Error(`${rel} starts with a UTF-8 BOM. Save it as UTF-8 without BOM.`);
      }
    }

    console.log(`uploading ${files.length} file(s) -> ${modDir}`);
    for (const rel of files) {
      const remote = `${modDir}/${rel}`;
      await client.mkdir(remote.slice(0, remote.lastIndexOf('/')), true).catch(() => undefined);
      await client.put(path.join(LOCAL_MOD, rel), remote);
      console.log(`  ${rel}`);
    }
    await client.mkdir(`${modDir}/Saved`, true).catch(() => undefined);

    if (has('reload')) {
      const flag = `${modDir}/Saved/reload.flag`;
      await putAtomic(flag, Buffer.from(`deploy ${new Date().toISOString()}`));
      console.log('reload.flag written');

      // Confirm it was consumed. A script that fails to PARSE never starts its
      // tick loop, so the flag sits there forever and hot reload cannot fix it.
      const deadline = Date.now() + 20_000;
      let consumed = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!(await client.exists(flag))) { consumed = true; break; }
      }

      if (consumed) console.log('confirmed: mod reloaded');
      else {
        console.error('\nWARNING: reload.flag was not consumed within 20s.');
        console.error('The mod is probably not running. Check UE4SS.log for');
        console.error('"Error loading script" — a parse error needs a server restart.');
      }
    }
  }
} finally {
  await client.end().catch(() => undefined);
}
