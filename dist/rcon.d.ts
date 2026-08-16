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
    readonly getplayables: 20;
    readonly playerlist: 64;
    readonly save: 80;
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
    /** Writes the world to disk. Always do this before a restart. */
    save(): Promise<void>;
    /** Raw playable list, exactly as the server names them. */
    playables(): Promise<string>;
    close(): void;
}
export declare function decodeResponse(buffer: Buffer): string;
/**
 * playerlist has shipped in several shapes across patches. Try each and fall
 * back to IDs only, which every caller can still work with.
 */
export declare function parsePlayerList(raw: string): OnlinePlayer[];
export {};
