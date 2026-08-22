// Founder skins. The dangerous part is the claim: a limit that is checked and
// then written in two steps hands slot fifty-one to whoever clicks at the same
// moment as slot fifty.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);
const f = await import(pathToFileURL(path.join(root, 'dist/founders.js')).href);
const { hexToLinear, PARTS } = await import(pathToFileURL(path.join(root, 'dist/skins.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---- the skins themselves -------------------------------------------------

check('there are exactly three', f.FOUNDER_SKINS.length === 3, String(f.FOUNDER_SKINS.length));
check('each has a unique id', new Set(f.FOUNDER_SKINS.map((s) => s.id)).size === 3);
check('each has a unique name', new Set(f.FOUNDER_SKINS.map((s) => s.name)).size === 3);
check('every colour is valid hex',
  f.FOUNDER_SKINS.every((s) => Object.values(s.colours).every((hex) => hexToLinear(hex))));
check('every part named is a real one',
  f.FOUNDER_SKINS.every((s) => Object.keys(s.colours)
    .every((field) => PARTS.some((p) => p.field === field))));
check('each sets a body colour, which is what reads at distance',
  f.FOUNDER_SKINS.every((s) => s.colours.BodyColor));
check('each is deliberate enough to look designed',
  f.FOUNDER_SKINS.every((s) => Object.keys(s.colours).length >= 5));
check('patterns stay in the range every species is likely to have',
  f.FOUNDER_SKINS.every((s) => s.pattern >= 0 && s.pattern <= 3),
  f.FOUNDER_SKINS.map((s) => `${s.name}:${s.pattern}`).join(' '));
check('each has a blurb worth reading',
  f.FOUNDER_SKINS.every((s) => s.blurb.length > 20));
check('lookup by id works', f.skinById('firstlight')?.name === 'First Light');
check('an unknown id is not invented', f.skinById('nope') === undefined);

// ---- claiming -------------------------------------------------------------

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'f.sqlite');
const db = new Database(file);
const ctx = { db };

check('the default limit is fifty', f.founderLimit(ctx) === 50 && f.DEFAULT_LIMIT === 50);
check('nobody has claimed yet', db.founderCount() === 0);

check('a claim is taken', db.claimFounder('u1', 'firstlight', 3) === true);
check('and remembered', db.founderSkin('u1') === 'firstlight');
check('somebody else can claim the same skin', db.claimFounder('u2', 'firstlight', 3) === true);

// The point of the whole feature: one each, permanently.
check('the same person cannot claim twice', db.claimFounder('u1', 'deepwood', 3) === false);
check('and their first choice stands', db.founderSkin('u1') === 'firstlight');
check('the count is right', db.founderCount() === 2, String(db.founderCount()));

check('the third claim fills the limit', db.claimFounder('u3', 'oldscar', 3) === true);
check('the fourth is refused', db.claimFounder('u4', 'oldscar', 3) === false);
check('and nothing was written for them', db.founderSkin('u4') === null);
check('the count stops at the limit', db.founderCount() === 3);

// A limit lowered below what is already claimed must not delete anybody.
check('lowering the limit takes nothing away',
  db.claimFounder('u5', 'deepwood', 1) === false && db.founderCount() === 3);
check('everyone who claimed still has theirs',
  db.founderSkin('u1') && db.founderSkin('u2') && db.founderSkin('u3'));

{
  const list = db.founders(10);
  check('the list has everyone', list.length === 3);
  check('newest first', list[0].discordId === 'u3', list.map((e) => e.discordId).join(','));
  check('with what they picked', list[0].skin === 'oldscar');
}

check('staff can release a claim', db.releaseFounder('u3') === true);
check('which frees the slot', db.founderCount() === 2);
check('and lets somebody else in', db.claimFounder('u4', 'deepwood', 3) === true);
check('releasing nothing is not an error', db.releaseFounder('nobody') === false);

f.setFounderLimit(ctx, 100);
check('the limit can be raised', f.founderLimit(ctx) === 100);

// ---- the panel ------------------------------------------------------------
{
  const panel = f.buildFounderPanel(ctx).toJSON();
  // The panel used to count down unclaimed slots. Entitlement is the Early
  // Member role now, so the count lives on the role and the panel just says
  // who these are for - a number that could disagree with the role would be
  // the misleading half.
  check('the panel names the cap it is reserved for',
    (panel.description ?? '').includes('100'), (panel.description ?? '').slice(0, 60));
  check('and says the role is what unlocks them',
    /Early Member role/.test(panel.description ?? ''));
  check('all three are offered rather than one being claimed',
    /All three/.test(panel.description ?? ''));
  check('it lists all three skins',
    f.FOUNDER_SKINS.every((s) => (panel.fields ?? []).some((x) => x.name.includes(s.name))));
  check('it stays within Discord limits',
    (panel.description ?? '').length < 4096
    && (panel.fields ?? []).every((x) => x.value.length < 1024));

  const rows = f.founderRows(ctx).map((r) => r.toJSON());

  // One button per skin, and no separate apply. Claiming is gone: the Early
  // Member role is the entitlement, so a holder wears any of the three and can
  // change their mind. There is nothing left to disable at a limit either -
  // the cap is enforced when the role is handed out, not on the panel.
  check('there is a button per skin', rows[0].components.length === 3);
  check('and no claim-then-apply second step', rows.length === 1);
  check('every skin is reachable',
    f.FOUNDER_SKINS.every((s) => rows[0].components.some((c) => c.label === s.name)));
  check('none of them are disabled', rows[0].components.every((c) => !c.disabled));

  f.setFounderLimit(ctx, 1);
  check('and lowering the cap does not disable the panel',
    f.founderRows(ctx)[0].toJSON().components.every((c) => !c.disabled));
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
