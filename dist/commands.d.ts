import { type ChatInputCommandInteraction } from 'discord.js';
import { AdminStore } from './admins.js';
import type { ModBridge } from './bridge.js';
import type { Config } from './config.js';
import type { Database } from './db.js';
import type { Panel } from './pterodactyl.js';
import type { EvrimaRcon } from './rcon.js';
export interface Ctx {
    config: Config;
    db: Database;
    rcon: EvrimaRcon;
    mod: ModBridge;
    admins: AdminStore;
    /** Null when no control panel is configured; restarts then warn but cannot act. */
    panel: Panel | null;
}
export declare function announceLinked(discordId: string): Promise<boolean>;
export declare const commandData: import("discord.js").RESTPostAPIChatInputApplicationCommandsJSONBody[];
export declare function handleCommand(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void>;
export declare function describeError(err: unknown): string;
