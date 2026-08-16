// Mutation descriptions in the picker. The lookup has to survive the stock
// Game.ini's inconsistent spelling, and Discord's 100-character label cap.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { describeMutation, isRemoved, mutationChoices } = await import(
  pathToFileURL(path.join(root, 'dist/mutations.js')).href
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

check('describes a known mutation',
  /Health recovers/.test(describeMutation('Cellular Regeneration') ?? ''),
  describeMutation('Cellular Regeneration'));

// The stock config writes these three exactly like this.
check('matches the config’s lowercase spelling', describeMutation('Enlarged meniscus') !== null);
check('matches the missing hyphen', describeMutation('Hydroregenerative') !== null);
check('matches the hyphenated form too', describeMutation('Hydro-regenerative') !== null);

check('an unknown mutation has no description', describeMutation('Nonsense Gland') === null);

// Removed from the game but still listed in the stock config.
check('knows what was removed', isRemoved('Traumatic Thrombosis'));
check('a current mutation is not marked removed', !isRemoved('Hydrodynamic'));

{
  const all = ['Cellular Regeneration', 'Hydrodynamic', 'Traumatic Thrombosis', 'Nonsense Gland'];

  const labelled = mutationChoices(all, '');
  check('every choice carries its description',
    /Cellular Regeneration — Health recovers faster/.test(labelled[0]?.name ?? ''),
    labelled[0]?.name);
  check('the value stays the bare name, not the label',
    labelled.every((c) => all.includes(c.value)),
    labelled.map((c) => c.value).join(' | '));
  check('an undescribed one still appears',
    labelled.some((c) => c.value === 'Nonsense Gland'));

  // Searching what it does, not what it is called.
  check('searches the description', mutationChoices(all, 'swim')[0]?.value === 'Hydrodynamic',
    JSON.stringify(mutationChoices(all, 'swim')));
  check('searches the name too',
    mutationChoices(all, 'cellular')[0]?.value === 'Cellular Regeneration');

  // Removed ones sink rather than vanish — an admin hunting for one should be
  // told why it is not worth giving.
  check('removed ones sort last', labelled.at(-1)?.value === 'Traumatic Thrombosis',
    labelled.map((c) => c.value).join(' | '));
  check('removed ones are flagged in the label', /⚠️/.test(
    (labelled.find((c) => c.value === 'Traumatic Thrombosis')?.name ?? '')));

  check('never offers more than the 25 Discord allows',
    mutationChoices(Array.from({ length: 60 }, (_, n) => `Thing ${n}`), '').length === 25);

  const long = mutationChoices(['Increased Inspiratory Capacity'], '')[0]?.name ?? '';
  check('labels stay within the 100 char limit', long.length <= 100, `${long.length}`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
