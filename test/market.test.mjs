// Players selling dinosaurs to each other.
//
// The risk here is not the embeds, it is the money and the animal: charging
// somebody for a dinosaur they did not get, or moving a dinosaur nobody paid
// for. So the order of operations is what gets tested hardest — claim, move,
// then charge — along with the failures at each step.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  listForSale, buyListing, cancelListing, sellerTakes, marketFee, setMarketFee,
  buildListingEmbed, buildMarketPanel, buildSellPicker, buildBrowseEmbed,
  describeListing, listingRows, ESCROW, listingsChannel, setListingsChannel,
  marketChannel, setMarketChannel,
} = await load('market.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const SELLER = '76561198000000001';
const BUYER = '76561198000000002';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'market.sqlite');
const db = new Database(file);
const name = (s) => (s === SELLER ? 'Shadow' : s === BUYER ? 'Rex' : s);

/**
 * A server that behaves. `slots` maps an owner to what they are holding, so a
 * transfer can be watched actually moving something rather than just returning
 * ok — the bug that matters is a sale where the dinosaur does not move.
 */
function makeCtx(overrides = {}) {
  const slots = {
    [SELLER]: [{ slot: 'rex', species: 'Tyrannosaurus' }],
    [BUYER]: [],
    [ESCROW]: [],
  };
  const sent = [];

  return {
    db,
    slots,
    sent,
    mod: {
      run: async (verb, steam, args = {}) => {
        sent.push({ verb, steam, args });
        if (overrides[verb]) return overrides[verb];

        if (verb === 'list') return { ok: true, msg: '', data: slots[steam] ?? [] };

        if (verb === 'slotinfo') {
          const held = (slots[steam] ?? []).find((s) => s.slot === args.slot);
          return held
            ? {
              ok: true,
              msg: 'read',
              data: {
                slot: held.slot, species: held.species, growth: 1, female: true,
                prime: false, elderStacks: 0, mutations: ['Hardy'],
              },
            }
            : { ok: false, msg: 'nothing is stored in that slot' };
        }

        if (verb === 'transfer') {
          // The owner is named in the arguments, because escrow is not a Steam
          // ID and the mod rejects a request made in its name.
          const owner = args.from ?? steam;
          const from = slots[owner] ?? [];
          const at = from.findIndex((s) => s.slot === args.slot);
          if (at < 0) return { ok: false, msg: 'nothing is stored in that slot' };

          const [moved] = from.splice(at, 1);
          slots[args.to] = slots[args.to] ?? [];
          slots[args.to].push(moved);
          return { ok: true, msg: 'moved', data: { slot: moved.slot, to: args.to } };
        }

        return { ok: true, msg: 'ok' };
      },
    },
  };
}

// ---- listing ----------------------------------------------------------------

{
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 2500);

  check('a stored dinosaur can be listed', listed.ok === true,
    listed.ok ? '' : listed.reason);
  check('and it leaves the seller archive at once', ctx.slots[SELLER].length === 0);
  // Otherwise the seller can play it, release it, or sell it twice.
  check('into escrow, not into nothing', ctx.slots[ESCROW].length === 1);
  check('the listing describes what is on offer',
    listed.listing.species === 'Tyrannosaurus' && listed.listing.price === 2500);
  check('including the mutations, which is most of what a buyer is paying for',
    listed.listing.mutations.length === 1);
}

{
  const ctx = makeCtx();
  const nothing = await listForSale(ctx, SELLER, 'nosuchslot', 100);
  check('an empty slot cannot be listed', nothing.ok === false);
  check('and nothing was moved', ctx.slots[ESCROW].length === 0);

  const free = await listForSale(ctx, SELLER, 'rex', 0);
  check('nor can something be listed for nothing', free.ok === false);
  check('still nothing moved', ctx.slots[ESCROW].length === 0);
}

{
  // A transfer that fails must not leave a listing pointing at a dinosaur that
  // is still in the seller archive.
  const ctx = makeCtx({ transfer: { ok: false, msg: 'an action is still finishing' } });
  const before = db.openListings().length;
  const busy = await listForSale(ctx, SELLER, 'rex', 500);

  check('a refused move means no listing', busy.ok === false, busy.ok ? '' : busy.reason);
  check('and the market did not grow', db.openListings().length === before);
  check('the dinosaur stays with its owner', ctx.slots[SELLER].length === 1);
}

// ---- buying -----------------------------------------------------------------

{
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 1000);
  const id = listed.listing.id;

  const broke = await buyListing(ctx, id, BUYER);
  check('somebody who cannot afford it is turned down', broke.ok === false);
  check('and the listing is still open', db.listing(id).status === 'open');

  db.addPoints(BUYER, 1500, 0);

  const bought = await buyListing(ctx, id, BUYER);
  check('somebody who can afford it gets it', bought.ok === true,
    bought.ok ? '' : bought.reason);
  check('the dinosaur lands in their archive', ctx.slots[BUYER].length === 1);
  check('and leaves escrow', ctx.slots[ESCROW].length === 0);
  check('the buyer is charged exactly the price', db.pointsFor(BUYER).balance === 500,
    String(db.pointsFor(BUYER).balance));
  check('the seller is paid', db.pointsFor(SELLER).balance === 1000,
    String(db.pointsFor(SELLER).balance));
  check('and the listing closes', db.listing(id).status === 'sold');

  const twice = await buyListing(ctx, id, BUYER);
  check('a sold listing cannot be bought again', twice.ok === false);
  check('and nobody is charged twice', db.pointsFor(BUYER).balance === 500);
}

