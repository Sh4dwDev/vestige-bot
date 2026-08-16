import { REST, Routes } from 'discord.js';

import { commandData } from './commands.js';
import { loadConfig } from './config.js';

/**
 * Registers slash commands to one guild, which appear instantly — global ones
 * take up to an hour to propagate.
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

  const result = (await rest.put(
    Routes.applicationGuildCommands(clientId, config.discord.guildId),
    { body: commandData },
  )) as unknown[];

  console.log(`registered ${result.length} command(s) to guild ${config.discord.guildId}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
