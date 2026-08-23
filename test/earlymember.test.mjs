// Early Member: fifty seats, earned by playing rather than by joining Discord.
//
// The rule changed after the role already existed, so the risk is not who gets
// it next — it is whether anybody who already holds it loses it. Nothing here
// may ever take the role away.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  earlyMinutes, setEarlyMinutes, minutesPlayed, hasPlayedEnough,
  grantEarlyRole, DEFAULT_MINUTES,
} = await load('earlymember.js');
const { setEarlyRole } = await load('earlymember.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'early.sqlite');
const db = new Database(file);
const ctx = { db };

const ROLE = 'role-early';
const VETERAN = { discord: 'd-veteran', steam: '76561198000000001' };
const FRESH = { discord: 'd-fresh', steam: '76561198000000002' };
const UNLINKED = { discord: 'd-unlinked' };

setEarlyRole(ctx, ROLE);
db.saveLink(VETERAN.discord, VETERAN.steam);
db.saveLink(FRESH.discord, FRESH.steam);
db.addPoints(VETERAN.steam, 0, 120);
db.addPoints(FRESH.steam, 0, 5);

/** A Discord member, with just enough of one to satisfy the grant path. */
function member(id, { hasRole = false, bot = false, roleHolders = 0 } = {}) {
  const roles = new Set(hasRole ? [ROLE] : []);
  return {
    id,
    user: { bot },
    roles: {
      cache: { has: (r) => roles.has(r) },
      add: async (r) => { roles.add(r); },
    },
    guild: {
      roles: {
        cache: {
          get: () => ({ members: { size: roleHolders } }),
          has: () => true,
        },
      },
    },
    // Test-only view of what actually happened.
    _has: () => roles.has(ROLE),
  };
}

// ---- the setting ------------------------------------------------------------

{
  check('an hour is the default', earlyMinutes(ctx) === DEFAULT_MINUTES && DEFAULT_MINUTES === 60);

  setEarlyMinutes(ctx, 90);
  check('and it can be changed', earlyMinutes(ctx) === 90);

  setEarlyMinutes(ctx, 0);
  check('zero means no requirement at all', earlyMinutes(ctx) === 0);

  setEarlyMinutes(ctx, 60);
}

// ---- who has played enough --------------------------------------------------

{
  check('the veteran has the time', minutesPlayed(ctx, VETERAN.discord) === 120);
  check('the newcomer does not', minutesPlayed(ctx, FRESH.discord) === 5);

  // Null and zero are different answers, and conflating them would let an
  // unlinked member through the moment the requirement was set to zero.
  check('somebody unlinked is unknown, not zero',
    minutesPlayed(ctx, UNLINKED.discord) === null);

  check('enough time qualifies', hasPlayedEnough(120, 60));
  check('exactly the required time qualifies', hasPlayedEnough(60, 60));
  check('one minute short does not', !hasPlayedEnough(59, 60));
  check('unknown never qualifies, even with no requirement',
    !hasPlayedEnough(null, 0), 'an unlinked member has no playtime to judge');
}

// ---- granting ---------------------------------------------------------------

{
  const m = member(VETERAN.discord);
  check('somebody who has played the hour gets it',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'given');
  check('and really has the role', m._has());
}

{
  const m = member(FRESH.discord);
  check('somebody who has not is turned down',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'unqualified');
  check('and does not have the role', !m._has());
}

{
  // The whole point of the change: joining Discord is no longer enough.
  const m = member(UNLINKED.discord);
  check('an unlinked member gets nothing',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'unqualified');
}

{
  // Nobody who already holds it may lose it, whatever the rules became.
  const m = member(FRESH.discord, { hasRole: true });
  check('an existing holder who has not played keeps it',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'already');
  check('and still has the role', m._has());

  // Even with the seats full, and even at a stricter requirement than they met.
  setEarlyMinutes(ctx, 9999);
  const strict = member(FRESH.discord, { hasRole: true, roleHolders: 50 });
  check('a raised requirement does not take it back',
    (await grantEarlyRole(ctx, strict, 50, () => undefined)) === 'already');
  check('nor does a full cap', strict._has());
  setEarlyMinutes(ctx, 60);
}

{
  const m = member(VETERAN.discord, { roleHolders: 50 });
  check('the fifty-first qualified person is told the seats are gone',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'full');
  check('and does not get it', !m._has());
}

{
  // Checked before the cap: somebody who has not earned it must never be the
  // reason a seat is reported as taken.
  const m = member(FRESH.discord, { roleHolders: 50 });
  check('an unqualified member reports why, not that it is full',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'unqualified');
}

{
  const m = member(VETERAN.discord, { bot: true });
  check('bots are never given it',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'no-role');
}

{
  setEarlyRole(ctx, null);
  const m = member(VETERAN.discord);
  check('with no role configured nothing happens',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'no-role');
  setEarlyRole(ctx, ROLE);
}

{
  // Zero minutes is a real setting: it hands the role to anyone linked, which
  // is the old behaviour and has to still be reachable.
  setEarlyMinutes(ctx, 0);
  const m = member(FRESH.discord);
  check('no requirement gives it to anyone linked',
    (await grantEarlyRole(ctx, m, 50, () => undefined)) === 'given');

  const stranger = member(UNLINKED.discord);
  check('but still not to somebody unlinked',
    (await grantEarlyRole(ctx, stranger, 50, () => undefined)) === 'unqualified');
  setEarlyMinutes(ctx, 60);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
