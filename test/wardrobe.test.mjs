// Skins players own. A reward skin is a preset that has been granted, so most
// of the risk is in ownership: giving twice, taking back, and offering a skin
// whose preset has since been deleted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { buildPicker, buildWardrobePanel, wardrobeRows } = await load('wardrobe.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'wd.sqlite');
const db = new Database(file);
const ctx = { db };
const S = '76561198000000123';

db.savePreset('Winter', { colours: { BodyColor: '#FFFFFF' }, pattern: 1 }, 'staff');
db.savePreset('Ember', { colours: { BodyColor: '#FF4400' } }, 'staff');

// ---- owning ----------------------------------------------------------------

check('a fresh grant reports as new', db.grantSkin(S, 'Winter', 'Winter event') === true);
check('and they own it', db.ownsSkin(S, 'Winter'));
check('granting again is not a second copy', db.grantSkin(S, 'Winter', 'again') === false);
check('still exactly one owned', db.ownedSkins(S).length === 1);

check('somebody else does not get it by association', !db.ownsSkin('76561198000000999', 'Winter'));

db.grantSkin(S, 'Ember', '');
check('a second skin is kept alongside', db.ownedSkins(S).length === 2);
check('the reason is kept, so the panel can say why they have it',
  db.ownedSkins(S).find((o) => o.preset === 'Winter').source === 'Winter event');

check('owners can be listed for staff', db.skinOwners('Winter').includes(S));

check('revoking takes it back', db.revokeSkin(S, 'Winter') === true);
check('and it is gone', !db.ownsSkin(S, 'Winter'));
check('revoking what they never had is not an error', db.revokeSkin(S, 'Winter') === false);
check('their other skin is untouched', db.ownsSkin(S, 'Ember'));

// ---- the picker ------------------------------------------------------------

{
  const empty = buildPicker(ctx, '76561198000000888');
  check('somebody with nothing gets an explanation, not an empty menu',
    empty.rows.length === 0 && /not earned any/.test(empty.embed.toJSON().description ?? ''));
  check('and is told where the Early Member skins live',
    /Early Member/.test(empty.embed.toJSON().description ?? ''));
}

{
  const picker = buildPicker(ctx, S);
  const menu = picker.rows[0].toJSON().components[0];
  check('what they own is offered', menu.options.length === 1
    && menu.options[0].value === 'Ember', JSON.stringify(menu.options));
  check('the menu routes to wearing', menu.custom_id === 'wd:wear');
}

{
  // A preset can be deleted after being granted. Offering it would hand
  // somebody a skin that cannot be applied.
  db.grantSkin(S, 'Ghost', 'event');
  const picker = buildPicker(ctx, S);
  const values = picker.rows[0].toJSON().components[0].options.map((o) => o.value);
  check('a skin whose preset is gone is not offered', !values.includes('Ghost'),
    values.join(','));
  check('but the entitlement is still held, so rebuilding the preset restores it',
    db.ownsSkin(S, 'Ghost'));
}

{
  // Discord refuses a select with more than 25 options outright, so the panel
  // would simply fail to render rather than degrade.
  for (let n = 0; n < 30; n += 1) {
    db.savePreset(`Bulk ${n}`, { colours: { BodyColor: '#101010' } }, 'staff');
    db.grantSkin(S, `Bulk ${n}`, '');
  }
  const menu = buildPicker(ctx, S).rows[0].toJSON().components[0];
  check('a big collection is capped to what Discord allows',
    menu.options.length <= 25, String(menu.options.length));
  check('and the panel says it is showing a subset',
    /Showing the first/.test(buildPicker(ctx, S).embed.toJSON().description ?? ''));
}

// ---- the channel panel -----------------------------------------------------

{
  const panel = buildWardrobePanel().toJSON();
  check('the panel explains where skins come from',
    /events/.test(panel.description ?? ''));
  check('it fits Discord limits',
    JSON.stringify(panel).length < 6000
    && (panel.fields ?? []).every((f) => f.value.length < 1024));

  const rows = wardrobeRows().map((r) => r.toJSON());
  const ids = rows.flatMap((r) => r.components.map((c) => c.custom_id));
  check('there is a way to see your skins', ids.includes('wd:mine'));
  check('and a reset beside it', ids.includes('wd:reset'));
  check('and a way in for somebody not linked yet', ids.includes('hub:verify'));
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
