import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clearCookie,
  newSecret,
  parseCookies,
  readSession,
  safeReturnPath,
  serializeCookie,
  signSession,
} from '../dist/websession.js';
import {
  apiError,
  displayPoints,
  originAllowed,
  toVaultSlot,
} from '../dist/webapi.js';

const SECRET = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

test('a session round trips', () => {
  const token = signSession('123456789012345678', Date.now() + 60_000, SECRET);
  assert.equal(readSession(token, SECRET), '123456789012345678');
});

test('a session signed with another secret is refused', () => {
  const token = signSession('123456789012345678', Date.now() + 60_000, OTHER);
  assert.equal(readSession(token, SECRET), null);
});

test('an expired session is refused', () => {
  const token = signSession('123456789012345678', Date.now() - 1, SECRET);
  assert.equal(readSession(token, SECRET), null);
});

test('editing the Discord ID invalidates the signature', () => {
  // The whole point of signing: swapping in somebody else's ID must not work,
  // because the site shows whatever account the token names.
  const token = signSession('123456789012345678', Date.now() + 60_000, SECRET);
  const forged = token.replace('123456789012345678', '999999999999999999');

  assert.notEqual(forged, token);
  assert.equal(readSession(forged, SECRET), null);
});

test('extending the expiry invalidates the signature', () => {
  const expires = Date.now() + 60_000;
  const token = signSession('123456789012345678', expires, SECRET);
  const forged = token.replace(String(expires), String(expires + 10_000_000));

  assert.equal(readSession(forged, SECRET), null);
});

test('rubbish tokens are refused rather than throwing', () => {
  for (const bad of [undefined, '', 'x', 'v1.1.2', 'v2.123456789012345678.999.sig',
    'v1..999.sig', 'v1.notanid.999.sig', '....']) {
    assert.equal(readSession(bad, SECRET), null, `should refuse ${JSON.stringify(bad)}`);
  }
});

test('secrets are long and different every time', () => {
  const a = newSecret();
  const b = newSecret();
  assert.equal(a.length, 64);
  assert.notEqual(a, b);
});

test('cookies parse, including junk from other apps', () => {
  const jar = parseCookies('vestige_session=abc; other=1; broken; =2; enc=a%20b');
  assert.equal(jar['vestige_session'], 'abc');
  assert.equal(jar['other'], '1');
  assert.equal(jar['enc'], 'a b');
  assert.equal(jar['broken'], undefined);
});

test('parsing survives no header at all', () => {
  assert.deepEqual(parseCookies(undefined), {});
});

test('cookies are HttpOnly and same-site by default', () => {
  const cookie = serializeCookie('vestige_session', 'v', { secure: true, maxAgeMs: 1000 });
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Max-Age=1/);
});

test('a cross-origin cookie is always Secure, even over http', () => {
  // Browsers reject SameSite=None without Secure, so this must not be left to
  // the caller: a dev setup on http would silently have no session at all.
  const cookie = serializeCookie('vestige_session', 'v', { secure: false, sameSite: 'None' });
  assert.match(cookie, /SameSite=None/);
  assert.match(cookie, /Secure/);
});

test('clearing a cookie expires it immediately', () => {
  assert.match(clearCookie('vestige_session', true), /Max-Age=0/);
});

test('only paths on this site are accepted as a return', () => {
  assert.equal(safeReturnPath('/vault'), '/vault');
  assert.equal(safeReturnPath('/vault?tab=1'), '/vault?tab=1');

  // Every one of these is an open redirect if it gets through.
  assert.equal(safeReturnPath('//evil.example'), '/');
  assert.equal(safeReturnPath('https://evil.example'), '/');
  assert.equal(safeReturnPath('/\\evil.example'), '/');
  assert.equal(safeReturnPath('/x\nLocation: y'), '/');
  assert.equal(safeReturnPath(null), '/');
  assert.equal(safeReturnPath(''), '/');
});

test('origins match exactly, never by prefix or suffix', () => {
  const allowed = ['https://vestige.example', 'http://localhost:5173'];

  assert.equal(originAllowed('https://vestige.example', allowed), true);
  assert.equal(originAllowed('http://localhost:5173', allowed), true);

  assert.equal(originAllowed('https://vestige.example.attacker.test', allowed), false);
  assert.equal(originAllowed('https://notvestige.example', allowed), false);
  assert.equal(originAllowed('http://vestige.example', allowed), false);
  assert.equal(originAllowed(undefined, allowed), false);
  assert.equal(originAllowed('https://vestige.example', []), false);
});

test('points are shown whole', () => {
  assert.equal(displayPoints(120.99), 120);
  assert.equal(displayPoints(0), 0);
});

test('a slot is trimmed to the contract', () => {
  const slot = toVaultSlot({
    slot: 'allo',
    species: 'Allosaurus',
    growth: 1.04,
    female: true,
    prime: true,
    elderStacks: 2.7,
    mutations: ['Cellular Regeneration', ''],
  });

  // Growth over 1 has been seen from the mod and would render as 104%.
  assert.equal(slot.growth, 1);
  assert.equal(slot.elderStacks, 2);
  assert.deepEqual(slot.mutations, ['Cellular Regeneration']);
  assert.equal(Object.keys(slot).length, 7);
});

test('errors carry a code a front end can switch on', () => {
  const err = apiError('not_linked', 'Run /link in Discord.');
  assert.equal(err.ok, false);
  assert.equal(err.code, 'not_linked');
  assert.equal(typeof err.reason, 'string');
});
