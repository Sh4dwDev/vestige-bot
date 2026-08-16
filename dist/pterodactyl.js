/**
 * The game host's control panel.
 *
 * Evrima's RCON can announce, kick and save, but it cannot restart — so the
 * restart itself has to come from the panel that owns the process. This is the
 * client API (the per-user one), not the application API: it only ever touches
 * the single server whose id is configured.
 */
export class Panel {
    config;
    constructor(config) {
        this.config = config;
    }
    #endpoint(path) {
        return `${this.config.url.replace(/\/+$/, '')}/api/client/servers/${this.config.serverId}${path}`;
    }
    async #request(path, init = {}) {
        const response = await fetch(this.#endpoint(path), {
            ...init,
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
                ...init.headers,
            },
            signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
            // The panel's error bodies are verbose JSON; the status is what actually
            // distinguishes "wrong key" from "wrong server id".
            const hint = response.status === 401 || response.status === 403
                ? ' — check the API key, and that it has control of this server'
                : response.status === 404
                    ? ' — check the server id'
                    : '';
            throw new Error(`panel returned ${response.status}${hint}`);
        }
        return response;
    }
    /** Asks the panel to restart the server. Returns once accepted, not once back up. */
    async power(signal) {
        await this.#request('/power', { method: 'POST', body: JSON.stringify({ signal }) });
    }
    /**
     * Proves the key and server id work, so a misconfiguration surfaces when it
     * is set rather than at 3am when a restart silently fails.
     */
    async check() {
        const response = await this.#request('/resources');
        const body = (await response.json());
        return body.attributes?.current_state ?? 'unknown';
    }
}
//# sourceMappingURL=pterodactyl.js.map