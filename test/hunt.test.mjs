// The hunt. One player is the quarry; kill them to win, keep them alive and
// nobody does. The rules that matter are who gets paid and who does not.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  huntStep, claimHunt, saveHunt, activeHunt, markRevealed,
  buildHuntEmbed, huntAnnounce, revealAnnounce, survivedAnnounce, proximityStep,
  companyOf, COMPANY_WITHIN, presenceStep, GONE_AFTER_MS, buildHuntStatusEmbed,
  goneAnnounce, backAnnounce, participants, participationAward, payParticipants, revealScent,
  PARTICIPATION_MIN,
} = await load('hunt.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const MINUTE = 60_000;
const NOW = 1_800_000_000_000;
const TARGET = '76561198000000001';
const HUNTER = '76561198000000002';

const base = (over = {}) => ({
  targetSteam: TARGET, targetName: 'Shadow', reward: 1500,
  endsAt: NOW + (20 * MINUTE), revealEveryMs: 3 * MINUTE,
  lastRevealAt: NOW, startedAt: NOW, ...over,
});

const at = (steam, x, y, species = 'Rex') =>
  ({ steam, species, growth: 1, female: false, prime: false, x, y });

// ---- calling out the position ----------------------------------------------

{
  const h = base();
  check('nothing is said before the first interval',
    huntStep(h, [at(TARGET, 1000, 2000)], NOW + MINUTE).kind === 'waiting');

  const due = huntStep(h, [at(TARGET, 1000, 2000)], NOW + (3 * MINUTE));
  check('then the position goes out', due.kind === 'reveal');
  check('and it is where they actually are',
    due.kind === 'reveal' && due.x === 1000 && due.y === 2000);

  // Without it, a callout sends people to a spot to hunt whatever they find.
  const asAllo = huntStep(h, [at(TARGET, 1000, 2000, 'Allosaurus')], NOW + (3 * MINUTE));
  check('and says what they are playing',
    asAllo.kind === 'reveal' && asAllo.species === 'Allosaurus');
}

{
  // Announcing a position from ten minutes ago as though it were current would
  // send everybody to the wrong place.
  const h = base();
  check('an offline target is not located',
    huntStep(h, [], NOW + (3 * MINUTE)).kind === 'waiting');
  check('nor is one the mod cannot place',
    huntStep(h, [{ steam: TARGET, species: 'Rex', growth: 1, female: false, prime: false }],
      NOW + (3 * MINUTE)).kind === 'waiting');
}

{
  const h = base();
  check('when the time is up they have survived',
    huntStep(h, [at(TARGET, 1, 1)], NOW + (21 * MINUTE)).kind === 'survived');
  check('and that beats a due position call',
    huntStep({ ...h, lastRevealAt: NOW - (10 * MINUTE) }, [at(TARGET, 1, 1)],
      NOW + (21 * MINUTE)).kind === 'survived');
}

// ---- paying out ---------------------------------------------------------------

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt.sqlite'));
  const ctx = { db };
  db.savePreset('Trophy', { colours: { BodyColor: '#AA0000' } }, 'staff');

  saveHunt(ctx, base({ skin: 'Trophy' }));

  check('killing somebody else does not end it',
    claimHunt(ctx, HUNTER, '76561198000000009') === null);
  check('and the hunt is still running', activeHunt(ctx) !== null);

  const won = claimHunt(ctx, HUNTER, TARGET);
  check('killing the target ends it', won !== null);
  check('the killer is paid', db.pointsFor(HUNTER).balance === 1500,
    String(db.pointsFor(HUNTER).balance));
  check('and gets the skin', db.ownsSkin(HUNTER, 'Trophy'));
  check('the hunt is cleared', activeHunt(ctx) === null);
  check('so a second kill pays nothing', claimHunt(ctx, HUNTER, TARGET) === null);

  db.close();
}

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt2.sqlite'));
  const ctx = { db };

  // Bleeding out, drowning and wildlife all arrive with no killer. Awarding
  // those to whoever was nearest would be guessing at a winner.
  saveHunt(ctx, base());
  check('a death with no killer pays nobody', claimHunt(ctx, '', TARGET) === null);
  check('and it ends rather than running on', activeHunt(ctx) === null);

  // Slaying yourself out of a hunt should not pay you either.
  saveHunt(ctx, base());
  check('the target killing themselves pays nobody',
    claimHunt(ctx, TARGET, TARGET) === null);
  check('and that ends it too', activeHunt(ctx) === null);
  check('nothing was paid', db.pointsFor(TARGET).balance === 0);

  db.close();
}

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt3.sqlite'));
  const ctx = { db };
  const h = base();
  saveHunt(ctx, h);

  // Marked before announcing, so a failed announcement is not retried every
  // poll for the rest of the hunt.
  markRevealed(ctx, h, NOW + (3 * MINUTE));
  check('a reveal moves the timer on',
    activeHunt(ctx).lastRevealAt === NOW + (3 * MINUTE));
  check('and nothing else about the hunt changed',
    activeHunt(ctx).targetSteam === TARGET && activeHunt(ctx).reward === 1500);

  db.close();
}

