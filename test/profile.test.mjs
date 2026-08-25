// One player's own record. The cases that matter are the awkward ones: no
// deaths, no game server, and a brand new player with nothing yet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { buildProfileEmbed, gatherProfile, playtime, ratio } = await load('profile.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const ME = '76561198000000001';
const RIVAL = '76561198000000002';

const fresh = () => new Database(
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'profile.sqlite'));

const fieldNamed = (embed, part) =>
  embed.data.fields.find((f) => f.name.includes(part));

// ---- the small formatters ---------------------------------------------------

{
  check('minutes stay minutes under an hour', playtime(42) === '42m', playtime(42));
  check('and become hours after that', playtime(5160) === '86h', playtime(5160));
  check('a brand new player reads as zero', playtime(0) === '0m', playtime(0));

  // Dividing by zero deaths is the case that turns a profile into "Infinity".
  check('no deaths is not infinity', ratio(3, 0) === '3.0', ratio(3, 0));
  check('nothing at all is zero', ratio(0, 0) === '0.0', ratio(0, 0));
  check('and otherwise it divides', ratio(7, 2) === '3.5', ratio(7, 2));
}

// ---- rank -------------------------------------------------------------------

{
  const db = fresh();
  db.addPoints(ME, 500, 0);
  db.addPoints(RIVAL, 900, 0);

  check('rank counts who is ahead', db.pointsRank(ME).rank === 2,
    JSON.stringify(db.pointsRank(ME)));
  check('the leader is first', db.pointsRank(RIVAL).rank === 1);
  check('and the field is counted', db.pointsRank(ME).of === 2);

  // Two people on the same balance are both "joint first", not first and
  // second by whichever row the database happened to return first.
  db.setPoints(ME, 900);
  check('a tie shares the better rank', db.pointsRank(ME).rank === 1,
    JSON.stringify(db.pointsRank(ME)));

  db.close();
}

// ---- gathering --------------------------------------------------------------

{
  const db = fresh();
  db.addPoints(ME, 1200.7, 5160);
  db.grantSkin(ME, 'riverbed', 'shop');

  const ctx = {
    db,
    mod: { run: async () => ({ ok: true, data: [{ slot: 'allo' }, { slot: 'cera' }] }) },
  };

  const data = await gatherProfile(ctx, '123456789012345678', ME);
  check('points are whole', data.points === 1200, String(data.points));
  check('slots come from the game server', data.slots === 2, String(data.slots));
  check('skins are listed', data.skins.includes('riverbed'));

  db.close();
}

{
  // The game server being down must not take the whole profile with it, and
  // must not read as an empty vault either.
  const db = fresh();
  const ctx = { db, mod: { run: async () => { throw new Error('unreachable'); } } };

  const data = await gatherProfile(ctx, '123456789012345678', ME);
  check('an unreachable server leaves slots unknown', data.slots === null,
    String(data.slots));
  check('and the rest still loads', data.points === 0 && data.kills === 0);

  const embed = buildProfileEmbed(data);
  const storage = fieldNamed(embed, 'Storage');
  check('and the embed says so rather than showing zero',
    storage.value.includes('did not answer') && !storage.value.includes('0 of'),
    storage.value);

  db.close();
}

// ---- the embed --------------------------------------------------------------

{
  const embed = buildProfileEmbed({
    name: 'Shadow',
    steamId: ME,
    points: 12480,
    rank: 5,
    players: 40,
    minutes: 5160,
    kills: 7,
    deaths: 3,
    skins: ['riverbed', 'ash'],
    slots: 2,
    maxSlots: 3,
    firstSeen: '2026-08-01T10:00:00.000Z',
    referrals: 2,
  });

  check('it is titled with their name in game', embed.data.title.includes('Shadow'),
    embed.data.title);
  check('points are grouped for reading',
    fieldNamed(embed, 'Points').value.includes('12,480'),
    fieldNamed(embed, 'Points').value);
  check('rank is shown against the field',
    fieldNamed(embed, 'Points').value.includes('5 of 40'));
  check('storage is shown', /\*\*2\*\* of 3/.test(fieldNamed(embed, 'Storage').value),
    fieldNamed(embed, 'Storage').value);
  check('skins are counted in the heading', fieldNamed(embed, 'Skins') !== undefined);
  check('referrals are mentioned', /Brought \*\*2\*\* players/.test(embed.data.description),
    embed.data.description);
}

{
  // Somebody who linked a minute ago. Every optional part is missing at once,
  // which is exactly when a template built from optional pieces falls apart.
  const embed = buildProfileEmbed({
    name: null,
    steamId: ME,
    points: 0,
    rank: 1,
    players: 1,
    minutes: 0,
    kills: 0,
    deaths: 0,
    skins: [],
    slots: 0,
    maxSlots: 3,
    firstSeen: null,
    referrals: 0,
  });

  check('a nameless account still has a title', typeof embed.data.title === 'string'
    && embed.data.title.length > 0, embed.data.title);
  check('and a description rather than an empty line',
    typeof embed.data.description === 'string' && embed.data.description.length > 0,
    embed.data.description);
  check('no skins means no skins field', fieldNamed(embed, 'Skins') === undefined);
  check('an empty vault says zero, not unknown',
    /\*\*0\*\* of 3/.test(fieldNamed(embed, 'Storage').value)
    && !fieldNamed(embed, 'Storage').value.includes('did not answer'),
    fieldNamed(embed, 'Storage').value);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
