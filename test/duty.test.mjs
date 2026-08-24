// Staff duty sessions.
//
// The record is the point of this feature, so the tests are about the record:
// that it cannot be doubled, cannot be reopened, cannot lose its duration, and
// closes itself when nobody presses the button.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  goOnDuty, goOffDuty, formatDuration, durationBetween, nextSessionId, rankOf,
  isStaff, isSenior, setDutySetting, maxHours, buildDutyPanel, dutyPanelRows,
  dutyRanks, upsertDutyRank, removeDutyRank, setDutyRanks,
  buildActiveEmbed, buildHistoryEmbed, buildStartLog, buildEndLog, stamp,
} = await load('duty.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'duty.sqlite');
const db = new Database(file);
const ctx = { db };

const STAFF = 'discord-staff';
const SENIOR = 'discord-senior';
const STEAM = '76561198000000001';

setDutySetting(ctx, 'staffRole', 'role-staff');
setDutySetting(ctx, 'seniorRole', 'role-senior');
setDutySetting(ctx, 'onDutyRole', 'role-onduty');
db.saveLink(STAFF, STEAM);
db.saveLink(SENIOR, '76561198000000002');

/** A Discord member, with just enough of one for the role calls. */
function member(id, { addFails = false, removeFails = false } = {}) {
  const roles = new Set();
  return {
    id,
    roles: {
      cache: { has: (r) => roles.has(r) },
      add: async (r) => { if (addFails) throw new Error('missing permission'); roles.add(r); },
      remove: async (r) => {
        if (removeFails) throw new Error('missing permission');
        roles.delete(r);
      },
    },
    _has: () => roles.has('role-onduty'),
  };
}

const quiet = () => {};

// ---- who may use it ---------------------------------------------------------

{
  check('a staff role admits somebody', isStaff(ctx, ['role-staff']));
  check('so does a senior role on its own', isStaff(ctx, ['role-senior']),
    'forgetting the base role should not lock somebody out of their own panel');
  check('a random member is not staff', !isStaff(ctx, ['role-member']));
  check('and nor is somebody with no roles', !isStaff(ctx, []));

  check('senior is recognised', isSenior(ctx, ['role-senior']));
  check('ordinary staff are not senior', !isSenior(ctx, ['role-staff']));
}

// ---- several ranks ----------------------------------------------------------
//
// Staff are not one rank. A trial mod, a moderator and a head admin all need
// the panel, and a log that called them all "Staff" would be useless for
// supervision.

{
  // Legacy first: a server set up before ranks existed must keep working
  // without being touched.
  const legacy = dutyRanks(ctx);
  check('the old single-role setup still yields ranks', legacy.length === 2,
    JSON.stringify(legacy));
  check('and the senior one is first', legacy[0]?.label === 'Head Admin');

  upsertDutyRank(ctx, { roleId: 'role-trial', label: 'Trial Mod', level: 5, canForceOff: false });
  upsertDutyRank(ctx, { roleId: 'role-mod', label: 'Moderator', level: 20, canForceOff: false });
  upsertDutyRank(ctx, { roleId: 'role-head', label: 'Head Admin', level: 90, canForceOff: true });

  const ranks = dutyRanks(ctx);
  check('every rank is kept', ranks.length === 3, JSON.stringify(ranks.map((r) => r.label)));
  check('and they are sorted most senior first',
    ranks.map((r) => r.label).join(',') === 'Head Admin,Moderator,Trial Mod',
    ranks.map((r) => r.label).join(','));

  check('any configured rank may use the panel',
    isStaff(ctx, ['role-trial']) && isStaff(ctx, ['role-mod']) && isStaff(ctx, ['role-head']));
  check('and somebody with none may not', !isStaff(ctx, ['role-member']));

  // Only the rank that says so may act on other people.
  check('a head admin may end other sessions', isSenior(ctx, ['role-head']));
  check('a moderator may not', !isSenior(ctx, ['role-mod']));
  check('nor a trial mod', !isSenior(ctx, ['role-trial']));

  // Somebody holding two is described by the higher one.
  check('the higher rank labels a multi-role member',
    rankOf(['role-trial', 'role-head'], ranks.map((r) => ({ roleId: r.roleId, label: r.label })))
      === 'Head Admin');

  // Re-adding a role updates it rather than duplicating.
  upsertDutyRank(ctx, { roleId: 'role-mod', label: 'Senior Mod', level: 50, canForceOff: true });
  const updated = dutyRanks(ctx);
  check('re-adding a role replaces it', updated.length === 3,
    JSON.stringify(updated.map((r) => r.label)));
  check('with the new label and powers',
    updated.find((r) => r.roleId === 'role-mod')?.label === 'Senior Mod'
    && isSenior(ctx, ['role-mod']));

  const after = removeDutyRank(ctx, 'role-trial');
  check('a rank can be removed', after.length === 2);
  check('and its holders lose access', !isStaff(ctx, ['role-trial']));

  // Unreadable settings must not lock every staff member out.
  db.setSetting('duty_ranks', 'not json');
  check('broken rank settings fall back to the legacy pair',
    dutyRanks(ctx).length === 2, JSON.stringify(dutyRanks(ctx)));

  setDutyRanks(ctx, [
    { roleId: 'role-staff', label: 'Staff', level: 10, canForceOff: false },
    { roleId: 'role-senior', label: 'Head Admin', level: 90, canForceOff: true },
  ]);
}

// ---- rank labels ------------------------------------------------------------

{
  const ranks = [
    { roleId: 'role-senior', label: 'Head Admin' },
    { roleId: 'role-staff', label: 'Staff' },
  ];
  check('the higher rank wins when somebody holds both',
    rankOf(['role-staff', 'role-senior'], ranks) === 'Head Admin');
  check('and the base rank otherwise', rankOf(['role-staff'], ranks) === 'Staff');
  check('somebody unranked still gets a label', rankOf([], ranks) === 'Staff');
}

// ---- duration ---------------------------------------------------------------

{
  check('a duration renders as HH:MM:SS', formatDuration(8077) === '02:14:37',
    formatDuration(8077));
  check('under a minute still pads', formatDuration(5) === '00:00:05');
  check('over a day keeps counting hours', formatDuration(90000) === '25:00:00');
  check('a negative duration is clamped rather than rendered backwards',
    formatDuration(-10) === '00:00:00');

  // From the stored instants, never from message timestamps: an edit, a retry
  // or a clock change would each give a different answer.
  check('duration comes from the two UTC instants',
    durationBetween('2026-08-24T10:00:00.000Z', '2026-08-24T12:14:37.000Z') === 8077);

  // Oslo goes from +02:00 to +01:00 on this night. Stored in UTC, the real
  // elapsed time is three hours whatever the wall clock did.
  check('a daylight-saving change does not distort it',
    durationBetween('2026-10-25T00:00:00.000Z', '2026-10-25T03:00:00.000Z') === 10800);

  check('an end before the start is clamped, not negative',
    durationBetween('2026-08-24T12:00:00.000Z', '2026-08-24T11:00:00.000Z') === 0);
}

// ---- session ids ------------------------------------------------------------

{
  const day = new Date('2026-08-24T10:00:00.000Z');
  check('a session id carries the date', nextSessionId(ctx, day) === 'DUTY-20260824-0001',
    nextSessionId(ctx, day));
}

// ---- going on and off -------------------------------------------------------

{
  const m = member(STAFF);
  const started = await goOnDuty(ctx, m, 'Staff', 'panel', quiet);

  check('staff can go on duty', started.ok === true, started.ok ? '' : started.reason);
  check('the on-duty role goes on', m._has());
  check('the session records how it began', started.session.startMethod === 'panel');
  check('and the linked Steam account', started.session.steamId === STEAM);
  check('it is active', started.session.status === 'active');
  check('and findable as the open one', db.activeDuty(STAFF)?.sessionId === started.session.sessionId);

  // Double-click, or panel and slash command at once. The unique index decides.
  const again = await goOnDuty(ctx, m, 'Staff', 'command', quiet);
  check('pressing it twice does not open a second session', again.ok === false);
  check('and says why', /already on duty/i.test(again.reason), again.reason);
  check('still exactly one active', db.allActiveDuty().length === 1);

  const ended = await goOffDuty(ctx, m, STAFF, 'Staff went off duty', quiet);
  check('and they can go off again', ended.ok === true, ended.ok ? '' : ended.reason);
  check('the role comes off', !m._has());
  check('the session is closed', ended.session.status === 'ended');
  check('with a duration recorded', typeof ended.session.durationSeconds === 'number');
  check('and the reason kept', ended.session.endReason === 'Staff went off duty');

  // The same completion arriving twice must not overwrite a recorded duration.
  const twice = await goOffDuty(ctx, m, STAFF, 'Staff went off duty', quiet);
  check('closing it twice is refused', twice.ok === false);
  check('nobody is left on duty', db.allActiveDuty().length === 0);
}

{
  // A session is never deleted, only closed — otherwise a session that
  // vanished looks exactly like one that never happened.
  check('the closed session is still on record', db.dutyHistory(STAFF, 10).length >= 1);
}

// ---- the awkward cases ------------------------------------------------------

{
  const stranger = member('discord-unlinked');
  const attempt = await goOnDuty(ctx, stranger, 'Staff', 'panel', quiet);
  check('somebody with no linked Steam cannot start', attempt.ok === false);
  check('and is told to link first', /link/i.test(attempt.reason), attempt.reason);
  check('no session was opened', db.allActiveDuty().length === 0);
}

{
  // A role that will not apply must not cost the record: the session is the
  // durable thing and the role is a picture of it.
  const m = member(STAFF, { addFails: true });
  const started = await goOnDuty(ctx, m, 'Staff', 'panel', quiet);
  check('a failed role grant still opens the session', started.ok === true,
    started.ok ? '' : started.reason);
  check('even though the role is not on', !m._has());

  const m2 = member(STAFF, { removeFails: true });
  const ended = await goOffDuty(ctx, m2, STAFF, 'Staff went off duty', quiet);
  check('and a failed role removal still closes it', ended.ok === true);
  check('so nobody is stuck on duty in the record', db.allActiveDuty().length === 0);
}

{
  const nobody = await goOffDuty(ctx, member(STAFF), STAFF, 'Staff went off duty', quiet);
  check('going off duty when not on duty is refused', nobody.ok === false);
}

{
  // Two people at once must not collide: the index is per person, not global.
  const a = member(STAFF);
  const b = member(SENIOR);
  const [one, two] = await Promise.all([
    goOnDuty(ctx, a, 'Staff', 'panel', quiet),
    goOnDuty(ctx, b, 'Head Admin', 'panel', quiet),
  ]);
  check('two staff can be on duty at the same time', one.ok && two.ok);
  check('and both are counted', db.allActiveDuty().length === 2);

  const forced = await goOffDuty(ctx, b, SENIOR, 'Forced off duty by senior staff', quiet);
  check('a forced ending is recorded like any other', forced.ok === true);
  check('with its own reason',
    forced.session.endReason === 'Forced off duty by senior staff');

  await goOffDuty(ctx, a, STAFF, 'Staff went off duty', quiet);
  check('and the room empties', db.allActiveDuty().length === 0);
}

// ---- what people see --------------------------------------------------------

{
  const panel = buildDutyPanel().toJSON();
  check('the panel explains going on duty', /Go On Duty/.test(JSON.stringify(panel.fields)));
  // The honest bit: it must not imply powers are being switched.
  check('and states plainly that it does not change in-game powers',
    /does not change your in-game powers/i.test(JSON.stringify(panel.fields)));
  check('it fits Discord limits',
    JSON.stringify(panel).length < 6000
    && (panel.fields ?? []).every((f) => f.value.length <= 1024));

  const ids = dutyPanelRows().flatMap((r) =>
    r.toJSON().components.map((c) => c.custom_id));
  check('all three buttons are there',
    ids.includes('duty:on') && ids.includes('duty:off') && ids.includes('duty:active'),
    ids.join(','));
}

{
  const empty = buildActiveEmbed([]).toJSON();
  check('an empty duty roster says so', /Nobody on duty/.test(empty.title ?? ''));

  const sessions = db.dutyHistory(STAFF, 10);
  const history = buildHistoryEmbed(sessions, STAFF).toJSON();
  check('history lists sessions', (history.fields ?? []).length > 0);
  check('and fits Discord limits',
    JSON.stringify(history).length < 6000
    && (history.fields ?? []).every((f) => f.value.length <= 1024));

  const none = buildHistoryEmbed([], 'discord-nobody').toJSON();
  check('somebody who never served is not an error',
    /never been on duty/.test(none.description ?? ''));
}

{
  const [session] = db.dutyHistory(STAFF, 1);
  const start = buildStartLog(session, 'Shadow').toJSON();
  check('the start log carries the session id',
    JSON.stringify(start).includes(session.sessionId));
  check('and the Steam account', JSON.stringify(start).includes(session.steamId));

  const end = buildEndLog(session, 'Shadow').toJSON();
  check('the completed log shows a duration',
    /\d\d:\d\d:\d\d/.test(JSON.stringify(end.fields)));
  check('and how it ended', JSON.stringify(end).includes(session.endReason ?? ''));

  // Discord renders this per viewer, which beats choosing a timezone for
  // everybody.
  check('times are Discord timestamps', /^<t:\d+:F>$/.test(stamp(session.startedAtUtc)),
    stamp(session.startedAtUtc));
}

// ---- limits -----------------------------------------------------------------

{
  check('there is a default session limit', maxHours(ctx) === 4);
  setDutySetting(ctx, 'maxHours', '2');
  check('and it can be changed', maxHours(ctx) === 2);
  setDutySetting(ctx, 'maxHours', '');
  check('a blank falls back to the default', maxHours(ctx) === 4);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
