// Rewriting Game.ini. This file holds every setting the server has, so the one
// thing that must never happen is losing or mangling a line that is not ours.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { AdminStore } = await import(pathToFileURL(path.join(root, 'dist/admins.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Shaped like the real file: lowercase section headers, the admin keys sitting
// among unrelated settings, and other keys whose names start the same way.
const SAMPLE = [
  '[/script/theisle.tigamesession]',
  'MaxPlayerCount=100',
  '',
  '[/script/theisle.tigamestatebase]',
  'bServerWhitelist=false',
  'AdminsSteamIDs=76561198398925364',
  'AdminsSteamIDs=76561199140473849',
  'AdminsSteamIDs=76561198678474769',
  'VIPs=SteamID',
  'WhitelistIDs=SteamID',
  'ServerName=Test',
  '',
  '[/script/theisle.tigamemode]',
  'bEnableGlobalChat=true',
].join('\n');

{
  const found = AdminStore.parseAdmins(SAMPLE);
  check('reads every admin', found.length === 3, found.join(','));
  check('reads them in order', found[0] === '76561198398925364');
  check('does not mistake VIPs or WhitelistIDs for admins',
    !found.includes('SteamID') && found.every((id) => /^7656119\d{10}$/.test(id)));
}

{
  const junk = 'AdminsSteamIDs=\nAdminsSteamIDs=notanid\nAdminsSteamIDs=76561198398925364';
  const found = AdminStore.parseAdmins(junk);
  check('ignores blank and malformed values', found.length === 1, found.join(','));
}

{
  // The slot count drives the "1/100" in the bot's status. The key is
  // MaxPlayerCount, not MaxPlayers, and it lives in TIGameSession.
  check('reads the slot count', AdminStore.parseMaxPlayers(SAMPLE) === 100);
  check('a missing slot count is null, not zero',
    AdminStore.parseMaxPlayers('[/script/theisle.tigamesession]') === null);
  check('a nonsense slot count is null',
    AdminStore.parseMaxPlayers('MaxPlayerCount=abc') === null);
  check('zero slots is treated as unknown rather than shown as /0',
    AdminStore.parseMaxPlayers('MaxPlayerCount=0') === null);
  check('the rewrite keeps the slot count intact',
    AdminStore.parseMaxPlayers(AdminStore.replaceAdmins(SAMPLE, ['76561198398925364'])) === 100);
}

{
  const next = AdminStore.replaceAdmins(SAMPLE, [
    '76561198398925364',
    '76561199140473849',
    '76561198678474769',
    '76561198000000001',
  ]);
  const found = AdminStore.parseAdmins(next);

  check('adding keeps the existing admins', found.length === 4, found.join(','));
  check('the new admin is present', found.includes('76561198000000001'));

  // The whole point: nothing else may move.
  for (const line of ['MaxPlayerCount=100', 'bServerWhitelist=false', 'VIPs=SteamID',
    'WhitelistIDs=SteamID', 'ServerName=Test', 'bEnableGlobalChat=true',
    '[/script/theisle.tigamemode]', '[/script/theisle.tigamesession]']) {
    check(`preserves ${line}`, next.includes(line));
  }

  check('does not duplicate the admin key elsewhere',
    (next.match(/^AdminsSteamIDs=/gm) ?? []).length === 4);
  check('admins stay inside their own section',
    next.indexOf('AdminsSteamIDs=') > next.indexOf('[/script/theisle.tigamestatebase]') &&
    next.indexOf('AdminsSteamIDs=76561198000000001') < next.indexOf('[/script/theisle.tigamemode]'));
}

{
  const next = AdminStore.replaceAdmins(SAMPLE, ['76561198398925364']);
  check('removing drops exactly the removed ones',
    AdminStore.parseAdmins(next).join(',') === '76561198398925364');
  check('removing leaves other settings alone', next.includes('VIPs=SteamID'));
}

{
  const next = AdminStore.replaceAdmins(SAMPLE, []);
  check('an empty list writes no admin lines', !/^AdminsSteamIDs=/m.test(next));
  check('an empty list still keeps the file', next.includes('ServerName=Test'));
}

{
  // A config with no game-state section at all: writing bare keys would leave
  // them ignored by the engine, so the section has to be created.
  const bare = '[/script/engine.gamesession]\nMaxPlayers=100';
  const next = AdminStore.replaceAdmins(bare, ['76561198398925364']);
  check('creates the section when it is missing',
    next.includes('[/script/theisle.tigamestatebase]') &&
    AdminStore.parseAdmins(next).length === 1);
}

{
  // The server writes CRLF; a round trip must not leave stray \r on our lines.
  const crlf = SAMPLE.replace(/\n/g, '\r\n');
  const next = AdminStore.replaceAdmins(crlf, ['76561198398925364']);
  check('handles CRLF input', AdminStore.parseAdmins(next).length === 1);
  check('no stray carriage returns survive', !next.includes('\r'));
}

{
  // Idempotence: the reconciler runs on a timer, so repeated writes of the same
  // desired state must converge rather than accumulate.
  const once = AdminStore.replaceAdmins(SAMPLE, ['76561198398925364', '76561199140473849']);
  const twice = AdminStore.replaceAdmins(once, ['76561198398925364', '76561199140473849']);
  check('writing twice changes nothing the second time', once === twice);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
