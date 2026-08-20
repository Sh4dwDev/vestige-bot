/**
 * Evrima's RCON is a bespoke binary protocol — not Valve/Source RCON, so
 * mcrcon and friends cannot talk to it.
 *
 *   auth     0x01 <password> 0x00
 *   command  0x02 <opcode> <args> 0x00
 *   response plain text, usually 0x00 terminated
 *
 * Arguments inside a command are COMMA separated, not space separated.
 *
 * Only what storage needs: who is online, and sending a player a message.
 */
declare const OPCODES: {
    readonly announce: 16;
    readonly directmessage: 17;
    readonly wipecorpses: 19;
    readonly getplayables: 20;
    readonly updateplayables: 21;
    readonly addplayable: 26;
    readonly removeplayable: 27;
    readonly ban: 32;
    readonly kick: 48;
    readonly playerlist: 64;
    readonly save: 80;
    readonly togglewhitelist: 129;
    readonly addwhitelist: 130;
    readonly removewhitelist: 131;
    readonly toggleglobalchat: 132;
    readonly toggleai: 144;
};
export type RconCommand = keyof typeof OPCODES;
export interface OnlinePlayer {
    steamId: string;
    name: string;
}
export interface RconOptions {
    host: string;
    port: number;
    password: string;
    timeoutMs?: number;
    idleMs?: number;
    onLog?: (message: string) => void;
}
export declare class EvrimaRcon {
    #private;
    private readonly opts;
    constructor(opts: RconOptions);
    get connected(): boolean;
    /** Reconnects and retries once: Evrima drops idle RCON sockets silently. */
    send(command: RconCommand, args?: string[]): Promise<string>;
    players(): Promise<OnlinePlayer[]>;
    directMessage(steamId: string, message: string): Promise<void>;
    /** Server-wide notice. Renders as a transient banner, so keep it short. */
    announce(message: string): Promise<void>;
    /** Removes them now. They can rejoin immediately. */
    kick(steamId: string): Promise<string>;
    /**
     * Ban. `hours` of 0 is permanent on every build seen so far, but the arg
     * order is `Name,SteamID,Reason,Time` and the name is not optional.
     */
    ban(name: string, steamId: string, reason: string, hours: number): Promise<string>;
    /** Toggles, so the reply is the only way to know which way it went. */
    toggleWhitelist(): Promise<string>;
    addWhitelist(steamIds: string[]): Promise<string>;
    removeWhitelist(steamIds: string[]): Promise<string>;
    /** Also a toggle. Useful for cooling a room down without banning anyone. */
    toggleGlobalChat(): Promise<string>;
    /** Writes the world to disk. Always do this before a restart. */
    save(): Promise<void>;
    /**
     * Clears dead bodies from the world. The server does the removing, which is
     * why this is safe where destroying actors from Lua is not.
     */
    wipeCorpses(): Promise<void>;
    /** Raw playable list, exactly as the server names them. */
    playables(): Promise<string>;
    /**
     * Takes a species out of the spawn menu, server-side.
     *
     * The name format is whatever `getplayables` prints — bare, like
     * `Tyrannosaurus`. Callers must not trust this blindly: read the list back
     * and confirm, because a name the server does not recognise is accepted in
     * silence and simply does nothing.
     */
    removePlayable(species: string): Promise<void>;
    /** Puts a species back in the spawn menu. */
    addPlayable(species: string): Promise<void>;
    /**
     * There is deliberately no `updatePlayables()` method.
     *
     * `0x15` reads as "push the list to clients". It does not: it rebuilds the
     * list from the base catalogue and leaves it **empty**, so every species
     * becomes unspawnable at once. Verified live on 2026-08-17 — the list went
     * from 22 to 0 and had to be rebuilt one `AddPlayable` at a time.
     *
     * `AddPlayable` and `RemovePlayable` take effect on their own; the opcode
     * stays in the table above only so nobody rediscovers it the same way.
     */
    /**
     * Flips AI on or off. It is a **toggle**, not a setter — the reply says which
     * way it went, so callers that need a known state must read it.
     */
    toggleAI(): Promise<string>;
    close(): void;
}
export declare function decodeResponse(buffer: Buffer): string;
/**
 * playerlist has shipped in several shapes across patches. Try each and fall
 * back to IDs only, which every caller can still work with.
 */
export declare function parsePlayerList(raw: string): OnlinePlayer[];
export {};
