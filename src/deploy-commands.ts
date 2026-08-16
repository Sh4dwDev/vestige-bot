import { REST, Routes } from 'discord.js';

import { commandData } from './commands.js';
import { loadConfig } from './config.js';

/**
 * Registers slash commands to **every guild the bot has joined**.
 *
 * Guild commands appear instantly, where global ones take up to an hour — but
 * naming a single guild in config meant a second server silently had no
 * commands at all, with nothing to indicate why. Asking Discord which guilds
 * the bot is actually in removes that failure entirely: join a server, re-run
 * this, done.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST({ version: '10' }).setToken(config.discord.token);

  // The application ID is derivable from the token, so nobody has to copy it
  // out of the developer portal.
  let clientId = config.discord.clientId;
  if (!clientId) {
    const app = (await rest.get(Routes.oauth2CurrentApplication())) as { id: string };
    clientId = app.id;
    console.log(`resolved application ID ${clientId} from the bot token`);
  }

  const guilds = (await rest.get(Routes.userGuilds())) as Array<{ id: string; name: string }>;

  if (guilds.length === 0) {
    console.error('The bot is not in any server yet. Invite it first.');
    process.exit(1);
  }

  let failures = 0;

  for (const guild of guilds) {
    try {
      const result = (await rest.put(
        Routes.applicationGuildCommands(clientId, guild.id),
        { body: commandData },
      )) as unknown[];
      console.log(`  ${guild.name} (${guild.id}): ${result.length} command(s)`);
    } catch (err) {
      failures += 1;
      const missingAccess = err instanceof Error && /Missing Access|50001/.test(err.message);
      console.error(`  ${guild.name} (${guild.id}): FAILED — ${
        missingAccess
          ? 'the bot was invited without the applications.commands scope'
          : err instanceof Error ? err.message : String(err)
      }`);
    }
  }

  if (failures > 0) {
    // Re-inviting over an existing membership just adds the scope; it does not
    // remove the bot or its roles.
    console.error(
      `\n${failures} server(s) failed. If that is a scope problem, re-invite with:\n` +
      `https://discord.com/api/oauth2/authorize?client_id=${clientId}` +
      '&permissions=277025508352&scope=bot%20applications.commands',
    );
    process.exit(1);
  }

  console.log(`\nregistered to ${guilds.length} server(s)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
