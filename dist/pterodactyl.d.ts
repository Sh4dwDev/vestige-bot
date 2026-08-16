/**
 * The game host's control panel.
 *
 * Evrima's RCON can announce, kick and save, but it cannot restart — so the
 * restart itself has to come from the panel that owns the process. This is the
 * client API (the per-user one), not the application API: it only ever touches
 * the single server whose id is configured.
 */
export interface PanelConfig {
    /** Panel root, e.g. https://panel.gamehostbros.com */
    url: string;
    /** A client API key from the panel's account page. */
    apiKey: string;
    /** The short server id from the panel URL. */
    serverId: string;
}
export type PowerSignal = 'restart' | 'stop' | 'start';
export declare class Panel {
    #private;
    private readonly config;
    constructor(config: PanelConfig);
    /** Asks the panel to restart the server. Returns once accepted, not once back up. */
    power(signal: PowerSignal): Promise<void>;
    /**
     * Proves the key and server id work, so a misconfiguration surfaces when it
     * is set rather than at 3am when a restart silently fails.
     */
    check(): Promise<string>;
}
