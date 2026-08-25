function required(name) {
    const value = process.env[name];
    if (!value || value.trim() === '')
        throw new Error(`Missing required environment variable ${name}`);
    return value.trim();
}
function int(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed))
        throw new Error(`${name} must be a number, got "${raw}"`);
    return parsed;
}
/** All three parts are needed or none of it works, so it is all-or-nothing. */
function panelConfig() {
    const url = process.env['PANEL_URL']?.trim();
    const apiKey = process.env['PANEL_API_KEY']?.trim();
    const serverId = process.env['PANEL_SERVER_ID']?.trim();
    if (!url && !apiKey && !serverId)
        return null;
    if (!url || !apiKey || !serverId) {
        throw new Error('PANEL_URL, PANEL_API_KEY and PANEL_SERVER_ID must all be set, or all be blank');
    }
    return { url, apiKey, serverId };
}
/**
 * All three or none, like the panel.
 *
 * A half-configured site is worse than none: it would start, accept a sign-in
 * and then fail at the token exchange, which looks like a broken login rather
 * than a missing setting.
 *
 * The client ID is required here even though the bot can derive one from its
 * token, because the redirect URI registered with Discord has to match a client
 * that is known before the first request arrives.
 */
function webConfig() {
    const baseUrl = process.env['WEB_BASE_URL']?.trim().replace(/\/+$/, '');
    const clientSecret = process.env['DISCORD_CLIENT_SECRET']?.trim();
    const clientId = process.env['DISCORD_CLIENT_ID']?.trim();
    if (!baseUrl && !clientSecret)
        return null;
    if (!baseUrl || !clientSecret || !clientId) {
        throw new Error('WEB_BASE_URL, DISCORD_CLIENT_SECRET and DISCORD_CLIENT_ID must all be set '
            + 'to run the website, or WEB_BASE_URL and DISCORD_CLIENT_SECRET must both '
            + 'be blank to leave it off');
    }
    if (!/^https?:\/\//.test(baseUrl)) {
        throw new Error(`WEB_BASE_URL must start with http:// or https://, got "${baseUrl}"`);
    }
    // Empty entries are dropped so a trailing comma in the environment does not
    // become an origin that matches nothing and looks like it should.
    const allowedOrigins = (process.env['WEB_ALLOWED_ORIGINS'] ?? '')
        .split(',')
        .map((o) => o.trim().replace(/\/+$/, ''))
        .filter((o) => o.length > 0);
    for (const origin of allowedOrigins) {
        if (!/^https?:\/\/[^/]+$/.test(origin)) {
            throw new Error(`WEB_ALLOWED_ORIGINS must be scheme and host only, e.g. http://localhost:5173, got "${origin}"`);
        }
    }
    return {
        port: int('WEB_PORT', 8787),
        baseUrl,
        clientId,
        clientSecret,
        appDir: process.env['WEB_APP_DIR']?.trim() || null,
        allowedOrigins,
    };
}
export function loadConfig() {
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
        gameIniPath: process.env['GAME_INI_PATH']?.trim() ||
            '/TheIsle/Saved/Config/WindowsServer/Game.ini',
        discordInvite: process.env['DISCORD_INVITE']?.trim() ?? '',
        panel: panelConfig(),
        web: webConfig(),
    };
}
//# sourceMappingURL=config.js.map