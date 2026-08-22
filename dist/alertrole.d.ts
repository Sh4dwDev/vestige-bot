import { type ButtonInteraction } from 'discord.js';
import type { Ctx } from './commands.js';
export declare const RESTART_ROLE_BUTTON = "hub:restartrole";
export declare function restartAlertRole(ctx: Ctx): string | null;
export declare function setRestartAlertRole(ctx: Ctx, roleId: string | null): void;
/**
 * Toggles the role on the person who pressed.
 *
 * One button rather than two, because "get notified" and "stop being notified"
 * as separate buttons means a panel that always shows one that does nothing.
 * Returns true when the interaction was ours.
 */
export declare function handleRestartRoleButton(ctx: Ctx, interaction: ButtonInteraction, log: (m: string) => void): Promise<boolean>;
