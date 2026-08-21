// Population events. The rule that matters: an event pays for the thing that
// FIXES the imbalance. Culling pays the killer; endangered pays for surviving,
// because paying an endangered species to fight would get the last few killed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);
const ev = await import(pathToFileURL(path.join(root, 'dist/events.js')).href);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const caps = [
  { species: 'Tyrannosaurus', cap: 5 },
  { species: 'Dryosaurus', cap: 20 },
  { species: 'Carnotaurus', cap: 12 },
];
const counts = (obj) => new Map(Object.entries(obj));
const kinds = (list) => list.map((e) => `${e.species}:${e.kind}`).sort().join(',');

// ---- which events are running --------------------------------------------

check('a species at its cap is a cull',
  kinds(ev.eventsFor(caps, counts({ Tyrannosaurus: 5 }))) === 'Tyrannosaurus:cull');
check('over the cap is still a cull',
  kinds(ev.eventsFor(caps, counts({ Tyrannosaurus: 9 }))) === 'Tyrannosaurus:cull');
check('comfortably under the cap is no event',
  ev.eventsFor(caps, counts({ Tyrannosaurus: 3 })).length === 0);

check('down to the last few is endangered',
  kinds(ev.eventsFor(caps, counts({ Dryosaurus: 1 }))) === 'Dryosaurus:rare');
check('exactly at the rare threshold counts',
  kinds(ev.eventsFor(caps, counts({ Dryosaurus: ev.RARE_AT }))) === 'Dryosaurus:rare');
check('one above the threshold does not',
  ev.eventsFor(caps, counts({ Dryosaurus: ev.RARE_AT + 1 })).length === 0);

// The one that would otherwise fire constantly on a quiet server.
check('nobody playing it is NOT endangered, it is just unpopular',
  ev.eventsFor(caps, counts({ Dryosaurus: 0 })).length === 0);
check('an empty server runs no events at all',
  ev.eventsFor(caps, counts({})).length === 0);

check('a species with no cap is never in an event',
  ev.eventsFor(caps, counts({ Stegosaurus: 1 })).length === 0);
check('a zero cap is ignored rather than permanently culling',
  ev.eventsFor([{ species: 'Ghost', cap: 0 }], counts({ Ghost: 4 })).length === 0);

{
  const both = ev.eventsFor(caps, counts({ Tyrannosaurus: 5, Dryosaurus: 1 }));
  check('several species can be in events at once',
    kinds(both) === 'Dryosaurus:rare,Tyrannosaurus:cull', kinds(both));
  check('a species is never in both at once',
    new Set(both.map((e) => e.species)).size === both.length);
}

// ---- what they pay --------------------------------------------------------

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'ev.sqlite');
const db = new Database(file);
const ctx = { db };

check('events are off until someone turns them on', ev.eventSettings(ctx).enabled === false);
check('nothing multiplies while they are off',
  ev.killMultiplier(ctx, 'Tyrannosaurus') === 1 && ev.playMultiplier(ctx, 'Dryosaurus') === 1);

ev.setEventsEnabled(ctx, true);
db.setSetting('events_active', 'Tyrannosaurus:cull,Dryosaurus:rare');

check('killing a culled species pays more',
  ev.killMultiplier(ctx, 'Tyrannosaurus') === ev.DEFAULT_CULL_BONUS);
check('playing an endangered species pays more',
  ev.playMultiplier(ctx, 'Dryosaurus') === ev.DEFAULT_RARE_BONUS);

// The direction of each bonus is the whole design.
check('a cull does NOT pay you for playing the overpopulated species',
  ev.playMultiplier(ctx, 'Tyrannosaurus') === 1);
check('endangered does NOT pay you for killing the last few',
  ev.killMultiplier(ctx, 'Dryosaurus') === 1);
check('a species in no event pays normally',
  ev.killMultiplier(ctx, 'Carnotaurus') === 1 && ev.playMultiplier(ctx, 'Carnotaurus') === 1);

ev.setCullBonus(ctx, 3);
ev.setRareBonus(ctx, 1.5);
check('the bonuses can be tuned',
  ev.killMultiplier(ctx, 'Tyrannosaurus') === 3 && ev.playMultiplier(ctx, 'Dryosaurus') === 1.5);

ev.setEventsEnabled(ctx, false);
check('turning events off stops every multiplier',
  ev.killMultiplier(ctx, 'Tyrannosaurus') === 1 && ev.playMultiplier(ctx, 'Dryosaurus') === 1);

// ---- the announcements ----------------------------------------------------