{
  // The failure that actually costs somebody: paying for a dinosaur that never
  // arrives. The move happens before any points change hands for this reason.
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 300);
  const id = listed.listing.id;

  db.addPoints(BUYER, 1000, 0);
  const before = db.pointsFor(BUYER).balance;

  // Everything works until the moment of the move.
  ctx.mod.run = async (verb, steam, args = {}) => {
    if (verb === 'list') return { ok: true, msg: '', data: ctx.slots[steam] ?? [] };
    if (verb === 'transfer') return { ok: false, msg: 'their storage is full' };
    return { ok: true, msg: 'ok' };
  };

  const failed = await buyListing(ctx, id, BUYER);
  check('a move that fails does not charge anybody', failed.ok === false);
  check('the balance is untouched', db.pointsFor(BUYER).balance === before,
    String(db.pointsFor(BUYER).balance));
  check('and the listing goes back on sale rather than being stuck',
    db.listing(id).status === 'open', db.listing(id).status);
  check('the reason says so plainly', /not charged/.test(failed.reason), failed.reason);
}

{
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 100);
  db.addPoints(BUYER, 1000, 0);

  // Two people press Buy in the same second. The claim is one statement, so
  // exactly one of them can win it.
  const [a, b] = await Promise.all([
    buyListing(ctx, listed.listing.id, BUYER),
    buyListing(ctx, listed.listing.id, '76561198000000003'),
  ]);

  check('exactly one of two simultaneous buyers wins it',
    [a.ok, b.ok].filter(Boolean).length === 1, `${a.ok}/${b.ok}`);
  check('and only one copy of the dinosaur exists afterwards',
    ctx.slots[BUYER].length + (ctx.slots['76561198000000003']?.length ?? 0) === 1);
}

{
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 10);
  const mine = await buyListing(ctx, listed.listing.id, SELLER);
  check('you cannot buy your own listing', mine.ok === false, mine.ok ? '' : mine.reason);
}

{
  // Three slots is the cap. Buying a fourth would have nowhere to put it.
  const ctx = makeCtx();
  ctx.slots[BUYER] = [
    { slot: 'a', species: 'Dryosaurus' },
    { slot: 'b', species: 'Dryosaurus' },
    { slot: 'c', species: 'Dryosaurus' },
  ];
  const listed = await listForSale(ctx, SELLER, 'rex', 10);
  db.addPoints(BUYER, 1000, 0);
  const before = db.pointsFor(BUYER).balance;

  const full = await buyListing(ctx, listed.listing.id, BUYER);
  check('a buyer with no free slot is stopped before paying', full.ok === false);
  check('and is told why', /full/.test(full.reason), full.reason);
  check('their points are untouched', db.pointsFor(BUYER).balance === before);
  check('and it is still for sale', db.listing(listed.listing.id).status === 'open');
}

// ---- the cut ----------------------------------------------------------------

{
  check('nothing is taken by default', sellerTakes(1000, 0) === 1000);
  check('a cut comes off the seller', sellerTakes(1000, 10) === 900);
  check('and rounds in the seller favour', sellerTakes(999, 10) === 900, String(sellerTakes(999, 10)));

  const ctx = makeCtx();
  setMarketFee(ctx, 20);
  check('the cut reads back', marketFee(ctx) === 20);

  const listed = await listForSale(ctx, SELLER, 'rex', 500);
  db.addPoints(BUYER, 5000, 0);
  const sellerBefore = db.pointsFor(SELLER).balance;
  const buyerBefore = db.pointsFor(BUYER).balance;

  const sold = await buyListing(ctx, listed.listing.id, BUYER);
  check('the buyer pays the whole price', db.pointsFor(BUYER).balance === buyerBefore - 500);
  check('the seller receives it less the cut',
    db.pointsFor(SELLER).balance === sellerBefore + 400,
    String(db.pointsFor(SELLER).balance - sellerBefore));
  check('and the sale reports both numbers',
    sold.paid === 500 && sold.sellerGot === 400);

  setMarketFee(ctx, 0);
}

// ---- taking it down ---------------------------------------------------------

{
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 700);
  const id = listed.listing.id;

  const notYours = await cancelListing(ctx, id, BUYER);
  check('somebody else cannot take your listing down', notYours.ok === false);
  check('and it is still open', db.listing(id).status === 'open');

  const mine = await cancelListing(ctx, id, SELLER);
  check('the seller can', mine.ok === true, mine.ok ? '' : mine.reason);
  check('and gets the dinosaur back', ctx.slots[SELLER].length === 1);
  check('escrow lets go of it', ctx.slots[ESCROW].length === 0);
  check('the listing is closed', db.listing(id).status === 'cancelled');

  const again = await cancelListing(ctx, id, SELLER);
  check('taking it down twice does nothing', again.ok === false);
}

