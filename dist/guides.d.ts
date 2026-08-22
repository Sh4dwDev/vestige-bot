import { EmbedBuilder, type Client } from 'discord.js';
import type { Ctx } from './commands.js';
export declare function buildStorageGuideEmbed(): EmbedBuilder;
/**
 * Commands a **player** can use.
 *
 * Staff commands are deliberately absent: this embed is pinned in a public
 * channel, and advertising `/admin` to everyone invites people to try it and
 * then ask why it was refused. Staff already know what they have.
 */
/**
 * Never shown in the player-facing command panel.
 *
 * `/setup` is here for the same reason as `/admin`: it only exists because
 * Discord caps a command at 25 subcommand groups and /admin outgrew it, so it
 * is staff-only despite the friendlier name.
 */
export declare const STAFF_COMMANDS: Set<string>;
export declare function buildCommandsEmbed(): EmbedBuilder;
/**
 * Which channel each reference embed lives in.
 *
 * Only the message id was kept before, which was enough to edit one but not to
 * find one — so the embeds could only ever be refreshed by an admin re-running
 * the command. Nobody does that after shipping a feature, and both drifted:
 * the command list was still telling players there was nothing to spend points
 * on months after the shop opened.
 */
declare const PANELS: {
    readonly guide: {
        readonly channel: "guide_channel";
        readonly message: "guide_message";
        readonly label: "Storage guide";
    };
    readonly commands: {
        readonly channel: "commands_channel";
        readonly message: "commands_message";
        readonly label: "Command list";
    };
};
export type ReferencePanel = keyof typeof PANELS;
export declare const referenceKeys: (which: ReferencePanel) => (typeof PANELS)[ReferencePanel];
export declare function rememberGuideChannel(ctx: Ctx, which: ReferencePanel, channelId: string): void;
/**
 * Re-renders both reference embeds wherever they already are.
 *
 * Run at startup, so shipping a change to the wording is enough to update what
 * players actually read. These are static text with no live data, so redrawing
 * them costs two edits per restart and removes the whole class of "the guide
 * says something that stopped being true".
 *
 * A panel nobody has placed yet is skipped rather than posted somewhere
 * arbitrary.
 */
export declare function refreshGuides(ctx: Ctx, client: Client, log: (message: string) => void): Promise<void>;
export {};
