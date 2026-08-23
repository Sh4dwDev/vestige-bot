// Referrals pay real points, so the checks here are almost entirely about the
// ways somebody would try to pay themselves: alts, rejoins, self-invites, and
// claiming players who were already here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  collectPayouts, noteLink, whichInviteGrew, repairReferrals,
  referralReward, referralWelcome, referralMinutes, referralWeeklyCap,
  setReferralsEnabled, setReferralAmounts, referralsEnabled,
} = await load('referrals.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const fresh = () => {
  const db = new Database(
    path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'ref.sqlite'));
  const ctx = { db };
  setReferralsEnabled(ctx, true);
  return ctx;
};

/** Somebody who has linked and played enough to be worth paying for. */
const playedEnough = (ctx, steamId, minutes = 90) => {
  ctx.db.addPoints(steamId, 1, minutes);
};

// ---- working out who invited whom -----------------------------------------

{
  const before = new Map([['aaa', 3], ['bbb', 7]]);
  check('the code that went up is the one credited',
    whichInviteGrew(before, new Map([['aaa', 4], ['bbb', 7]])) === 'aaa');

  check('a brand new code counts',
    whichInviteGrew(before, new Map([['aaa', 3], ['bbb', 7], ['ccc', 1]])) === 'ccc');

  // Two joins between readings leaves two codes up. Crediting either is a
  // guess, and a wrong credit is worse than none at all.
  check('two codes up credits nobody',
    whichInviteGrew(before, new Map([['aaa', 4], ['bbb', 8]])) === null);

  check('nothing up credits nobody',
    whichInviteGrew(before, new Map([['aaa', 3], ['bbb', 7]])) === null);

  check('a deleted code does not look like a join',
    whichInviteGrew(before, new Map([['aaa', 3]])) === null);
}

// ---- the happy path -------------------------------------------------------

{
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000001');
  ctx.db.recordReferral('newbie', 'inviter');

  check('linking ties the account to the referral',
    noteLink(ctx, 'newbie', '76561190000000002') === 'attached');

  check('nothing is paid before they have played', collectPayouts(ctx).length === 0);

  playedEnough(ctx, '76561190000000002');
  const paid = collectPayouts(ctx);
  check('once they have played, the inviter is paid', paid.length === 1,
    JSON.stringify(paid));
  check('and the reward lands in their balance',
    ctx.db.pointsFor('76561190000000001').balance === referralReward(ctx),
    String(ctx.db.pointsFor('76561190000000001').balance));
  check('the newcomer gets the welcome bonus too',
    ctx.db.pointsFor('76561190000000002').balance > referralWelcome(ctx) - 1);

  // The whole row must settle, or the poll pays it again every minute.
  check('it is never paid twice', collectPayouts(ctx).length === 0);
  ctx.db.close();
}

// ---- the ways it would be farmed ------------------------------------------

{
  const ctx = fresh();
  ctx.db.saveLink('me', '76561190000000010');
  ctx.db.recordReferral('myalt', 'me');

  check('you cannot refer your own Steam account',
    noteLink(ctx, 'myalt', '76561190000000010') === 'self');
  ctx.db.close();
}

{
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000020');

  // Seen in game BEFORE the invite: they were here before anyone brought them.
  ctx.db.rememberNames([{ steamId: '76561190000000021', name: 'Regular' }]);
  ctx.db.recordReferral('regular', 'inviter');
  check('a player seen in game before the invite is not a referral',
    noteLink(ctx, 'regular', '76561190000000021') === 'existing');

  // Hours of playtime and no sighting on record: an established player.
  ctx.db.addPoints('76561190000000022', 10, 600);
  ctx.db.recordReferral('veteran', 'inviter');
  check('a player with hours behind them is not a referral either',
    noteLink(ctx, 'veteran', '76561190000000022') === 'existing');
  ctx.db.close();
}

{
  // The bug that made every referral fail. Linking is done by typing a code
  // IN GAME, so an invitee is always seen in game before they can link — and
  // the old check treated any sighting at all as proof they were an existing
  // player. Eleven referrals, none attached, none paid.
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000100');
  ctx.db.recordReferral('newcomer', 'inviter');

  // A real gap between joining the Discord and turning up on the server.
  // Timestamps are millisecond precision, and the two happening in the same
  // millisecond is a test artefact rather than anything that occurs in play.
  await new Promise((resolve) => { setTimeout(resolve, 5); });

  // Invited first, then turns up and plays a little before linking.
  ctx.db.rememberNames([{ steamId: '76561190000000101', name: 'Newcomer' }]);
  ctx.db.addPoints('76561190000000101', 5, 12);

  check('somebody first seen AFTER the invite is a real referral',
    noteLink(ctx, 'newcomer', '76561190000000101') === 'attached');
  ctx.db.close();
}

{
  // The fallback, for accounts older than the first_seen column: playtime
  // decides, and a first session is not enough to disqualify anybody.
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000110');
  ctx.db.recordReferral('shortplay', 'inviter');
  ctx.db.addPoints('76561190000000111', 5, 20);
  check('twenty minutes is a first session, not an existing player',
    noteLink(ctx, 'shortplay', '76561190000000111') === 'attached');
  ctx.db.close();
}

