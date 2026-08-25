export interface Config {
    discord: {
        token: string;
        clientId: string | null;
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
    /**
     * The game host's control panel. Null when unset — scheduled restarts then
     * warn and save but cannot restart, because RCON has no such command.
     */
    panel: {
        url: string;
        apiKey: string;
        serverId: string;
    } | null;
    /**
     * The player website. Null when unset, and the bot then runs exactly as it
     * did before, with no listening socket.
     */
    web: {
        port: number;
        /** Public origin, no trailing slash. The OAuth redirect is built from it. */
        baseUrl: string;
        clientId: string;
        clientSecret: string;
        /**
         * A built front end to serve, or null to serve only the API. Serving the
         * app from here keeps it same-origin, which is the simplest thing that
         * works and needs no CORS at all.
         */
        appDir: string | null;
        /**
         * Extra origins allowed to call the API with a session cookie, for a front
         * end hosted somewhere else or running on a dev server. Empty is both the
         * default and the safest setting.
         */
        allowedOrigins: string[];
    } | null;
}
export declare function loadConfig(): Config;
