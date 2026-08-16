import { ActionRowBuilder, ButtonBuilder, EmbedBuilder, type AutocompleteInteraction, type Client, type ChatInputCommandInteraction, type ButtonInteraction } from 'discord.js';
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
/**
 * The /link reply, kept so the watcher can turn it into "linked" in place once
 * the player types their code in game.
 *
 * Better than a DM: it stays in the channel they are already looking at, only
 * they can see it, and plenty of people have DMs closed. Interaction tokens are
 * valid for 15 minutes, which is longer than the code itself lasts.
 */
interface Editable {
    editReply: (options: {
        embeds: EmbedBuilder[];
    }) => Promise<unknown>;
}
export declare function announceLinked(discordId: string): Promise<boolean>;
export declare const commandData: import("discord.js").RESTPostAPIChatInputApplicationCommandsJSONBody[];
export declare function handleCommand(ctx: Ctx, i: ChatInputCommandInteraction): Promise<void>;
/**
 * Issues a link code. Shared by `/link` and the Verify button, so both routes
 * behave identically — the interaction must already be deferred, ephemerally.
 */
export declare function beginLink(ctx: Ctx, i: Editable, discordId: string, rawSteamId: string): Promise<void>;
/** Anything that can show a prompt and wait on a button click. */
interface Confirmable {
    editReply: (options: {
        embeds: EmbedBuilder[];
        components?: ActionRowBuilder<ButtonBuilder>[];
    }) => Promise<{
        awaitMessageComponent: (o: never) => Promise<never>;
    } | unknown>;
    user: {
        id: string;
    };
}
/**
 * Confirms, then kills. Shared by `/slay` and the panel button so both ask the
 * same question. The interaction must already be deferred, ephemerally.
 *
 * The Steam ID comes from the link table, never from user input, so this cannot
 * be pointed at anyone else.
 */
/** Minutes between slays. Zero disables the limit entirely. */
export declare function slayCooldownMinutes(ctx: Ctx): number;
export declare function runSlay(ctx: Ctx, i: Confirmable, steamId: string): Promise<void>;
/** Steam IDs are the key, so anyone unlinked shows as a partial ID. */
export declare function steamNamer(ctx: Ctx): (steamId: string) => string;
/**
 * Completes a purchase.
 *
 * Order matters: the dinosaur is written **before** the points are taken. If
 * that order were reversed, a failed delivery would leave someone charged with
 * nothing to show for it. This way the worst case is a free dinosaur, which is
 * the right direction to fail in.
 */
export declare function completePurchase(ctx: Ctx, interaction: ButtonInteraction): Promise<void>;
export declare function startTeleport(ctx: Ctx, i: {
    editReply: (o: {
        embeds: EmbedBuilder[];
    }) => Promise<unknown>;
    client: Client;
    user: {
        id: string;
        tag: string;
    };
}, friendId: string): Promise<void>;
/**
 * Suggestions for the gift command. Both lists come from the server, so they
 * cannot drift out of date the way a hardcoded list would.
 */
export declare function handleAutocomplete(ctx: Ctx, i: AutocompleteInteraction): Promise<void>;
/**
 * The mutation slots, deduplicated.
 *
 * The picker already hides what is taken, but the field accepts free text, so
 * the same one can still be typed twice. Returns the repeat rather than
 * silently dropping it: quietly changing what someone asked for is worse when
 * there is a price attached.
 */
export declare function readMutations(i: ChatInputCommandInteraction): {
    mutations: string[];
    duplicate: string | null;
};
export declare function describeError(err: unknown): string;
export {};