{
  // Repairing what the broken check rejected.
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000120');
  ctx.db.recordReferral('stuck', 'inviter');
  ctx.db.saveLink('stuck', '76561190000000121');

  check('a stuck referral has no Steam account', ctx.db.unattachedReferrals().length === 1);

  const done = repairReferrals(ctx);
  check('and the repair attaches it', done.attached === 1, JSON.stringify(done));
  check('so it is no longer stuck', ctx.db.unattachedReferrals().length === 0);

  // Running it twice must not double anything.
  const again = repairReferrals(ctx);
  check('repairing twice attaches nothing more', again.attached === 0);
  ctx.db.close();
}

{
  // The repair runs the same checks, so it cannot credit somebody who was
  // genuinely already playing.
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000130');
  ctx.db.rememberNames([{ steamId: '76561190000000131', name: 'Old hand' }]);
  ctx.db.recordReferral('oldhand', 'inviter');
  ctx.db.saveLink('oldhand', '76561190000000131');

  const done = repairReferrals(ctx);
  check('the repair refuses an existing player', done.attached === 0 && done.existing === 1,
    JSON.stringify(done));

  // And somebody who never linked is simply waiting, not refused.
  ctx.db.recordReferral('neverlinked', 'inviter');
  const waiting = repairReferrals(ctx);
  check('somebody who never linked is counted as waiting',
    waiting.unlinked === 1, JSON.stringify(waiting));
  ctx.db.close();
}

{
  const ctx = fresh();
  ctx.db.saveLink('a', '76561190000000030');
  ctx.db.saveLink('b', '76561190000000031');

  ctx.db.recordReferral('victim', 'a');
  check('the first referral attaches', noteLink(ctx, 'victim', '76561190000000032') === 'attached');

  // The rejoin attack: leave, come back on a new Discord account, get paid
  // again for the same game account.
  ctx.db.recordReferral('victim2', 'b');
  check('the same Steam account cannot be referred twice',
    noteLink(ctx, 'victim2', '76561190000000032') === 'already-referred');
  ctx.db.close();
}

{
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000040');
  ctx.db.recordReferral('newbie', 'inviter');
  noteLink(ctx, 'newbie', '76561190000000041');

  // Rejoining under the same Discord account must not re-open the referral.
  ctx.db.recordReferral('newbie', 'someone-else');
  const row = ctx.db.referralFor('newbie');
  check('the first inviter keeps the credit on a rejoin',
    row.inviterDiscord === 'inviter', row.inviterDiscord);
  ctx.db.close();
}

{
  const ctx = fresh();
  setReferralAmounts(ctx, { weekly: 2 });
  ctx.db.saveLink('farmer', '76561190000000050');

  for (let n = 0; n < 5; n += 1) {
    const steam = `7656119000000006${n}`;
    ctx.db.recordReferral(`alt${n}`, 'farmer');
    noteLink(ctx, `alt${n}`, steam);
    playedEnough(ctx, steam);
  }

  const paid = collectPayouts(ctx);
  check('the weekly cap holds', paid.length === 2, `${paid.length} paid`);
  check('and it does not simply defer them to the next poll',
    collectPayouts(ctx).length === 0);
  ctx.db.close();
}

// ---- awkward but honest cases ---------------------------------------------

{
  const ctx = fresh();
  // The inviter never linked, so there is no account to pay.
  ctx.db.recordReferral('newbie', 'ghost');
  noteLink(ctx, 'newbie', '76561190000000070');
  playedEnough(ctx, '76561190000000070');

  check('an unlinked inviter is not paid', collectPayouts(ctx).length === 0);
  // ...but the row must still settle, or it is retried forever.
  check('and the referral does not retry every poll',
    ctx.db.referralFor('newbie').paidAt !== null);
  ctx.db.close();
}

{
  const ctx = fresh();
  setReferralsEnabled(ctx, false);
  ctx.db.saveLink('inviter', '76561190000000080');
  ctx.db.recordReferral('newbie', 'inviter');

  check('nothing attaches while it is switched off',
    noteLink(ctx, 'newbie', '76561190000000081') === 'not-referred');
  check('and nothing pays out', collectPayouts(ctx).length === 0);
  check('the switch reads back', referralsEnabled(ctx) === false);
  ctx.db.close();
}

{
  const ctx = fresh();
  ctx.db.saveLink('inviter', '76561190000000090');
  ctx.db.recordReferral('newbie', 'inviter');
  noteLink(ctx, 'newbie', '76561190000000091');

  // Just under the line must not pay: the threshold is the whole guarantee
  // that a referral is somebody who actually played.
  playedEnough(ctx, '76561190000000091', referralMinutes(ctx) - 1);
  check('a minute short does not pay', collectPayouts(ctx).length === 0);

  ctx.db.addPoints('76561190000000091', 0, 1);
  check('and on the line does', collectPayouts(ctx).length === 1);
  ctx.db.close();
}

// ---- the defaults ---------------------------------------------------------

{
  const ctx = fresh();
  check('the reward is worth having', referralReward(ctx) >= 100);
  check('the newcomer gets less than the inviter',
    referralWelcome(ctx) < referralReward(ctx));
  check('an hour is the default bar', referralMinutes(ctx) === 60);
  check('there is a weekly cap by default', referralWeeklyCap(ctx) > 0);
  ctx.db.close();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
