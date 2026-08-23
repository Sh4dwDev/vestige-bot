// Discord's command size limit.
//
// /admin registration failed live with APPLICATION_COMMAND_TOO_LARGE after a
// feature pushed it to 8004 of the 8000 allowed. The failure happens at
// registration, which is a separate step from the build and the tests, so it
// was invisible until a deploy — this moves it into `pnpm verify`.
//
// Discord counts the sum of every name, description, choice name and choice
// value across the whole command tree, not the JSON length.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const { commandData } = await import(
  pathToFileURL(path.join(root, 'dist/commands.js')).href
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const LIMIT = 8000;

/**
 * Warn well before the wall.
 *
 * A test that only fails at 8000 lets somebody land a change at 7999 and hands
 * the failure to whoever writes the next line. The gap is deliberately wide
 * enough for one ordinary subcommand.
 */
const HEADROOM = 200;

const size = (o) => {
  let n = (o.name?.length ?? 0) + (o.description?.length ?? 0);
  for (const c of o.choices ?? []) n += (c.name?.length ?? 0) + String(c.value ?? '').length;
  for (const c of o.options ?? []) n += size(c);
  return n;
};

for (const command of commandData) {
  const json = typeof command.toJSON === 'function' ? command.toJSON() : command;
  const total = size(json);

  check(`/${json.name} is within Discord's limit`, total <= LIMIT,
    `${total} of ${LIMIT}`);
  check(`/${json.name} has room for another subcommand`, total <= LIMIT - HEADROOM,
    `${total} of ${LIMIT}, ${LIMIT - total} left`);
}

// Discord also caps the direct children of one command at 25.
for (const command of commandData) {
  const json = typeof command.toJSON === 'function' ? command.toJSON() : command;
  const children = (json.options ?? []).length;
  check(`/${json.name} is within the 25 subcommand limit`, children <= 25,
    `${children} of 25`);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