{
  // Cancelling into a full archive would lose the dinosaur.
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 700);
  ctx.slots[SELLER] = [
    { slot: 'a', species: 'Dryosaurus' },
    { slot: 'b', species: 'Dryosaurus' },
    { slot: 'c', species: 'Dryosaurus' },
  ];

  const full = await cancelListing(ctx, listed.listing.id, SELLER);
  check('a seller with no room is told rather than losing it', full.ok === false);
  check('and it stays listed until they make room',
    db.listing(listed.listing.id).status === 'open');
  check('the dinosaur is still safe in escrow', ctx.slots[ESCROW].length === 1);
}

// ---- what people see --------------------------------------------------------

{
  const ctx = makeCtx();
  const listed = await listForSale(ctx, SELLER, 'rex', 4200);
  const listing = listed.listing;

  const open = buildListingEmbed(listing, name, 0).toJSON();
  check('a listing states the price', /4200/.test(JSON.stringify(open)));
  check('and what it is', /Tyrannosaurus/.test(open.title ?? ''));
  check('and who is selling it', /Shadow/.test(JSON.stringify(open.fields ?? [])));
  check('it fits Discord limits',
    JSON.stringify(open).length < 6000
    && (open.fields ?? []).every((f) => f.value.length < 1024));

  const withFee = buildListingEmbed(listing, name, 15).toJSON();
  check('a cut is stated on the listing, not hidden',
    /15%/.test(JSON.stringify(withFee.fields ?? [])));

  const rows = listingRows(listing).map((r) => r.toJSON());
  const ids = rows.flatMap((r) => r.components.map((c) => c.custom_id));
  check('an open listing offers a buy', ids.includes(`mk:buy:${listing.id}`));
  check('and a way to take it down', ids.includes(`mk:cancel:${listing.id}`));

  const sold = buildListingEmbed({ ...listing, status: 'sold', buyerSteam: BUYER }, name)
    .toJSON();
  check('a sold one names the buyer', /Rex/.test(sold.description ?? ''));
  check('and stops offering buttons', listingRows({ ...listing, status: 'sold' }).length === 0);

  check('the one-line summary carries what matters',
    /Tyrannosaurus/.test(describeListing(listing))
    && /4200/.test(describeListing(listing)), describeListing(listing));
}

{
  const empty = buildSellPicker([]).embed.toJSON();
  check('somebody with an empty archive is told what to do first',
    /Store a dinosaur/.test(empty.description ?? ''));

  const picker = buildSellPicker([{ slot: 'rex', species: 'Tyrannosaurus' }]);
  const menu = picker.rows[0].toJSON().components[0];
  check('the picker offers what they have stored',
    menu.options.length === 1 && menu.options[0].value === 'rex');
  check('and routes to the price form', menu.custom_id === 'mk:pick');
}

{
  const ctx = makeCtx();
  const quiet = buildBrowseEmbed([], name).toJSON();
  check('an empty market says so', /Nothing for sale/.test(quiet.title ?? ''));

  const panel = buildMarketPanel(ctx).toJSON();
  check('the panel explains escrow, since that surprises people',
    /leaves your archive|out of your archive/.test(JSON.stringify(panel.fields ?? [])));
  check('and that both parties can be offline',
    /offline/.test(JSON.stringify(panel.fields ?? [])));
}

// ---- two channels -----------------------------------------------------------
//
// The panel and the listings can live apart: a channel full of Buy buttons is
// not one anybody wants a panel buried in.

{
  const ctx = makeCtx();

  setMarketChannel(ctx, '111');
  check('listings fall back to the panel channel', listingsChannel(ctx) === '111');
  // A market set up before the split has to carry on working untouched.
  check('and the panel does not point anywhere else in that case',
    !/<#/.test(buildMarketPanel(ctx).toJSON().description ?? ''));

  const listed = await listForSale(ctx, SELLER, 'rex', 900);
  db.setListingMessage(listed.listing.id, '999');

  const forgotten = setListingsChannel(ctx, '222');
  check('listings can be pointed at their own channel', listingsChannel(ctx) === '222');
  check('the panel stays where it was', marketChannel(ctx) === '111');
  // The old messages are in a channel the bot no longer draws in, so editing
  // them would be editing something nobody is looking at.
  check('open listings forget where they were posted', forgotten >= 1, String(forgotten));
  check('and really do forget', db.listing(listed.listing.id).messageId === null);

  const panel = buildMarketPanel(ctx).toJSON();
  check('the panel now says where to look',
    /<#222>/.test(panel.description ?? ''), panel.description);
  check('and the buying instructions point there too',
    /<#222>/.test(JSON.stringify(panel.fields ?? [])));

  await cancelListing(ctx, listed.listing.id, SELLER);
  setListingsChannel(ctx, null);
  setMarketChannel(ctx, null);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
