// The RCON client against a fake server speaking Evrima's binary protocol.
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { EvrimaRcon, parsePlayerList } = await import(
  pathToFileURL(path.join(root, 'dist/rcon.js')).href
);

const PASSWORD = 'hunter2';
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Stand-in for a dedicated server's RCON listener. */
function fakeServer({ replies = {}, dropFirst = false } = {}) {
  const seen = [];
  const server = net.createServer((socket) => {
    let authed = false;
    socket.on('data', (chunk) => {
      const frame = chunk[0];
      const end = chunk.indexOf(0x00, 1);
      const body = chunk.subarray(frame === 0x02 ? 2 : 1, end === -1 ? chunk.length : end).toString();

      if (frame === 0x01) {
        authed = body === PASSWORD;
        socket.write(Buffer.from(`${authed ? 'Password Accepted' : 'Wrong Password'}\0`));
        return;
      }
      if (frame !== 0x02 || !authed) return;

      seen.push({ opcode: chunk[1], args: body });
      if (dropFirst && seen.length === 1) { socket.destroy(); return; }

      const reply = replies[chunk[1]];
      if (reply !== undefined) socket.write(Buffer.from(`${reply}\0`));
      // No entry means silence, which is how announce behaves for real.
    });
  });
  return { server, seen, listen: () => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port))) };
}

const PLAYER_LIST = 'PlayerList\nAlice, 76561198000000001\nBob Smith, 76561198000000002';

{
  const fake = fakeServer({ replies: { 0x40: PLAYER_LIST, 0x11: 'Message sent' } });
  const port = await fake.listen();
  const rcon = new EvrimaRcon({ host: '127.0.0.1', port, password: PASSWORD, timeoutMs: 800 });

  const players = await rcon.players();
  check('reads the player list', players.length === 2 && players[0].steamId === '76561198000000001',
    JSON.stringify(players));
  check('keeps names containing spaces', players[1].name === 'Bob Smith');

  await rcon.directMessage('76561198000000001', 'hello');
  const last = fake.seen.at(-1);
  check('direct message uses opcode 0x11', last.opcode === 0x11);
  // The comma separator is Evrima-specific and easy to get wrong.
  check('arguments are comma separated', last.args === '76561198000000001,hello', last.args);

  rcon.close();
  fake.server.close();
}

{
  const fake = fakeServer({});
  const port = await fake.listen();
  const rcon = new EvrimaRcon({ host: '127.0.0.1', port, password: 'wrong', timeoutMs: 800 });

  let message = '';
  await rcon.players().catch((err) => { message = err.message; });
  check('a bad password fails loudly', /authentication rejected/i.test(message), message);

  rcon.close();
  fake.server.close();
}

{
  // Evrima drops idle RCON sockets without warning; the first write after that
  // is lost, so the client has to reconnect and retry.
  const fake = fakeServer({ dropFirst: true, replies: { 0x40: PLAYER_LIST } });
  const port = await fake.listen();
  const rcon = new EvrimaRcon({ host: '127.0.0.1', port, password: PASSWORD, timeoutMs: 800 });

  await rcon.players().catch(() => {});
  check('recovers after a dropped socket', (await rcon.players()).length === 2);

  rcon.close();
  fake.server.close();
}

check('parses the names-line / ids-line layout',
  parsePlayerList('Alice, Bob\n76561198000000001, 76561198000000002').length === 2);
check('falls back to ids when the layout is unknown',
  parsePlayerList('junk 76561198000000001 junk')[0]?.steamId === '76561198000000001');
check('handles an empty list', parsePlayerList('').length === 0);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
