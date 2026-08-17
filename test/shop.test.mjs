// The shop. This is the first feature that takes something from players, so the
// checks here are mostly about not charging for something that was not
// delivered, and not letting one offer be spent twice.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  priceOf, mutationPrice, totalPrice, setSpeciesPrice, setTierPrice,
  setPending, takePending, buildCatalogue, buildReceipt, MAX_SLOTS,
} = await load('shop.js');
const { setTier } = await load('tiers.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'shop.sqlite');
const db = new Database(file);
const ctx = { db };

// ---- pricing --------------------------------------------------------------------

check('an apex costs more than a tier 1',
  priceOf(ctx, 'Tyrannosaurus') > priceOf(ctx, 'Dryosaurus'),
  `${priceOf(ctx, 'Tyrannosaurus')} vs ${priceOf(ctx, 'Dryosaurus')}`);

check('an unknown species still has a price', priceOf(ctx, 'Somethingnew') > 0);

setTierPrice(ctx, 4, 5000);
check('a tier price applies to everything in it', priceOf(ctx, 'Tyrannosaurus') === 5000);

setSpeciesPrice(ctx, 'Tyrannosaurus', 9000);
check('a species price beats its tier price', priceOf(ctx, 'Tyrannosaurus') === 9000);
check('other species in that tier are unaffected', priceOf(ctx, 'Deinosuchus') === 5000);

// Retiering a species must move its price with it.
setTier(ctx, 'Dryosaurus', 4);
check('a retiered species picks up the new tier price', priceOf(ctx, 'Dryosaurus') === 5000,
  String(priceOf(ctx, 'Dryosaurus')));
setTier(ctx, 'Dryosaurus', 1);

check('mutations add to the price',
  totalPrice(ctx, 'Deinosuchus', ['A', 'B']) === 5000 + 2 * mutationPrice(ctx),
  String(totalPrice(ctx, 'Deinosuchus', ['A', 'B'])));
check('no mutations means no surcharge',
  totalPrice(ctx, 'Deinosuchus', []) === priceOf(ctx, 'Deinosuchus'));

db.setSetting('shop_mutation_price', '0');
check('mutations can be made free',
  totalPrice(ctx, 'Deinosuchus', ['A', 'B', 'C']) === priceOf(ctx, 'Deinosuchus'));
db.setSetting('shop_mutation_price', '200');

check('a free species is allowed', (setSpeciesPrice(ctx, 'Troodon', 0), priceOf(ctx, 'Troodon') === 0));

// ---- the offer ------------------------------------------------------------------

{
  setPending('u1', { species: 'Tyrannosaurus', mutations: [], price: 100, at: Date.now() });
  check('an offer can be taken once', takePending('u1')?.species === 'Tyrannosaurus');

  // The double-click guard: a second press must find nothing.
  check('the same offer cannot be spent twice', takePending('u1') === null);

  setPending('u2', { species: 'Rex', mutations: [], price: 1, at: Date.now() - 10 * 60_000 });
  check('a stale offer is refused', takePending('u2') === null);

  setPending('u3', { species: 'A', mutations: [], price: 1, at: Date.now() });
  setPending('u4', { species: 'B', mutations: [], price: 1, at: Date.now() });
  check('offers do not collide between people',
    takePending('u3')?.species === 'A' && takePending('u4')?.species === 'B');

  check('someone with no offer gets nothing', takePending('nobody') === null);
}

// ---- the panel's split mutation picker -------------------------------------------

{
  const { splitMutations, peekPending } = await load('shop.js');

  // Discord allows 25 options in a select, and this build has around forty
  // mutations, so the list is split across two menus.
  const forty = Array.from({ length: 40 }, (_, n) => `Mutation ${String(n).padStart(2, '0')}`);
  const { first, second } = splitMutations(forty);

  check('both halves fit a select menu', first.length <= 25 && second.length <= 25,
    `${first.length} / ${second.length}`);
  check('nothing is lost in the split', first.length + second.length === forty.length);
  check('nothing is in both halves',
    first.every((m) => !second.includes(m)));
  check('the halves are in order', first[0] < second[0], `${first[0]} vs ${second[0]}`);

  const odd = splitMutations(['B', 'A', 'C']);
  check('an odd count still splits', odd.first.length + odd.second.length === 3);
  check('the split sorts, so the halves are predictable', odd.first[0] === 'A');
  check('an empty list does not break it', splitMutations([]).first.length === 0);

  // Peeking must not consume, or redrawing the basket would lose the purchase.
  setPending('peeker', { species: 'Rex', mutations: [], price: 1, at: Date.now() });
  check('peeking leaves the offer in place',
    peekPending('peeker')?.species === 'Rex' && peekPending('peeker')?.species === 'Rex');
  check('taking it still consumes', takePending('peeker') !== null && peekPending('peeker') === null);
}

// ---- the receipt trail -----------------------------------------------------------

{
  db.recordPurchase({
    discordId: '1', steamId: '76561198000000001', species: 'Tyrannosaurus',
    mutations: ['Hydrodynamic'], price: 1800, slot: 'Tyrannosaurus',
  });
  db.recordPurchase({
    discordId: '2', steamId: '76561198000000002', species: 'Dryosaurus',
    mutations: [], price: 300, slot: 'Dryosaurus',
  });

  const recent = db.recentPurchases(10);
  check('purchases are recorded', recent.length === 2, String(recent.length));
  check('newest first', recent[0].species === 'Dryosaurus', recent[0].species);
  check('the mutations are kept for the receipt', recent[1].mutations === 'Hydrodynamic');
  check('the price is kept', recent[0].price === 300);
  check('the limit is respected', db.recentPurchases(1).length === 1);
}

// ---- spending --------------------------------------------------------------------

{
  const S = '76561198000000009';
  db.setPoints(S, 1000);
  db.addPoints(S, -400);
  check('buying subtracts from the balance', db.pointsFor(S).balance === 600,
    String(db.pointsFor(S).balance));
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

// ---- picking mutations -----------------------------------------------------------

{
  const { readMutations } = await load('commands.js');

  // Stands in for the interaction: only getString is used.
  const fake = (values) => ({
    options: { getString: (name) => values[name] ?? null },
  });

  check('reads the slots in order',
    readMutations(fake({ mutation1: 'A', mutation2: 'B' })).mutations.join(',') === 'A,B');

  check('gaps are skipped rather than ending the list',
    readMutations(fake({ mutation1: 'A', mutation3: 'C' })).mutations.join(',') === 'A,C');

  check('no mutations is fine', readMutations(fake({})).mutations.length === 0);

  {
    const repeated = readMutations(fake({ mutation1: 'Hydrodynamic', mutation2: 'Hydrodynamic' }));
    check('a repeat is caught', repeated.duplicate === 'Hydrodynamic', String(repeated.duplicate));
  }

  {
    const cased = readMutations(fake({ mutation1: 'Hydrodynamic', mutation2: 'hydrodynamic' }));
    check('a repeat in different case is still a repeat', cased.duplicate === 'hydrodynamic',
      String(cased.duplicate));
  }

  {
    const spaced = readMutations(fake({ mutation1: 'Nocturnal', mutation4: '  Nocturnal ' }));
    check('whitespace does not disguise a repeat', spaced.duplicate !== null,
      String(spaced.duplicate));
  }

  check('four different ones are allowed',
    readMutations(fake({ mutation1: 'A', mutation2: 'B', mutation3: 'C', mutation4: 'D' }))
      .duplicate === null);
}

// ---- embeds ----------------------------------------------------------------------

{
  const fresh = new Database(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'c.sqlite'));
  const c2 = { db: fresh };

  const catalogue = buildCatalogue(c2, ['Tyrannosaurus', 'Dryosaurus', 'Allosaurus'], 1234).toJSON();
  check('the catalogue shows the balance', /1,234/.test(catalogue.description ?? ''));
  check('the catalogue groups by tier', (catalogue.fields ?? []).length >= 2,
    String((catalogue.fields ?? []).length));
  check('it says what a purchase costs you in vaults',
    new RegExp(`${MAX_SLOTS} vaults`).test(catalogue.footer?.text ?? ''), catalogue.footer?.text);
  check('the catalogue fits Discord limits', JSON.stringify(catalogue).length < 6000,
    String(JSON.stringify(catalogue).length));

  const receipt = buildReceipt('Tyrannosaurus', ['Hydrodynamic'], 1800, 200, 'Tyrannosaurus').toJSON();
  check('the receipt says what was spent and what is left',
    /1,800/.test(receipt.description ?? '') && /200/.test(receipt.description ?? ''),
    receipt.description);
  check('the receipt explains how to collect it',
    /Release/.test(receipt.description ?? ''));

  fresh.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
