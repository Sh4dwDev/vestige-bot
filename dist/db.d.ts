export interface Link {
    discordId: string;
    steamId: string;
}
export interface Pending {
    steamId: string;
    code: string;
    expiresAt: number;
    attempts: number;
}
export declare class Database {
    #private;
    /** Absolute path, and whether the file already existed. Logged at boot. */
    readonly file: string;
    readonly existed: boolean;
    constructor(file: string);
    /**
     * Boot diagnostics. A link count of zero on a server that had links is the
     * signature of the database being wiped, which otherwise looks exactly like
     * the bot "forgetting" people.
     */
    stats(): {
        links: number;
        pending: number;
    };
    close(): void;
    linkFor(discordId: string): Link | null;
    linkBySteam(steamId: string): Link | null;
    saveLink(discordId: string, steamId: string): void;
    removeLink(discordId: string): void;
    setPending(discordId: string, steamId: string, code: string, ttlMs: number): void;
    pendingFor(discordId: string): Pending | null;
    /** Looks up a pending link by its code, for the in-game chat confirmation. */
    pendingByCode(code: string): (Pending & {
        discordId: string;
    }) | null;
    bumpAttempts(discordId: string): number;
    clearPending(discordId: string): void;
    gameAdmins(): string[];
    addGameAdmin(steamId: string, addedBy: string): void;
    removeGameAdmin(steamId: string): boolean;
    botAdmins(): string[];
    isBotAdmin(discordId: string): boolean;
    addBotAdmin(discordId: string, addedBy: string): void;
    removeBotAdmin(discordId: string): boolean;
    recordPurchase(purchase: {
        discordId: string;
        steamId: string;
        species: string;
        mutations: string[];
        price: number;
        slot: string;
    }): void;
    recentPurchases(limit: number): Array<{
        discordId: string;
        species: string;
        mutations: string;
        price: number;
        at: string;
    }>;
    /** Merges: setting one part must not wipe the others already applied. */
    setSkin(steamId: string, species: string, colours: Record<string, string>): void;
    skinFor(steamId: string, species: string): Record<string, string> | null;
    /** Species omitted clears every look they have. */
    clearSkin(steamId: string, species?: string): number;
    /** Null when they have never been given one, so the game's own is left alone. */
    setPattern(steamId: string, species: string, pattern: number | null): void;
    patternFor(steamId: string, species: string): number | null;
    skinSpecies(steamId: string): string[];
    savePreset(name: string, look: {
        colours: Record<string, string>;
        pattern?: number;
    }, madeBy: string): void;
    /**
     * Tolerates the original shape, which was a bare map of field to hex with no
     * pattern — presets saved before patterns existed still load.
     */
    preset(name: string): {
        colours: Record<string, string>;
        pattern?: number;
    } | null;
    presetNames(): string[];
    removePreset(name: string): boolean;
    speciesCaps(): Array<{
        species: string;
        cap: number;
        locked: boolean;
    }>;
    setSpeciesCap(species: string, cap: number): void;
    removeSpeciesCap(species: string): boolean;
    setSpeciesLocked(species: string, locked: boolean): void;
    /** Milliseconds remaining, or 0 when the action is available. */
    cooldownLeft(steamId: string, action: string, windowMs: number): number;
    startCooldown(steamId: string, action: string): void;
    recordKill(killerSteam: string, victimSteam: string, species: string, cause: string): void;
    /** Attributed kills only — an empty killer is a death nobody gets credit for. */
    topKillers(limit: number): Array<{
        steamId: string;
        kills: number;
    }>;
    killStats(steamId: string): {
        kills: number;
        deaths: number;
    };
    /** Totals for the footer, so the attribution gap is visible rather than puzzling. */
    killTotals(): {
        total: number;
        attributed: number;
    };
    pointsFor(steamId: string): {
        balance: number;
        minutes: number;
    };
    /** Adds to a balance, creating the row if this is their first minute. */
    addPoints(steamId: string, amount: number, minutes?: number): void;
    /** Awards every online player in one transaction, so a crash cannot half-pay. */
    awardOnline(steamIds: string[], amount: number, minutes: number): void;
    /** Never goes below zero — a negative balance would be a bug with a shop attached. */
    setPoints(steamId: string, balance: number): void;
    topPoints(limit: number): Array<{
        steamId: string;
        balance: number;
        minutes: number;
    }>;
    /**
     * Single Game.ini keys the bot keeps at a chosen value. Stored under a
     * prefix so the reconciler can find them without a second table.
     */
    managedGameSettings(): Array<{
        key: string;
        value: string;
    }>;
    setManagedGameSetting(key: string, value: string): void;
    getSetting(key: string): string | null;
    setSetting(key: string, value: string): void;
}
