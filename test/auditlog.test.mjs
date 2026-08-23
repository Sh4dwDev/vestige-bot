// The staff action log.
//
// An audit trail is only worth having if it cannot be quietly incomplete, so
// what gets tested is the awkward half: refusals, failures, and the values
// somebody actually typed rather than just the command name.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const {
  auditChannel, setAuditChannel, buildAuditEmbed, describeOptions, writeAudit,
} = await load('auditlog.js');
const { Database } = await load('db.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vesta-')), 'audit.sqlite');
const db = new Database(file);
const ctx = { db };

const USER = '111222333444555666';

// ---- the channel ------------------------------------------------------------

{
  check('nothing is logged until a channel is set', auditChannel(ctx) === null);
  setAuditChannel(ctx, '999');
  check('and then it is', auditChannel(ctx) === '999');
  setAuditChannel(ctx, null);
  check('and it can be turned off again', auditChannel(ctx) === null);
}

// ---- what was typed ---------------------------------------------------------

/** An interaction shaped like the one discord.js hands over. */
const interaction = (data) => ({ options: { data } });

{
  // A group and subcommand arrive as nested options; only the leaves are the
  // values somebody typed.
  const nested = describeOptions(interaction([
    { name: 'give', options: [{ name: 'points', options: [
      { name: 'user', value: '76561198000000001' },
      { name: 'amount', value: 5000 },
    ] }] },
  ]));
  check('the values are recorded, not just the command',
    /amount: 5000/.test(nested), nested);
  check('and the target as well', /76561198000000001/.test(nested), nested);

  const flat = describeOptions(interaction([
    { name: 'minutes', value: 60 },
  ]));
  check('a flat option is recorded too', /minutes: 60/.test(flat), flat);

  const none = describeOptions(interaction([{ name: 'status', options: [] }]));
  check('a command with no options renders empty rather than odd', none === '', none);

  // Discord refuses an embed field over 1024, so a long paste must not make the
  // whole log entry fail to send.
  const huge = describeOptions(interaction([
    { name: 'reason', value: 'x'.repeat(5000) },
  ]));
  check('a very long value is truncated, not dropped',
    huge.length <= 1024 && huge.length > 100, String(huge.length));
}

// ---- the embed --------------------------------------------------------------

{
  const ok = buildAuditEmbed({
    userId: USER, command: 'admin', group: 'give', action: 'points',
    options: 'amount: 5000', outcome: 'ok',
  }).toJSON();

  check('it names who did it', new RegExp(USER).test(ok.description ?? ''), ok.description);
  check('and the full command path',
    /\/admin give points/.test(ok.description ?? ''), ok.description);
  check('and what they passed', /5000/.test(JSON.stringify(ok.fields ?? [])));

  // A mention stops resolving once somebody leaves the server, and a log that
  // forgets who did something is not a log.
  check('the raw id survives them leaving the server',
    new RegExp(USER).test(ok.footer?.text ?? ''), ok.footer?.text);

  const denied = buildAuditEmbed({
    userId: USER, command: 'admin', group: 'give', action: 'points',
    options: '', outcome: 'denied',
  }).toJSON();
  check('a refusal is recorded', /Refused/.test(denied.title ?? ''), denied.title);
  check('and is coloured differently from a success', denied.color !== ok.color);

  const failed = buildAuditEmbed({
    userId: USER, command: 'admin', group: 'shop', action: 'give',
    options: '', outcome: 'failed', detail: 'the server did not answer',
  }).toJSON();
  check('a failure says why',
    /did not answer/.test(JSON.stringify(failed.fields ?? [])), JSON.stringify(failed.fields));
  check('and is its own colour again',
    failed.color !== ok.color && failed.color !== denied.color);

  check('every shape fits Discord limits',
    [ok, denied, failed].every((e) =>
      JSON.stringify(e).length < 6000
      && (e.fields ?? []).every((f) => f.value.length <= 1024)));

  // /setup shares the dispatcher, so it has to read correctly too.
  const setup = buildAuditEmbed({
    userId: USER, command: 'setup', group: 'referrals', action: 'on',
    options: '', outcome: 'ok',
  }).toJSON();
  check('setup commands read correctly', /\/setup referrals on/.test(setup.description ?? ''),
    setup.description);
}

// ---- sending ----------------------------------------------------------------

{
  const sent = [];
  const client = {
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async (payload) => { sent.push(payload); },
      }),
    },
  };

  setAuditChannel(ctx, '999');
  await writeAudit(ctx, client, {
    userId: USER, command: 'admin', group: 'bot', action: 'add', options: '', outcome: 'ok',
  });
  check('an entry is sent', sent.length === 1);
  // Pinging staff for their own actions would make the channel unusable to the
  // people who work in it.
  check('and nobody is pinged',
    JSON.stringify(sent[0].allowedMentions) === JSON.stringify({ parse: [] }));

  setAuditChannel(ctx, null);
  await writeAudit(ctx, client, {
    userId: USER, command: 'admin', options: '', outcome: 'ok',
  });
  check('with no channel set nothing is sent', sent.length === 1);
}

{
  // A deleted channel or lost permission must not fail the command that was
  // being logged.
  setAuditChannel(ctx, '999');
  const broken = { channels: { fetch: async () => { throw new Error('unknown channel'); } } };
  let threw = false;
  try {
    await writeAudit(ctx, broken, {
      userId: USER, command: 'admin', options: '', outcome: 'ok',
    });
  } catch {
    threw = true;
  }
  check('a broken log channel never throws at the caller', !threw);
}

db.close();
fs.rmSync(path.dirname(file), { recursive: true, force: true });

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