// ---- what people are told ------------------------------------------------------

{
  const h = base();
  for (const [what, line] of [
    ['the opening call', huntAnnounce(h)],
    ['a position call', revealAnnounce(h, 120_000, -317_000, 'Allosaurus')],
    ['the survival call', survivedAnnounce(h)],
  ]) {
    check(`${what} is plain ASCII`, /^[\x20-\x7E]*$/.test(line), line);
  }

  check('a position call gives coordinates',
    revealAnnounce(h, 120_000, -317_000, 'Allosaurus').includes('Lat -317'));
  check('and names the dinosaur they are on',
    revealAnnounce(h, 120_000, -317_000, 'Allosaurus').includes('Allosaurus'));
  check('an unknown species does not leave a dangling word',
    revealAnnounce(h, 120_000, -317_000, '').endsWith('.'),
    revealAnnounce(h, 120_000, -317_000, ''));
  check('the target is named, not their Steam ID',
    huntAnnounce(h).includes('Shadow') && !huntAnnounce(h).includes(TARGET));

  // Asked for twice: a callout with no species sends people to a spot to hunt
  // whatever they find there.
  const known = base({ targetSpecies: 'Allosaurus' });
  check('the opening call names the dinosaur too',
    huntAnnounce(known).includes('Allosaurus'), huntAnnounce(known));
  check('and it stays ASCII', /^[ -~]*$/.test(huntAnnounce(known)));
  check('a target nobody has seen yet reads cleanly',
    !/\(\)/.test(huntAnnounce(h)), huntAnnounce(h));
  check('the running panel names it',
    /Allosaurus/.test(buildHuntEmbed(known, 'running').toJSON().description ?? ''));

  const survived = buildHuntEmbed(h, 'survived').toJSON();
  check('surviving explains why nobody won',
    /player kill/.test(survived.description ?? ''), survived.description);
}

// ---- how close am I --------------------------------------------------------
//
// Hunters get a bearing from where they are standing. Two things are
// deliberately silent, both asked for after watching it played:
//
//   * **the quarry is told nothing.** A proximity alarm they can act on means
//     they simply leave every time it fires, and no hunt ever resolves.
//   * **the innermost band says nothing to anybody.** Being told "you are right
//     on top of them" replaces looking, and a quarry hiding in cover is then
//     found by the HUD rather than by anyone's eyes.

{
  const h = base();
  const far = proximityStep(h, [at(TARGET, 0, 0), at(HUNTER, 900_000, 900_000)]);
  check('nobody across the island is told anything', far.notices.length === 0);

  // 30 HUD units out, which is the middle band.
  const warm = proximityStep(h, [at(TARGET, 0, 0), at(HUNTER, 30_000, 0)]);
  const toHunter = warm.notices.find((n) => n.steam === HUNTER)?.text ?? '';

  check('the hunter is given a direction', /scent is (north|south|east|west)/.test(toHunter),
    toHunter);
  check('and a sense of distance', /close|far|way off|on top/.test(toHunter), toHunter);
  check('the quarry is told nothing at all',
    warm.notices.every((n) => n.steam !== TARGET), JSON.stringify(warm.notices));

  // Standing still must not repeat it twelve times a minute.
  const again = proximityStep(warm.hunt, [at(TARGET, 0, 0), at(HUNTER, 30_000, 0)]);
  check('standing still says nothing more', again.notices.length === 0,
    JSON.stringify(again.notices));

  // The last stretch is meant to be visual, so closing right in goes quiet.
  const onTop = proximityStep(again.hunt, [at(TARGET, 0, 0), at(HUNTER, 5_000, 0)]);
  check('and being right on top of them says nothing',
    onTop.notices.length === 0, JSON.stringify(onTop.notices));
  check('though it is still recorded as a chase',
    onTop.hunt.chased.includes(HUNTER), JSON.stringify(onTop.hunt.chased));

  // Drifting back out to a colder band is not worth saying either.
  const drifting = proximityStep(onTop.hunt, [at(TARGET, 0, 0), at(HUNTER, 30_000, 0)]);
  check('drifting back out does not announce itself',
    drifting.notices.length === 0, JSON.stringify(drifting.notices));

  const lost = proximityStep(drifting.hunt, [at(TARGET, 0, 0), at(HUNTER, 900_000, 900_000)]);
  check('losing them entirely is worth saying',
    lost.notices.some((n) => n.steam === HUNTER && /lost/i.test(n.text)),
    JSON.stringify(lost.notices));
  check('and even then the quarry hears nothing',
    lost.notices.every((n) => n.steam !== TARGET), JSON.stringify(lost.notices));
}

