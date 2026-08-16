// Population tallying, especially the per-species adult thresholds — a single
// global threshold would misreport most of the roster, and the numbers would
// just be quietly wrong rather than visibly broken.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { tally, isAdult, adultThreshold, buildPopulationEmbed } = await import(
  pathToFileURL(path.join(root, 'dist/population.js')).href
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const dino = (species, growth, female = false, prime = false) => ({ species, growth, female, prime });

check('big species mature at 50%', adultThreshold('Tyrannosaurus') === 0.5);
check('everything else matures at 75%', adultThreshold('Dryosaurus') === 0.75);
check('an unknown species falls back to 75%', adultThreshold('Fictionosaurus') === 0.75);

check('a 60% Rex is an adult', isAdult('Tyrannosaurus', 0.6) === true);
check('a 60% Dryo is NOT an adult', isAdult('Dryosaurus', 0.6) === false);
check('an 80% Dryo is an adult', isAdult('Dryosaurus', 0.8) === true);

{
  const rows = tally([
    dino('Tyrannosaurus', 1.0, false, true),
    dino('Tyrannosaurus', 0.6, true),
    dino('Tyrannosaurus', 0.3),
    dino('Dryosaurus', 0.6, true),
    dino('Dryosaurus', 0.9, false, true),
  ]);

  const rex = rows.find((r) => r.species === 'Tyrannosaurus');
  const dryo = rows.find((r) => r.species === 'Dryosaurus');

  check('sorted by headcount', rows[0].species === 'Tyrannosaurus');
  check('counts everyone online', rex.online === 3);
  check('rex adults use the 50% rule', rex.adults === 2, `got ${rex.adults}`);
  check('dryo adults use the 75% rule', dryo.adults === 1, `got ${dryo.adults}`);
  check('gender split is exact', rex.males === 2 && rex.females === 1);
  check('prime counted only among adults', rex.prime === 1 && dryo.prime === 1);
}

{
  // Contradictory data: prime must never exceed the adult count.
  const rows = tally([dino('Dryosaurus', 0.1, false, true)]);
  check('a prime juvenile does not inflate prime',
    rows[0].prime === 0 && rows[0].adults === 0,
    `prime=${rows[0].prime} adults=${rows[0].adults}`);
}

{
  // The panel is always on screen, so every state has to render something.
  const empty = buildPopulationEmbed([]).toJSON();
  check('empty server renders a message, not a crash', /Nobody is playing/.test(empty.description ?? ''));

  const down = buildPopulationEmbed([], { unreachable: true }).toJSON();
  check('an unreachable server still renders', /not responding/.test(down.description ?? ''));

  const live = buildPopulationEmbed([], { live: true }).toJSON();
  check('the live panel says it refreshes', /refreshes every minute/.test(live.description ?? ''));
  check('the timestamp is in the description, where Discord renders it',
    /<t:\d+:R>/.test(live.description ?? ''));
}

{
  const busy = buildPopulationEmbed(
    Array.from({ length: 40 }, (_, n) => dino(`Species${n}`, 0.9)),
  ).toJSON();

  check('stays under the 4096 char description limit', (busy.description ?? '').length < 4096,
    `${(busy.description ?? '').length} chars`);
  check('stays under the 6000 char embed limit', JSON.stringify(busy).length < 6000,
    `${JSON.stringify(busy).length} chars`);
  check('says how many species were hidden', /more species/.test(busy.description ?? ''));

  // Long names must not break the column alignment.
  const wide = buildPopulationEmbed([dino('Pachycephalosaurus', 0.9), dino('Dryosaurus', 0.9)])
    .toJSON();
  const lines = (wide.description ?? '').split('\n').filter((l) => /[█░]/.test(l));
  check('every table row is the same width',
    lines.length === 2 && lines[0].length === lines[1].length,
    lines.map((l) => l.length).join(' vs '));
  check('an over-long species name is truncated, not wrapped',
    /Pachycephalosa…/.test(wide.description ?? ''));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
