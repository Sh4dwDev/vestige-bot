// The species and mutation pickers. Both lists come from the server, so the
// parsing has to survive the exact shapes it really sends.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { parsePlayables, suggest } = await import(
  pathToFileURL(path.join(root, 'dist/catalog.js')).href
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// Captured verbatim from the live server: a log line, then one comma-separated
// row with a trailing comma.
const REAL = '[2026.08.16-19.31.54] Playables\nAllosaurus,Austroraptor,Beipiaosaurus,' +
  'Carnotaurus,Ceratosaurus,Deinosuchus,Diabloceratops,Dilophosaurus,Dryosaurus,Gallimimus,' +
  'Herrerasaurus,Hypsilophodon,Kentrosaurus,Maiasaura,Omniraptor,Pachycephalosaurus,' +
  'Pteranodon,Stegosaurus,Tenontosaurus,Triceratops,Troodon,Tyrannosaurus,';

const species = parsePlayables(REAL);

check('reads every species', species.length === 22, String(species.length));
check('drops the log line', !species.some((s) => s.includes('Playables')), species.join(','));
check('drops the empty trailing entry', !species.includes(''));
check('keeps the real names', species.includes('Tyrannosaurus') && species.includes('Dryosaurus'));
check('is sorted', species.join(',') === [...species].sort((a, b) => a.localeCompare(b)).join(','));
check('an empty reply yields nothing rather than throwing', parsePlayables('').length === 0);

// ---- suggestions -------------------------------------------------------------

check('an empty query offers everything', suggest(species, '').length === 22);
check('matching is case insensitive', suggest(species, 'tyranno').includes('Tyrannosaurus'));

// People search for the distinctive word, not the first one.
check('matches in the middle of a name',
  suggest(['Efficient Digestion', 'Enhanced Digestion'], 'digestion').length === 2);

check('a miss returns nothing', suggest(species, 'zzzz').length === 0);

check('never exceeds the 25 Discord allows',
  suggest(Array.from({ length: 80 }, (_, n) => `Mutation ${n}`), '').length === 25);

check('whitespace is ignored', suggest(species, '  rex  ').length === 0 &&
  suggest(species, '  tyranno  ').length === 1);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