{
  // A target nobody can see cannot be measured against.
  const h = base();
  const blind = proximityStep(h, [at(HUNTER, 0, 0)]);
  check('an unlocatable target produces no notices', blind.notices.length === 0);
  check('and the bands are cleared, so coming back speaks again',
    Object.keys(blind.hunt.bands ?? {}).length === 0);
}

{
  // The target must never be told they are close to themselves.
  const h = base();
  const alone = proximityStep(h, [at(TARGET, 0, 0)]);
  check('a target alone on the island hears nothing', alone.notices.length === 0,
    JSON.stringify(alone.notices));
}

{
  // Two hunters, each told for themselves, and the quarry told nothing however
  // many are closing in.
  const h = base();
  const pair = proximityStep(h, [
    // One due east of the quarry, one due south of them, so the two bearings
    // must differ. Picking two spots that happen to share one proves nothing.
    at(TARGET, 0, 0), at(HUNTER, 30_000, 0), at('76561198000000003', 0, 30_000),
  ]);
  check('each hunter is told separately',
    pair.notices.filter((n) => n.steam !== TARGET).length === 2,
    JSON.stringify(pair.notices));
  check('and their bearings are worked out from their own positions',
    new Set(pair.notices.map((n) => n.text)).size === 2,
    JSON.stringify(pair.notices.map((n) => n.text)));
  check('the quarry hears nothing however many are chasing',
    pair.notices.every((n) => n.steam !== TARGET), JSON.stringify(pair.notices));
  check('but both are recorded as having chased',
    pair.hunt.chased.length === 2, JSON.stringify(pair.hunt.chased));
}

{
  // These render through the mod, which drops anything outside ASCII silently.
  const h = base();
  const near = proximityStep(h, [at(TARGET, 0, 0), at(HUNTER, 5_000, 0)]);
  for (const notice of near.notices) {
    check('a proximity notice is plain ASCII', /^[ -~]*$/.test(notice.text), notice.text);
  }
}

// ---- the quarry's own group ------------------------------------------------

{
  const FRIEND = '76561198000000004';

  const together = companyOf(TARGET, [
    at(TARGET, 0, 0),
    at(FRIEND, (COMPANY_WITHIN - 2) * 1000, 0),
    at(HUNTER, (COMPANY_WITHIN + 30) * 1000, 0),
  ]);
  check('somebody standing with the quarry is company', together.includes(FRIEND));
  check('somebody far away is not', !together.includes(HUNTER), JSON.stringify(together));
  check('and the quarry is never their own company', !together.includes(TARGET));

  // An unlocatable quarry gives nothing to compare against. Guessing here would
  // either disqualify the whole server or nobody, and both are wrong.
  check('an unlocatable quarry has no company',
    companyOf(TARGET, [{ steam: TARGET }, at(FRIEND, 0, 0)]).length === 0);

  check('a player with no position is not counted',
    companyOf(TARGET, [at(TARGET, 0, 0), { steam: FRIEND }]).length === 0);
}

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt3.sqlite'));
  const ctx = { db };
  const FRIEND = '76561198000000004';
  db.savePreset('Trophy', { colours: { BodyColor: '#AA0000' } }, 'staff');

  // The cheapest way to farm a hunt: have a friend standing next to you kill
  // you. It ends the hunt, because the quarry really is dead, but it pays
  // nobody.
  saveHunt(ctx, base({ skin: 'Trophy', company: [FRIEND] }));
  const colluded = claimHunt(ctx, FRIEND, TARGET);
  check('the quarry cannot be cashed in by their own group',
    colluded?.kind === 'collusion', JSON.stringify(colluded?.kind));
  check('and nothing is paid for it', db.pointsFor(FRIEND).balance === 0,
    String(db.pointsFor(FRIEND).balance));
  check('nor is the skin handed over', !db.ownsSkin(FRIEND, 'Trophy'));
  check('the hunt still ends, because they are dead', activeHunt(ctx) === null);

  // Somebody who was not standing there is a hunter, whoever else was.
  saveHunt(ctx, base({ company: [FRIEND] }));
  const won = claimHunt(ctx, HUNTER, TARGET);
  check('an actual hunter is still paid', won?.kind === 'paid');
  check('and gets the points', db.pointsFor(HUNTER).balance === 1500,
    String(db.pointsFor(HUNTER).balance));

  db.close();
}

