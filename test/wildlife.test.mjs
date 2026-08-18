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

// Every row must carry a pawn path, a controller path, and the borrowed flag.
{
  const complete = block.split(/\r?\n/).filter((line) => {
    const m = /^ {4}\w+\s*=\s*\{(.*)\},\s*$/.exec(line);
    if (!m) return false;
    const parts = m[1].split(',').map((s) => s.trim());
    return parts.length >= 3
      && parts[0].includes('BP_')
      && (parts[1].includes('BP_AI_') || parts[1].includes('/Script/'))
      && /^(true|false)$/.test(parts[parts.length - 1]);
  }).length;
  check('every species has a pawn path, a controller and a borrowed flag',
    complete === inMod.length, `${complete} complete of ${inMod.length}`);
}
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
  // The table now says so outright rather than being guessed from the name.
  const borrowed = new Set();
  for (const m of block.matchAll(/^    (\w+)\s*=\s*\{.*?,\s*(true|false)\s*\},/gm)) {
    if (m[2] === 'true') borrowed.add(m[1]);
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

// The find that made the AI work at all: the game runs its own AI on the
// BP_AI_* Blueprint controllers. The /Script/TheIsle.TIAI* classes are bare
// C++ bases - they pathfind and never attack, which is why a spawned
// Ceratosaurus would chase a player and then stand there.
{
  // Classified per line: a row is a C++ base if its controller path mentions
  // /Script at all. The Blueprint rows build their path by concatenation, so
  // one regex over the whole entry picks the wrong quoted fragment.
  const rows = [];
  for (const line of block.split(/\r?\n/)) {
    const m = /^ {4}(\w+)\s*=\s*\{(.*)\},\s*$/.exec(line);
    if (!m) continue;
    rows.push({
      name: m[1],
      scripted: m[2].includes('/Script/'),
      borrowed: /,\s*true\s*$/.test(m[2]),
    });
  }
  const scripted = rows.filter((r) => r.scripted);

  check('most species now use a Blueprint controller',
    rows.length - scripted.length > scripted.length,
    `${rows.length - scripted.length} blueprint vs ${scripted.length} C++ base`);
  check('every bare C++ controller is marked borrowed, since it cannot fight',
    scripted.every((r) => r.borrowed), scripted.filter((r) => !r.borrowed).map((r) => r.name).join(','));

  // Prey now run the C++ base ON PURPOSE — it is the only brain that shakes a
  // raptor off. What matters is that each ambient species has whichever brain
  // its role actually needs.
  const evade = new Set(
    [...code.matchAll(/^ {4}(\w+)\s*=\s*"\/Script\/TheIsle\.\w+",$/gm)].map((m) => m[1]));
  const predators = new Set(
    [...code.slice(code.indexOf('local AI_PREDATORS'), code.indexOf('local function brainChoice'))
      .matchAll(/(\w+) = true/g)].map((m) => m[1]));

  const mix = code.slice(code.indexOf('local AMBIENT_MIX'), code.indexOf('local AMBIENT_GROWTH'));
  const used = [...new Set([...mix.matchAll(/"(\w+)"/g)].map((m) => m[1]))];

  check('the escaping brains are catalogued', evade.size > 15, String(evade.size));
  // Deer is Blueprint-only on this build: upstream documents no C++ base for
  // it, so it cannot be given the escaping brain. Pinned rather than waved
  // away, so the list failing to shrink or quietly growing both show up.
  const stuck = used.filter((n) => !predators.has(n) && !evade.has(n)).sort();
  check('the only ambient prey that cannot escape a pounce is Deer',
    stuck.join(',') === 'Deer', stuck.join(',') || 'none');
  check('ambient predators keep a brain that can attack',
    used.filter((n) => predators.has(n)).every((n) => !scripted.some((r) => r.name === n)),
    used.filter((n) => predators.has(n)).join(','));
}

// The trade between the two brains, and that the default follows the role.
{
  const picks = (code.match(/StaticFindObject\(controllerFor\(species\)\)/g) ?? []).length;
  check('both spawn paths choose a brain rather than hardcoding one', picks === 2, String(picks));
  check('predators default to attacking, everything else to escaping',
    /AI_PREDATORS\[species\] and "attack" or "evade"/.test(code));
  check('an override is per species and survives a reload',
    /ambient\.brains\[species\] = want/.test(code) && /parsed\.brains/.test(code));
  check('a species with no escaping brain cannot be set to evade',
    /AI_EVADE_CTRL\[species\] == nil/.test(code));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
