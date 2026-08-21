// Backup and restore. The MySQL half needs a server, so what is tested here is
// the half that can silently lose data: reading every table out, and putting a
// snapshot back without mangling it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-'));
const db = new Database(path.join(dir, 'b.sqlite'));

// ---- finding the tables ---------------------------------------------------

const tables = db.tableNames();
check('every table is found', tables.length > 5, `${tables.length} tables`);
check('SQLite internals are left out', !tables.some((t) => t.startsWith('sqlite_')));

// The point of reading the schema rather than keeping a list: these must all be
// picked up without anybody remembering to add them.
for (const table of ['links', 'settings', 'points', 'purchases', 'founders', 'species_caps']) {
  check(`${table} is included`, tables.includes(table), tables.join(','));
}

// ---- dumping and restoring ------------------------------------------------

db.saveLink('discord-1', '76561198000000001');
db.setSetting('some_key', 'some value');
db.addPoints('76561198000000001', 250, 30);
db.claimFounder('discord-1', 'firstlight', 50);
db.setSpeciesCap('Tyrannosaurus', 5);

const snapshot = Object.fromEntries(tables.map((t) => [t, db.dumpTable(t)]));

check('a dump has the rows', snapshot['links'].length === 1, JSON.stringify(snapshot['links']));
check('and their columns', 'steam_id' in snapshot['links'][0],
  Object.keys(snapshot['links'][0]).join(','));
check('points came out', snapshot['points'].length === 1);
check('the founder claim came out', snapshot['founders'].length === 1);

check('dumping an unknown table is refused, not interpolated into SQL', (() => {
  try {
    db.dumpTable('links; DROP TABLE links');
    return false;
  } catch {
    return true;
  }
})());

// Wreck the live database, the way a wiped data directory would.
db.clearSkin('76561198000000001');
db.replaceTable('links', []);
db.replaceTable('points', []);
db.replaceTable('founders', []);
check('the damage is real', db.linkFor('discord-1') === null);
check('and points are gone', db.pointsFor('76561198000000001').balance === 0);

// Put it back.
let restored = 0;
for (const [table, rows] of Object.entries(snapshot)) restored += db.replaceTable(table, rows);

check('the restore wrote rows back', restored > 0, `${restored} rows`);
check('the link is back', db.linkFor('discord-1')?.steamId === '76561198000000001');
check('the points are back', db.pointsFor('76561198000000001').balance === 250);
check('the founder claim is back', db.founderSkin('discord-1') === 'firstlight');
check('the cap is back', db.speciesCaps().some((c) => c.species === 'Tyrannosaurus'));
check('settings came back too', db.getSetting('some_key') === 'some value');

// Restoring twice must not double every row.
for (const [table, rows] of Object.entries(snapshot)) db.replaceTable(table, rows);
check('restoring twice is not additive', db.dumpTable('links').length === 1,
  String(db.dumpTable('links').length));

// A snapshot missing a column the schema requires must NOT be papered over by
// inventing values - points rows with a made-up timestamp are worse than a
// refusal. What matters is that the refusal rolls back, so the live table is
// not emptied by a restore that then failed.
{
  const older = db.dumpTable('points').map((row) => ({
    steam_id: row.steam_id, balance: row.balance,
  }));

  let refused = false;
  try {
    db.replaceTable('points', older);
  } catch (err) {
    refused = true;
    check('the failure names the table', /points/.test(String(err)), String(err));
    check('and says the table was left alone', /untouched/.test(String(err)));
  }

  check('a snapshot missing a required column is refused', refused);
  check('and the live rows are still there, not wiped by the attempt',
    db.pointsFor('76561198000000001').balance === 250,
    String(db.pointsFor('76561198000000001').balance));
}

check('an empty snapshot empties the table rather than throwing',
  db.replaceTable('purchases', []) === 0);
check('restoring an unknown table is refused', (() => {
  try {
    db.replaceTable('not_a_table', []);
    return false;
  } catch {
    return true;
  }
})());

db.close();
fs.rmSync(dir, { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