// ---- the position call ------------------------------------------------------

{
  // It used to be one server-wide line of coordinates. Players do not read
  // coordinates: "Lat -164, Long -112" is a number to everybody except the few
  // who have learned the map, and everybody else ignored the call.
  const h = base();
  const tx = -112_000;
  const ty = -164_000;

  const south = revealScent(h, tx, ty, at('H1', -112_000, 300_000));
  check('a hunter south of the quarry is sent north', /is north of you/.test(south), south);

  const west = revealScent(h, tx, ty, at('H2', -600_000, -164_000));
  check('and one to the west is sent east', /is east of you/.test(west), west);

  check('the call carries no coordinates at all',
    !/Lat|Long|-?\d{2,}/.test(south), south);
  check('and names who they are looking for', south.includes('Shadow'), south);
  check('with a sense of how far', /way off|far|close|on top/.test(south), south);

  // Nothing useful to tell either of these.
  check('the quarry is not told where they are',
    revealScent(h, tx, ty, at(TARGET, tx, ty)) === null);
  check('nor is somebody the server cannot place',
    revealScent(h, tx, ty, { steam: 'H3', species: 'Rex' }) === null);

  check('and it stays plain ASCII, since the mod drops the rest',
    /^[ -~]*$/.test(south), south);
}

// ---- paying the people who turned up ----------------------------------------

{
  // Chasing is recorded as it happens, because bands are current state and are
  // cleared the moment somebody drifts back out. The evening is over by the
  // time anybody counts.
  const h = base();
  const step = proximityStep(h, [at(TARGET, 0, 0), at(HUNTER, 30_000, 0)]);
  check('a hunter who closes in is remembered',
    step.hunt.chased.includes(HUNTER), JSON.stringify(step.hunt.chased));

  const wandered = proximityStep(step.hunt, [at(TARGET, 0, 0), at(HUNTER, 900_000, 0)]);
  check('and stays remembered after they drift away',
    wandered.hunt.chased.includes(HUNTER), JSON.stringify(wandered.hunt.chased));
  check('while the live band is cleared', wandered.hunt.bands[HUNTER] === undefined);

  check('somebody who never got close is not counted',
    !step.hunt.chased.includes('76561198000000009'));
}

{
  const OTHER = '76561198000000003';
  const FRIEND = '76561198000000004';

  const h = base({ reward: 1500, chased: [HUNTER, OTHER, FRIEND, TARGET], company: [FRIEND] });
  const owed = participants(h, HUNTER);
  const ids = owed.map((r) => r.steam);

  check('the winner is not paid twice', !ids.includes(HUNTER), JSON.stringify(ids));
  check('the quarry is not paid for being chased', !ids.includes(TARGET));
  check('the quarry\'s company is not paid either', !ids.includes(FRIEND));
  check('and everybody else who chased is', ids.includes(OTHER), JSON.stringify(ids));

  check('a tenth of the prize', participationAward(1500) === 150,
    String(participationAward(1500)));
  check('but never trivial', participationAward(100) === PARTICIPATION_MIN,
    String(participationAward(100)));
  check('and never more than winning',
    participationAward(1500) < 1500 && participationAward(300) < 300);
}

