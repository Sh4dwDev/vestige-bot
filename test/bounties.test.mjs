// Bounties. Two ways this goes wrong: paying forever on a species that stays
// over its cap, and posting one on something that is nearly extinct.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { Database } = await import(pathToFileURL(path.join(root, 'dist/db.js')).href);
const b = await import(pathToFileURL(path.join(root, 'dist/bounties.js')).href);

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
const tier = (s) => ({ Tyrannosaurus: 4, Carnotaurus: 2, Dryosaurus: 1 }[s] ?? 1);
const names = (list) => list.map((x) => x.species).sort().join(',');

// ---- what gets a bounty ---------------------------------------------------

check('a species over its cap gets one',
  names(b.bountiesFor(caps, counts({ Tyrannosaurus: 7 }), 150, tier)) === 'Tyrannosaurus');
check('exactly at the cap counts as over',
  b.bountiesFor(caps, counts({ Tyrannosaurus: 5 }), 150, tier).length === 1);
check('under the cap gets nothing',
  b.bountiesFor(caps, counts({ Tyrannosaurus: 4 }), 150, tier).length === 0);
check('a species nobody is playing gets nothing',
  b.bountiesFor(caps, counts({}), 150, tier).length === 0);
check('a species with no cap is never bountied',
  b.bountiesFor(caps, counts({ Stegosaurus: 40 }), 150, tier).length === 0);

// The rule that stops the two systems contradicting each other.
check('an endangered species is NEVER bountied, however the counts read',
  b.bountiesFor(caps, counts({ Tyrannosaurus: 9 }), 150, tier,
    new Set(['Tyrannosaurus'])).length === 0);

// ---- what it pays ---------------------------------------------------------
{
  const apex = b.bountiesFor(caps, counts({ Tyrannosaurus: 7 }), 150, tier)[0];
  const small = b.bountiesFor(caps, counts({ Dryosaurus: 21 }), 150, tier)[0];

  check('an apex is worth more than a tier 1', apex.reward > small.reward,
    `${apex.reward} vs ${small.reward}`);
  check('the reward is never below the base', small.reward >= 150, String(small.reward));
  check('further over the cap means more payouts', apex.claims > 1, String(apex.claims));
  check('one over the cap is a single payout',
    b.bountiesFor(caps, counts({ Carnotaurus: 12 }), 150, tier)[0].claims === 1);
  check('payouts are capped, so a flood is not an open season',
    b.bountiesFor(caps, counts({ Dryosaurus: 200 }), 150, tier)[0].claims <= 5);
  check('the richest is listed first',
    b.bountiesFor(caps, counts({ Tyrannosaurus: 7, Dryosaurus: 21 }), 150, tier)[0]
      .species === 'Tyrannosaurus');
}

// ---- claiming -------------------------------------------------------------

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'b.sqlite');
const db = new Database(file);
const ctx = { db };

check('bounties are off until someone turns them on', b.bountySettings(ctx).enabled === false);
check('nothing pays while they are off', b.claimBounty(ctx, 'Tyrannosaurus') === null);

b.setBountiesEnabled(ctx, true);
db.setSetting('bounties_active', JSON.stringify([
  { species: 'Tyrannosaurus', reward: 300, claims: 2, over: 1, postedAt: Date.now() },
]));

{
  const first = b.claimBounty(ctx, 'Tyrannosaurus');
  check('a kill on a bountied species pays', first?.reward === 300);
  check('and spends a payout', first?.claims === 1, String(first?.claims));
  check('a kill on anything else pays nothing', b.claimBounty(ctx, 'Dryosaurus') === null);

  const second = b.claimBounty(ctx, 'Tyrannosaurus');
  check('the last payout still pays', second?.reward === 300);
  check('and empties the board', b.activeBounties(ctx).length === 0);

  // The whole reason claims are limited.
  check('a spent bounty pays nothing more', b.claimBounty(ctx, 'Tyrannosaurus') === null);
}

// A species that stays over its cap must not immediately get a fresh pot.
{
  const players = Array.from({ length: 7 }, () => (
    { steam: '1', species: 'Tyrannosaurus', growth: 1, female: false, prime: false }));
  db.setSpeciesCap('Tyrannosaurus', 5);

  const again = b.refreshBounties(ctx, players);
  check('a just-spent bounty is not reposted straight away',
    again.posted.length === 0, names(again.posted));
}

check('a corrupt state row does not throw', (() => {
  db.setSetting('bounties_active', 'not json');
  return b.activeBounties(ctx).length === 0;
})());

// ---- what players see -----------------------------------------------------
{
  const bounty = { species: 'Tyrannosaurus', reward: 300, claims: 3, over: 2, postedAt: 0 };

  check('the panel line names the species, reward and payouts',
    /Tyrannosaurus/.test(b.bountyLines([bounty]))
    && /300/.test(b.bountyLines([bounty]))
    && /3 left/.test(b.bountyLines([bounty])), b.bountyLines([bounty]));

  const posted = b.bountyAnnounce(bounty);
  check('the in-game notice says what it pays', /300 points per kill/.test(posted), posted);
  check('and why it exists', /over the limit/.test(posted));
  check('a payout is announced with what is left',
    /2 payouts left/.test(b.bountyPaidAnnounce('Rex', 300, 2)));
  check('and the final one says so',
    /last one/.test(b.bountyPaidAnnounce('Rex', 300, 0)));
  check('in-game lines are plain ASCII, like every other one',
    [posted, b.bountyPaidAnnounce('Rex', 300, 2), b.bountyPaidAnnounce('Rex', 300, 0)]
      .every((line) => /^[\x20-\x7E]*$/.test(line)));

  const card = b.buildBountyEmbed(bounty).toJSON();
  check('the embed stays within Discord limits',
    (card.description ?? '').length < 4096 && (card.title ?? '').length < 256);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
