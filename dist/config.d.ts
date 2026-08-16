export interface Config {
    discord: {
        token: string;
        clientId: string | null;
        guildId: string;
    };
    rcon: {
        host: string;
        port: number;
        password: string;
    };
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
}
export declare function loadConfig(): Config;
