// Kills. The thing worth guarding is the attribution gap: only direct attacks
// produce a killer, so kills and deaths never reconcile — and that has to stay
// visible rather than looking like broken maths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { buildKillEmbed, buildKillsEmbed } = await load('kills.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const A = '76561198000000001';
const B = '76561198000000002';
const name = (s) => `\`${s.slice(-4)}\``;

// ---- storage ----------------------------------------------------------------

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'kills.sqlite');
const db = new Database(file);

db.recordKill(A, B, 'Tyrannosaurus', 'health');
db.recordKill(A, B, 'Dryosaurus', 'health');
db.recordKill(B, A, 'Allosaurus', 'health');
db.recordKill('', A, 'Allosaurus', 'health');       // bled out
db.recordKill('', B, 'Dryosaurus', 'vanished');     // starved

check('the leaderboard counts only attributed kills',
  db.topKillers(10).map((r) => `${r.steamId.slice(-1)}:${r.kills}`).join(',') === '1:2,2:1',
  db.topKillers(10).map((r) => `${r.steamId}:${r.kills}`).join(','));

check('an unattributed death credits nobody',
  db.topKillers(10).every((r) => r.steamId !== ''),
  db.topKillers(10).map((r) => r.steamId).join(','));

check('personal stats count kills and deaths separately',
  db.killStats(A).kills === 2 && db.killStats(A).deaths === 2,
  JSON.stringify(db.killStats(A)));

check('deaths include the unattributed ones',
  db.killStats(B).deaths === 3, JSON.stringify(db.killStats(B)));

const totals = db.killTotals();
check('totals expose the attribution gap',
  totals.total === 5 && totals.attributed === 3, JSON.stringify(totals));

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

// ---- embeds -----------------------------------------------------------------

{
  const killed = buildKillEmbed(
    { killer: A, victim: B, species: 'Tyrannosaurus', cause: 'health' }, name).toJSON();
  check('a kill names both sides', /killed/.test(killed.description ?? ''), killed.description);
  check('a kill shows the victim species', /Tyrannosaurus/.test(killed.description ?? ''));

  const died = buildKillEmbed(
    { killer: '', victim: B, species: 'Dryosaurus', cause: 'health' }, name).toJSON();
  check('an unattributed death does not invent a killer',
    !/killed/.test(died.description ?? '') && /died/.test(died.description ?? ''),
    died.description);
  check('the two are colour coded differently', killed.color !== died.color);

  const noSpecies = buildKillEmbed(
    { killer: '', victim: B, species: '', cause: 'vanished' }, name).toJSON();
  check('a missing species does not render empty brackets',
    !/\(\)|\*\*/.test(noSpecies.description ?? ''), noSpecies.description);
}

{
  const empty = buildKillsEmbed([], { total: 0, attributed: 0 }, name).toJSON();
  check('an empty leaderboard renders', /No kills recorded/.test(empty.description ?? ''));

  const full = buildKillsEmbed(
    Array.from({ length: 10 }, (_, n) => ({ steamId: `7656119800000000${n}`, kills: 50 - n })),
    { total: 200, attributed: 120 },
    name,
  ).toJSON();

  check('the leaderboard stays within limits', JSON.stringify(full).length < 6000,
    `${JSON.stringify(full).length}`);
  check('the footer states the attribution gap',
    /120 of 200/.test(full.footer?.text ?? '') && /80 were/.test(full.footer?.text ?? ''),
    full.footer?.text);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