{
  const cull = { species: 'Tyrannosaurus', kind: 'cull', count: 6, cap: 5 };
  const rare = { species: 'Dryosaurus', kind: 'rare', count: 1, cap: 20 };

  check('a cull notice gives the numbers', /6\/5/.test(ev.eventAnnounce(cull, 2)));
  check('and says what the reward is', /2x/.test(ev.eventAnnounce(cull, 2)));
  check('an endangered notice says how few are left', /only 1 /.test(ev.eventAnnounce(rare, 2)));
  check('the end of an event is announced too',
    /back under its limit/.test(ev.overAnnounce('Tyrannosaurus', 'cull'))
    && /recovered/.test(ev.overAnnounce('Dryosaurus', 'rare')));
  check('in-game lines are plain ASCII, like every other one',
    [ev.eventAnnounce(cull, 2), ev.eventAnnounce(rare, 2),
      ev.overAnnounce('Rex', 'cull'), ev.overAnnounce('Rex', 'rare')]
      .every((line) => /^[\x20-\x7E]*$/.test(line)));

  const embeds = [ev.buildEventEmbed(cull, 2), ev.buildEventEmbed(rare, 2),
    ev.buildEventOverEmbed('Rex', 'cull')].map((e) => e.toJSON());
  check('the embeds stay within Discord limits',
    embeds.every((e) => (e.description ?? '').length < 4096 && (e.title ?? '').length < 256));
  check('cull and endangered are coloured differently',
    embeds[0].color !== embeds[1].color);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

// The personal notice. It goes through the mod as ClientShowNotification: the
// only per-player channel that is legible. announce is server-wide, and
// directmessage draws a banner over the game's own ANNOUNCEMENT label -
// verified live 2026-08-21, and it was unreadable.
{
  const msg = ev.personalMessage('Ceratosaurus', 2);

  check('it names the species', /Ceratosaurus/.test(msg), msg);
  check('it says it is endangered', /Endangered/.test(msg));
  check('it says what they earn', /2x/.test(msg));
  check('it says what earns it - staying alive, not killing',
    /stay alive/.test(msg) && !/kill/i.test(msg));
  check('it is plain ASCII, like every in-game line', /^[ -~]*$/.test(msg));

  // One line on the HUD, and the mod truncates at 120. A message that gets cut
  // in half is worse than a shorter one.
  check('it fits on screen without being truncated', msg.length <= 120,
    `${msg.length} characters`);
}

// Endangered needs a crowd to be scarce within. Reported live: playing alone
// made the only player permanently endangered.
{
  const quiet = ev.eventsFor(caps, counts({ Dryosaurus: 1 }), 1, 10);
  check('one person alone is not an endangered species', quiet.length === 0,
    kinds(quiet));

  const busy = ev.eventsFor(caps, counts({ Dryosaurus: 1 }), 30, 10);
  check('the same count on a busy server is', kinds(busy) === 'Dryosaurus:rare');

  check('exactly at the threshold counts',
    ev.eventsFor(caps, counts({ Dryosaurus: 1 }), 10, 10).length === 1);
  check('one below does not',
    ev.eventsFor(caps, counts({ Dryosaurus: 1 }), 9, 10).length === 0);

  // Culling is unaffected: being over a cap already implies the players exist.
  check('a cull still fires on a quiet server',
    kinds(ev.eventsFor(caps, counts({ Tyrannosaurus: 6 }), 1, 10)) === 'Tyrannosaurus:cull');

  check('the default threshold is a real crowd', ev.DEFAULT_MIN_PLAYERS === 10,
    String(ev.DEFAULT_MIN_PLAYERS));
}


// Which events reach the whole server. Reported live: an endangered event put a
// full-width ANNOUNCEMENT banner in front of everyone, on top of the on-screen
// notice the one affected player already had.
{
  const source = fs.readFileSync(path.join(root, 'src/events.ts'), 'utf8');
  const body = source.slice(source.indexOf('for (const event of started)'),
    source.indexOf('export', source.indexOf('for (const event of started)')));

  check('starting an event is announced only for a cull',
    /if \(event\.kind === 'cull'\) \{\s*await ctx\.rcon\.announce/.test(body), '');
  check('and the end likewise', /if \(kind === 'cull'\) \{\s*await ctx\.rcon\.announce/.test(body));
  check('the Discord embed still goes out for both',
    (body.match(/await send\(/g) ?? []).length === 2,
    String((body.match(/await send\(/g) ?? []).length));
  check('the announce text itself is still there for culls',
    typeof ev.eventAnnounce === 'function' && typeof ev.overAnnounce === 'function');
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
