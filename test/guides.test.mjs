// The two reference embeds that sit permanently in a channel.
//
// The point of most of these checks is drift: a help panel that quietly stops
// matching the bot is worse than no help panel, because people trust it.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const load = (f) => import(pathToFileURL(path.join(root, 'dist', f)).href);

const { buildStorageGuideEmbed, buildCommandsEmbed, STAFF_COMMANDS } = await load('guides.js');
const { commandData } = await load('commands.js');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Discord rejects an oversized embed outright, so the panel would just never appear. */
function checkLimits(label, json) {
  const fields = json.fields ?? [];
  check(`${label}: title within 256`, (json.title ?? '').length <= 256);
  check(`${label}: description within 4096`, (json.description ?? '').length <= 4096,
    `${(json.description ?? '').length}`);
  check(`${label}: at most 25 fields`, fields.length <= 25, `${fields.length}`);
  check(`${label}: every field name within 256`, fields.every((f) => f.name.length <= 256));
  check(`${label}: every field value within 1024`, fields.every((f) => f.value.length <= 1024),
    `longest ${Math.max(0, ...fields.map((f) => f.value.length))}`);
  check(`${label}: total within 6000`, JSON.stringify(json).length <= 6000,
    `${JSON.stringify(json).length}`);
}

const guide = buildStorageGuideEmbed().toJSON();
const commands = buildCommandsEmbed().toJSON();
const text = (json) => JSON.stringify(json);

checkLimits('guide', guide);
checkLimits('commands', commands);

// The guide exists to stop people losing a dinosaur by surprise, so the three
// facts that cost them one must actually be in it.
check('the guide warns the dinosaur dies', /dies|die\b/i.test(text(guide)));
check('the guide states the growth requirement', /fully grown/i.test(text(guide)));
check('the guide states the slot limit', /three vaults/i.test(text(guide)));
check('the guide explains same-species restore', /same species/i.test(text(guide)));
check('the guide explains linking first', /\/link/.test(text(guide)));

// Drift guard: every PLAYER command the bot registers has to be documented.
{
  const player = commandData.map((c) => c.name).filter((n) => !STAFF_COMMANDS.has(n));
  const missing = player.filter((name) => !text(commands).includes(`/${name}`));

  check('every player command is documented', missing.length === 0,
    missing.length ? `undocumented: ${missing.join(', ')}` : `${player.length} commands`);
}

// The panel is pinned in a public channel, so staff commands must stay out of it.
{
  const leaked = [...STAFF_COMMANDS].filter((name) => text(commands).includes(`/${name}`));
  check('staff commands are not shown to players', leaked.length === 0,
    leaked.length ? `leaked: ${leaked.join(', ')}` : 'none');
}

// And the reverse: nothing documented that no longer exists.
{
  const registered = new Set(commandData.map((c) => c.name).filter((n) => !STAFF_COMMANDS.has(n)));
  const mentioned = [...text(commands).matchAll(/\\?\/([a-z]+)/g)].map((m) => m[1]);
  const ghosts = [...new Set(mentioned)].filter((name) => !registered.has(name));

  check('no command is documented that does not exist', ghosts.length === 0,
    ghosts.length ? `stale: ${ghosts.join(', ')}` : 'none');
}

check('the in-game commands are documented',
  /!discord/.test(text(commands)) && /!link/.test(text(commands)));

check('both embeds are signed', /Vesta/.test(guide.footer?.text ?? '') &&
  /Vesta/.test(commands.footer?.text ?? ''));

// The link form. Seventeen digits is a lot to type into a slash command box,
// so /link with no argument opens a modal instead.
{
  const { buildLinkModal, LINK_MODAL_ID } = await load('commands.js');
  const modal = buildLinkModal().toJSON();

  check('the form is titled like the thing it asks for',
    modal.title === 'Steam ID', modal.title);
  check('it has exactly one field', modal.components.length === 1);

  const field = modal.components[0].components[0];
  check('the field asks for a Steam ID', /Steam ID/i.test(field.label), field.label);
  check('and says how long one is', /17/.test(field.placeholder ?? ''), field.placeholder);
  check('it is required', field.required === true);
  check('and only accepts a 17 digit value',
    field.min_length === 17 && field.max_length === 17,
    `${field.min_length}-${field.max_length}`);
  check('the submission is routed by a stable id', LINK_MODAL_ID === modal.custom_id);
}

// /link still takes an argument, so nothing that already worked stops working.
{
  const link = commandData.find((c) => c.name === 'link');
  const option = (link.options ?? [])[0];
  check('the steamid option is now optional', option.required === false);
  check('but still bounded to 17 characters',
    option.min_length === 17 && option.max_length === 17);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
