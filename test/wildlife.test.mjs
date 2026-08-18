// The AI species list exists in two places: the pair table in the mod, and the
// names in the bot. If they drift, the bot offers a species the mod refuses.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { ALL_AI_SPECIES, AI_SPECIES, isSpawnableAI } =
  await import(pathToFileURL(path.join(root, 'dist/wildlife.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const lua = fs.readFileSync(
  path.join(root, 'mod/DinoStorage/Scripts/main.lua'), 'utf8');

// The table entries look like:  Tyrannosaurus  = { AI_ROOT .. "..." , "..." },
const pairsStart = lua.indexOf('local AI_PAIRS = {');
// End at the table's own closing brace, not at whatever happens to follow it.
const block = lua.slice(pairsStart, lua.indexOf('\n}', pairsStart) + 2);
const inMod = [...block.matchAll(/^\s{4}(\w+)\s*=\s*\{/gm)].map((m) => m[1]).sort();

check('the mod defines a pair table', inMod.length > 0, `${inMod.length} species`);
check('the bot lists exactly what the mod can spawn',
  inMod.join(',') === [...ALL_AI_SPECIES].sort().join(','),
  `mod ${inMod.length} vs bot ${ALL_AI_SPECIES.length}`);

const missing = inMod.filter((s) => !ALL_AI_SPECIES.includes(s));
const extra = ALL_AI_SPECIES.filter((s) => !inMod.includes(s));
check('nothing the mod supports is hidden from admins', missing.length === 0, missing.join(','));
check('nothing is offered that the mod would refuse', extra.length === 0, extra.join(','));

check('every species has a class path and a controller path',
  (block.match(/=\s*\{[^}]*,[^}]*\}/g) ?? []).length === inMod.length);
check('no species appears twice', new Set(inMod).size === inMod.length);

// The grouping is only for display, but a species in none of them would be
// spawnable and invisible in /admin ai list.
const grouped = [...AI_SPECIES.predators, ...AI_SPECIES.prey, ...AI_SPECIES.animals];
check('every species appears in exactly one group',
  grouped.length === ALL_AI_SPECIES.length && new Set(grouped).size === grouped.length,
  `${grouped.length} grouped vs ${ALL_AI_SPECIES.length} total`);

check('a known species is spawnable', isSpawnableAI('Tyrannosaurus'));
check('an unknown one is not', !isSpawnableAI('Ghostosaurus'));
check('matching is exact, not fuzzy', !isSpawnableAI('tyrannosaurus'));

// Guard the safety rules that cost a server before. Comments naming them are
// the point, so only executable lines count.
const code = lua.split(/\r?\n/).filter((l) => !/^\s*--/.test(l)).join('\n');
check('the mod never destroys AI actors', !/K2_DestroyActor/.test(code));
check('AI is never marked always-relevant', !/bAlwaysRelevant/.test(code));
check('and both rules are written down where the code is',
  /K2_DestroyActor/.test(lua) && /bAlwaysRelevant/.test(lua));

// And the notification rule.
check('notifications go through FText, never a raw string',
  /ClientShowNotification\(text\)/.test(lua) && /local function makeText/.test(lua));
check('the controller is resolved fresh for a notification',
  /resolveController\(cmd\.steam\)/.test(lua));

// ---- ambient wildlife ------------------------------------------------------
// The dangerous parts are: holding pawn pointers across ticks, destroying
// actors, and despawning something a player is chasing. Each is asserted.

check('the ambient registry keys on an address, not a pawn wrapper',
  /ambientOwned\[addr\]\s*=\s*\{/.test(code));
check('live pawns are re-derived each sweep rather than cached',
  /local function ambientLive/.test(code) && /FindAllOf/.test(code));
check('FindAllOf is nil-guarded, since it is not on every UE4SS build',
  /if FindAllOf == nil then return/.test(code));

check('despawn is a kill, never a destroy',
  /SetHealth\(0\)/.test(code) && !/DestroyActor/.test(code));
check('something recently hurt is never despawned',
  /hunted/.test(code) && /HUNT_GRACE_SEC/.test(code));
check('nothing is despawned before it has had time to matter',
  /MIN_AGE_SEC/.test(code));
check('only things far from every player are despawned',
  /nearest > KEEP_RADIUS/.test(code));
check('an empty server is left alone rather than culled',
  /if #spots == 0 then return end/.test(code));

check('the damage hook stamps ambient AI by address',
  /aiHurt\[addr\] = os\.time\(\)/.test(code));
check('and only for wildlife we actually own',
  /ambientOwned\[addr\] ~= nil/.test(code));

check('ambient is off until someone turns it on',
  /enabled = false/.test(code));
check('the ambient mix only names species with a verified brain', (() => {
  const mix = code.slice(code.indexOf('local AMBIENT_MIX'), code.indexOf('local function ambientCount'));
  const names = [...mix.matchAll(/"(\w+)"/g)].map((m) => m[1]);
  return names.length > 0 && names.every((n) => ALL_AI_SPECIES.includes(n));
})());
check('the server-wide command does not demand a steam id',
  /verb ~= "ambient"/.test(code));

check('spawned AI gets stamina, or it cannot sustain a chase',
  /SetStamina\(ai:GetMaxStamina\(\)\)/.test(code)
  && /SetStamina\(pawn:GetMaxStamina\(\)\)/.test(code));
check('hunger uses the setter this build actually has',
  /SetHunger/.test(code) && !/:SetFood\(/.test(code));
check('AI that never moves is culled and retried elsewhere',
  /STUCK_GRACE_SEC/.test(code) && /movedAt/.test(code));
check('but something being hunted is never culled as stuck',
  /aiHurt\[entry\.addr\] == nil/.test(code));

// The ambient population runs unsupervised, so it may only contain species
// that drive their own body. A borrowed brain is fine for a deliberate admin
// spawn and wrong for wildlife nobody is watching.
{
  const pairs = block;
  const borrowed = new Set();
  for (const m of pairs.matchAll(/^    (\w+)\s*=\s*\{[^}]*?,\s*(.+?)\s*\},/gm)) {
    const name = m[1];
    const ctrl = m[2].toLowerCase().replace('rex', 'tyrannosaurus');
    if (!ctrl.includes(name.toLowerCase())) borrowed.add(name);
  }
  const mix = code.slice(code.indexOf('local AMBIENT_MIX'), code.indexOf('local AMBIENT_GROWTH'));
  const used = [...new Set([...mix.matchAll(/"(\w+)"/g)].map((m) => m[1]))];

  check('some species do borrow another brain', borrowed.size > 0, [...borrowed].join(','));
  check('none of them are in the unsupervised population',
    used.every((n) => !borrowed.has(n)), used.filter((n) => borrowed.has(n)).join(','));
  check('no apex is spawned as ambient wildlife',
    !used.some((n) => ['Tyrannosaurus', 'Deinosuchus', 'Triceratops'].includes(n)),
    used.join(','));

  const growth = code.slice(code.indexOf('local AMBIENT_GROWTH'), code.indexOf('local function ambientCount'));
  const bands = [...growth.matchAll(/([01]\.\d+)/g)].map((m) => Number(m[1]));
  check('growth is varied, not all adults', new Set(bands).size > 3, bands.join(','));
  check('juveniles outnumber adults', bands.filter((g) => g < 0.6).length > bands.filter((g) => g >= 0.9).length,
    `${bands.filter((g) => g < 0.6).length} juvenile vs ${bands.filter((g) => g >= 0.9).length} adult`);
  check('every band is a legal growth value', bands.every((g) => g > 0 && g <= 1));
  check('ambient spawns use the bands rather than a fixed 1.0',
    /SetGrowth\(AMBIENT_GROWTH\[/.test(code));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