{
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'hunt4.sqlite'));
  const ctx = { db };
  const OTHER = '76561198000000003';

  // Surviving still pays the chasers: they spent the evening on it either way,
  // and an event that pays nothing unless somebody dies is one people stop
  // turning up to.
  const h = base({ reward: 1000, chased: [HUNTER, OTHER] });
  const paid = payParticipants(ctx, h);

  check('everybody who chased is paid when the quarry survives', paid.paid === 2,
    JSON.stringify(paid));
  check('and it lands in their balance', db.pointsFor(HUNTER).balance === 100,
    String(db.pointsFor(HUNTER).balance));

  // With a winner, one fewer.
  const withWinner = payParticipants(ctx, h, HUNTER);
  check('and with a winner they are one short', withWinner.paid === 1);
  check('the winner getting nothing extra', db.pointsFor(HUNTER).balance === 100,
    String(db.pointsFor(HUNTER).balance));

  const nobody = payParticipants(ctx, base({ reward: 1000 }));
  check('a hunt nobody chased pays nobody', nobody.paid === 0, JSON.stringify(nobody));

  db.close();
}

// ---- is the quarry even here ------------------------------------------------

{
  // A hunt whose target logged off looks exactly like one where nobody has
  // found them yet: no position calls, no kill, then "survived". Hunters comb
  // an empty island and blame the bot.
  const h = base();
  const online = [at(TARGET, 0, 0)];

  check('present and nothing to say', presenceStep(h, online, NOW).announce === null);
  check('and nothing to save either', presenceStep(h, online, NOW).changed === false);

  // Vanishing starts a clock but says nothing: a respawn or a loading screen
  // looks identical for a few seconds.
  const first = presenceStep(h, [], NOW);
  check('vanishing starts a clock quietly',
    first.announce === null && first.changed === true
    && typeof first.hunt.goneSince === 'number', JSON.stringify(first));

  const tooSoon = presenceStep(first.hunt, [], NOW + 5_000);
  check('and a brief absence is not announced', tooSoon.announce === null);

  const gone = presenceStep(first.hunt, [], NOW + GONE_AFTER_MS);
  check('a long absence is', gone.announce === 'gone', JSON.stringify(gone));

  // Once said, it must not be said every five seconds for the rest of the hunt.
  const again = presenceStep(gone.hunt, [], NOW + GONE_AFTER_MS + 60_000);
  check('but only once', again.announce === null && again.changed === false,
    JSON.stringify(again));

  const back = presenceStep(gone.hunt, online, NOW + GONE_AFTER_MS + 90_000);
  check('coming back is announced', back.announce === 'back');
  check('and the bookkeeping is cleared',
    back.hunt.goneSince === undefined && back.hunt.goneTold === undefined,
    JSON.stringify(back.hunt));

  // Somebody who blinked out and back before anyone was told gets no fanfare.
  const quiet = presenceStep(first.hunt, online, NOW + 5_000);
  check('a blink is not worth announcing either way', quiet.announce === null,
    JSON.stringify(quiet));

  // A target who is on the server but whose position the server will not give
  // counts as gone: there is nothing to call out either way.
  const noPosition = presenceStep(h, [{ steam: TARGET, species: 'Rex' }], NOW);
  check('unlocatable counts as away', noPosition.changed === true,
    JSON.stringify(noPosition));

  check('both announcements are plain ASCII, since RCON drops the rest',
    /^[ -~]*$/.test(goneAnnounce(h)) && /^[ -~]*$/.test(backAnnounce(h)),
    `${goneAnnounce(h)} / ${backAnnounce(h)}`);
}

{
  // The live card. The static one says what the hunt IS; during a hunt what
  // matters is whether the quarry is on the island at all.
  const h = base({ company: ['a', 'b'] });

  const away = buildHuntStatusEmbed(h, { online: false, nearest: null, companyCount: 2 }).data;
  check('an absent quarry is the headline, not a footnote',
    away.description.includes('Not on the island'), away.description);
  check('and the card turns red', away.color === 0xed4245, String(away.color));
  check('barred hunters are counted',
    JSON.stringify(away.fields).includes('2'), JSON.stringify(away.fields));

  const here = buildHuntStatusEmbed(h, {
    online: true, x: 120_000, y: -40_000, species: 'Allosaurus', nearest: 6, companyCount: 0,
  }).data;
  const field = (part) => here.fields.find((f) => f.name.includes(part));
  check('a present quarry shows what they are on',
    here.description.includes('Allosaurus'), here.description);
  check('and where', field('Where').value.includes('-40') && field('Where').value.includes('120'),
    field('Where').value);
  check('and warns when somebody is on top of them',
    field('Nearest').value.includes('right on top'), field('Nearest').value);
  check('with nobody barred said plainly',
    field('Barred').value === 'nobody', field('Barred').value);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
