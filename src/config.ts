function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new Error(`Missing required environment variable ${name}`);
  return value.trim();
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number, got "${raw}"`);
  return parsed;
}

export interface Config {
  discord: { token: string; clientId: string | null };
  rcon: { host: string; port: number; password: string };
  sftp: {
    host: string;
    port: number;
    username: string;
    password: string;
    /** The mod's Saved directory on the game server. */
    modDir: string;
  };
  databaseFile: string;
  linkCodeTtlMinutes: number;
  /** Game.ini on the game server — the file that holds AdminsSteamIDs. */
  gameIniPath: string;
  /** Sent to anyone who types `!discord` in game. Empty disables the command. */
  discordInvite: string;
  /**
   * The game host's control panel. Null when unset — scheduled restarts then
   * warn and save but cannot restart, because RCON has no such command.
   */
  panel: { url: string; apiKey: string; serverId: string } | null;
}

/** All three parts are needed or none of it works, so it is all-or-nothing. */
function panelConfig(): Config['panel'] {
  const url = process.env['PANEL_URL']?.trim();
  const apiKey = process.env['PANEL_API_KEY']?.trim();
  const serverId = process.env['PANEL_SERVER_ID']?.trim();

  if (!url && !apiKey && !serverId) return null;
  if (!url || !apiKey || !serverId) {
    throw new Error(
      'PANEL_URL, PANEL_API_KEY and PANEL_SERVER_ID must all be set, or all be blank',
    );
  }

  return { url, apiKey, serverId };
}

export function loadConfig(): Config {
  return {
    discord: {
      token: required('DISCORD_TOKEN'),
      // Derivable from the token, so it is optional.
      clientId: process.env['DISCORD_CLIENT_ID']?.trim() || null,
    },
    rcon: {
      host: required('RCON_HOST'),
      port: int('RCON_PORT', 8888),
      password: required('RCON_PASSWORD'),
    },
    sftp: {
      host: required('SFTP_HOST'),
      port: int('SFTP_PORT', 22),
      username: required('SFTP_USER'),
      password: required('SFTP_PASSWORD'),
      modDir: required('MOD_DIR'),
    },
    databaseFile: process.env['DATABASE_FILE'] ?? './data/storage.sqlite',
    linkCodeTtlMinutes: int('LINK_CODE_TTL_MINUTES', 10),
    // WindowsServer, not LinuxServer: the Windows build runs under Proton, and
    // that is the copy the server actually reads and rewrites.
    gameIniPath:
      process.env['GAME_INI_PATH']?.trim() ||
      '/TheIsle/Saved/Config/WindowsServer/Game.ini',
    discordInvite: process.env['DISCORD_INVITE']?.trim() ?? '',
    panel: panelConfig(),
  };
}
