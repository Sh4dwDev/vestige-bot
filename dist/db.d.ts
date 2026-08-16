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
    constructor(file: string);
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
    getSetting(key: string): string | null;
    setSetting(key: string, value: string): void;
}
