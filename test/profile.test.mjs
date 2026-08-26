// One player's own record. The cases that matter are the awkward ones: no
// deaths, no game server, and a brand new player with nothing yet.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { buildProfileEmbed, gatherProfile, playtime, ratio, ordinal, medalFor, colourFor, standing }
  = await load('profile.js');
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

  // The gap is what turns a rank into something worth chasing.
  db.setPoints(ME, 500);
  const mid = db.pointsRank(ME);
  check('the balance above is reported', mid.above === 900, JSON.stringify(mid));
  check('and nothing is below the bottom', mid.below === null, JSON.stringify(mid));
  check('the leader has nothing above', db.pointsRank(RIVAL).above === null);

  db.close();
}

// ---- gathering --------------------------------------------------------------

{
  const db = fresh();
  db.addPoints(ME, 1200.7, 5160);
  db.grantSkin(ME, 'riverbed', 'shop');

  const ctx = {
    db,
    mod: {
      run: async () => ({
        ok: true,
        data: [{ slot: 'allo', species: 'Allosaurus' }, { slot: 'cera', species: 'Ceratosaurus' }],
      }),
    },
  };

  const data = await gatherProfile(ctx, '123456789012345678', ME, 'https://cdn/avatar.png');
  check('points are whole', data.points === 1200, String(data.points));
  check('the species come back, not just a count',
    data.stored.map((a) => a.species).join(',') === 'Allosaurus,Ceratosaurus',
    JSON.stringify(data.stored));
  check('the avatar is carried through', data.avatarUrl === 'https://cdn/avatar.png');
  check('skins are listed', data.skins.includes('riverbed'));

  db.close();
}

{
  // The game server being down must not take the whole profile with it, and
  // must not read as an empty vault either.
  const db = fresh();
  const ctx = { db, mod: { run: async () => { throw new Error('unreachable'); } } };

  const data = await gatherProfile(ctx, '123456789012345678', ME);
  check('an unreachable server leaves storage unknown', data.stored === null,
    String(data.stored));
  check('and the rest still loads', data.points === 0 && data.kills === 0);

  const embed = buildProfileEmbed(data);
  const storage = fieldNamed(embed, 'Storage');
  check('and the embed says so rather than showing zero',
    storage.value.includes('did not answer') && !storage.value.includes('0 of'),
    storage.value);

  db.close();
}

// ---- standing, medals, ordinals ---------------------------------------------

{
  check('ordinals read the way people say them',
    ordinal(1) === '1st' && ordinal(2) === '2nd' && ordinal(3) === '3rd' && ordinal(4) === '4th',
    [1, 2, 3, 4].map(ordinal).join(' '));
  // The teens are the case every naive implementation gets wrong.
  check('and the teens are not 11st, 12nd, 13rd',
    ordinal(11) === '11th' && ordinal(12) === '12th' && ordinal(13) === '13th',
    [11, 12, 13].map(ordinal).join(' '));
  check('21st comes back round', ordinal(21) === '21st', ordinal(21));

  check('the top three get medals',
    medalFor(1) === '\u{1F947}' && medalFor(2) === '\u{1F948}' && medalFor(3) === '\u{1F949}');
  check('and everybody else gets the plain badge', medalFor(4) === medalFor(30));
  check('gold is only for first', colourFor(1) !== colourFor(2) && colourFor(4) === colourFor(30));
}

{
  const base = {
    name: 'Shadow', steamId: ME, points: 12261, rank: 4, players: 30,
    above: 13000, below: 9000, minutes: 1620, kills: 5, deaths: 36,
    skins: [], stored: [], maxSlots: 3, firstSeen: null, referrals: 0,
  };

  check('a chaser is told what to catch',
    standing(base).includes('4th of 30') && standing(base).includes('behind 3rd'),
    standing(base));
  // Matching the person above is not passing them.
  check('and the gap is enough to actually pass',
    standing({ ...base, points: 12999 }).includes('2 behind'),
    standing({ ...base, points: 12999 }));

  const leader = { ...base, rank: 1, above: null, below: 9000 };
  check('a leader is told what they are defending',
    standing(leader).includes('Top of 30') && standing(leader).includes('leading by 3,261'),
    standing(leader));

  check('one player alone is not ranked against nobody',
    standing({ ...base, rank: 1, players: 1, above: null, below: null }).includes('only one'),
    standing({ ...base, rank: 1, players: 1, above: null, below: null }));
}

// ---- the embed --------------------------------------------------------------

{
  const embed = buildProfileEmbed({
    name: 'Shadow',
    steamId: ME,
    avatarUrl: 'https://cdn/avatar.png',
    points: 12261,
    rank: 1,
    players: 30,
    above: null,
    below: 9000,
    minutes: 1620,
    kills: 5,
    deaths: 36,
    skins: ['Albino'],
    stored: [
      { slot: 'allo', species: 'Allosaurus' },
      { slot: 'cera', species: 'Ceratosaurus' },
      { slot: 'rex', species: 'Tyrannosaurus' },
    ],
    maxSlots: 3,
    firstSeen: '2026-08-23T10:00:00.000Z',
    referrals: 2,
  });

  check('the leader is crowned in the title', embed.data.title.includes('\u{1F947}'),
    embed.data.title);
  check('and named', embed.data.title.includes('Shadow'));
  check('the avatar is the thumbnail', embed.data.thumbnail?.url === 'https://cdn/avatar.png');
  check('gold for first', embed.data.color === 0xd6a03a, String(embed.data.color));

  const points = fieldNamed(embed, 'Points');
  check('points are grouped for reading', points.value.includes('12,261'), points.value);
  check('and carry the standing', points.value.includes('Top of 30'), points.value);

  // The whole point of the rewrite: what is in the vault, not how much.
  const storage = fieldNamed(embed, 'Storage');
  check('storage names the animals',
    storage.value.includes('Allosaurus') && storage.value.includes('Tyrannosaurus'),
    storage.value);
  check('and shows the slots filled', storage.value.includes('▰▰▰'), storage.value);
  check('referrals are mentioned', /brought \*\*2\*\* players/.test(embed.data.description),
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
    above: null,
    below: null,
    minutes: 0,
    kills: 0,
    deaths: 0,
    skins: [],
    stored: [],
    maxSlots: 3,
    firstSeen: null,
    referrals: 0,
  });

  check('a nameless account still has a title',
    typeof embed.data.title === 'string' && embed.data.title.length > 0, embed.data.title);
  check('and a description rather than an empty line',
    typeof embed.data.description === 'string' && embed.data.description.length > 0,
    embed.data.description);
  check('no avatar means no thumbnail', embed.data.thumbnail === undefined);
  check('no skins means no skins field', fieldNamed(embed, 'Skins') === undefined);

  const storage = fieldNamed(embed, 'Storage');
  check('an empty vault says empty, not unknown',
    storage.value.includes('empty') && !storage.value.includes('did not answer'),
    storage.value);
  check('and shows three unfilled slots', storage.value.includes('▱▱▱'),
    storage.value);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
