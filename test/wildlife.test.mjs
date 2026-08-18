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
const block = lua.slice(lua.indexOf('local AI_PAIRS = {'), lua.indexOf('local MAX_AI_PER_CALL'));
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

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
