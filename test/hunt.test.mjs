// The hunt. One player is the quarry; kill them to win, keep them alive and
// nobody does. The rules that matter are who gets paid and who does not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  huntStep, claimHunt, saveHunt, activeHunt, markRevealed,
  buildHuntEmbed, huntAnnounce, revealAnnounce, survivedAnnounce,
} = await load('hunt.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const MINUTE = 60_000;
const NOW = 1_800_000_000_000;
const TARGET = '76561198000000001';
const HUNTER = '76561198000000002';

const base = (over = {}) => ({
  targetSteam: TARGET, targetName: 'Shadow', reward: 1500,
  endsAt: NOW + (20 * MINUTE), revealEveryMs: 3 * MINUTE,
  lastRevealAt: NOW, startedAt: NOW, ...over,
});

const at = (steam, x, y, species = 'Rex') =>
  ({ steam, species, growth: 1, female: false, prime: false, x, y });

// ---- calling out the position ----------------------------------------------

{
  const h = base();
  check('nothing is said before the first interval',
    huntStep(h, [at(TARGET, 1000, 2000)], NOW + MINUTE).kind === 'waiting');

  const due = huntStep(h, [at(TARGET, 1000, 2000)], NOW + (3 * MINUTE));
  check('then the position goes out', due.kind === 'reveal');
  check('and it is where they actually are',
    due.kind === 'reveal' && due.x === 1000 && due.y === 2000);

  // Without it, a callout sends people to a spot to hunt whatever they find.
  const asAllo = huntStep(h, [at(TARGET, 1000, 2000, 'Allosaurus')], NOW + (3 * MINUTE));
  check('and says what they are playing',
    asAllo.kind === 'reveal' && asAllo.species === 'Allosaurus');
}

{
  // Announcing a position from ten minutes ago as though it were current would
  // send everybody to the wrong place.
  const h = base();
  check('an offline target is not located',
    huntStep(h, [], NOW + (3 * MINUTE)).kind === 'waiting');
  check('nor is one the mod cannot place',
    huntStep(h, [{ steam: TARGET, species: 'Rex', growth: 1, female: false, prime: false }],
      NOW + (3 * MINUTE)).kind === 'waiting');
}

{
  const h = base();
  check('when the time is up they have survived',
    huntStep(h, [at(TARGET, 1, 1)], NOW + (21 * MINUTE)).kind === 'survived');
  check('and that beats a due position call',
    huntStep({ ...h, lastRevealAt: NOW - (10 * MINUTE) }, [at(TARGET, 1, 1)],
      NOW + (21 * MINUTE)).kind === 'survived');
}

// ---- paying out ---------------------------------------------------------------

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt.sqlite'));
  const ctx = { db };
  db.savePreset('Trophy', { colours: { BodyColor: '#AA0000' } }, 'staff');

  saveHunt(ctx, base({ skin: 'Trophy' }));

  check('killing somebody else does not end it',
    claimHunt(ctx, HUNTER, '76561198000000009') === null);
  check('and the hunt is still running', activeHunt(ctx) !== null);

  const won = claimHunt(ctx, HUNTER, TARGET);
  check('killing the target ends it', won !== null);
  check('the killer is paid', db.pointsFor(HUNTER).balance === 1500,
    String(db.pointsFor(HUNTER).balance));
  check('and gets the skin', db.ownsSkin(HUNTER, 'Trophy'));
  check('the hunt is cleared', activeHunt(ctx) === null);
  check('so a second kill pays nothing', claimHunt(ctx, HUNTER, TARGET) === null);

  db.close();
}

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt2.sqlite'));
  const ctx = { db };

  // Bleeding out, drowning and wildlife all arrive with no killer. Awarding
  // those to whoever was nearest would be guessing at a winner.
  saveHunt(ctx, base());
  check('a death with no killer pays nobody', claimHunt(ctx, '', TARGET) === null);
  check('and it ends rather than running on', activeHunt(ctx) === null);

  // Slaying yourself out of a hunt should not pay you either.
  saveHunt(ctx, base());
  check('the target killing themselves pays nobody',
    claimHunt(ctx, TARGET, TARGET) === null);
  check('and that ends it too', activeHunt(ctx) === null);
  check('nothing was paid', db.pointsFor(TARGET).balance === 0);

  db.close();
}

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt3.sqlite'));
  const ctx = { db };
  const h = base();
  saveHunt(ctx, h);

  // Marked before announcing, so a failed announcement is not retried every
  // poll for the rest of the hunt.
  markRevealed(ctx, h, NOW + (3 * MINUTE));
  check('a reveal moves the timer on',
    activeHunt(ctx).lastRevealAt === NOW + (3 * MINUTE));
  check('and nothing else about the hunt changed',
    activeHunt(ctx).targetSteam === TARGET && activeHunt(ctx).reward === 1500);

  db.close();
}

// ---- what people are told ------------------------------------------------------

{
  const h = base();
  for (const [what, line] of [
    ['the opening call', huntAnnounce(h)],
    ['a position call', revealAnnounce(h, 120_000, -317_000, 'Allosaurus')],
    ['the survival call', survivedAnnounce(h)],
  ]) {
    check(`${what} is plain ASCII`, /^[\x20-\x7E]*$/.test(line), line);
  }

  check('a position call gives coordinates',
    revealAnnounce(h, 120_000, -317_000, 'Allosaurus').includes('Lat -317'));
  check('and names the dinosaur they are on',
    revealAnnounce(h, 120_000, -317_000, 'Allosaurus').includes('Allosaurus'));
  check('an unknown species does not leave a dangling word',
    revealAnnounce(h, 120_000, -317_000, '').endsWith('.'),
    revealAnnounce(h, 120_000, -317_000, ''));
  check('the target is named, not their Steam ID',
    huntAnnounce(h).includes('Shadow') && !huntAnnounce(h).includes(TARGET));

  // Asked for twice: a callout with no species sends people to a spot to hunt
  // whatever they find there.
  const known = base({ targetSpecies: 'Allosaurus' });
  check('the opening call names the dinosaur too',
    huntAnnounce(known).includes('Allosaurus'), huntAnnounce(known));
  check('and it stays ASCII', /^[ -~]*$/.test(huntAnnounce(known)));
  check('a target nobody has seen yet reads cleanly',
    !/\(\)/.test(huntAnnounce(h)), huntAnnounce(h));
  check('the running panel names it',
    /Allosaurus/.test(buildHuntEmbed(known, 'running').toJSON().description ?? ''));

  const survived = buildHuntEmbed(h, 'survived').toJSON();
  check('surviving explains why nobody won',
    /player kill/.test(survived.description ?? ''), survived.description);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
