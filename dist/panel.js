import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { ARCHIVE_CAP, SECURED, SERVER, SIGNATURE } from './brand.js';
/**
 * The /storage panel: one message showing your slots, driven by buttons.
 *
 * Deliberately stateless — the selected slot travels inside the button custom
 * IDs rather than in a session map, so a bot restart never leaves someone with
 * a panel whose buttons have forgotten what they point at.
 */
import { MAX_SLOTS } from './bridge.js';
/**
 * Names are cleaned up rather than rejected.
 *
 * "my rex" is a perfectly reasonable thing to type, and bouncing it back with a
 * rules lecture — which then hides whatever the real problem was — is a bad
 * trade for a label nobody but the owner ever sees.
 */
export function cleanSlotName(raw) {
    const cleaned = raw
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^A-Za-z0-9_-]/g, '')
        .replace(/-{2,}/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 24);
    return cleaned.length > 0 ? cleaned : null;
}
const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2, quiet: 0x4f545c };
/**
 * A missing or zero timestamp is data from an older format, not 1970 — say so
 * rather than rendering "57 years ago".
 */
const relative = (unix) => unix > 1_000_000_000 ? `<t:${Math.floor(unix)}:R>` : 'at an unknown time';
export async function buildPanel(ctx, steamId, options = {}) {
    let slots = [];
    let error = null;
    try {
        const result = await ctx.mod.run('list', steamId, {}, { quiet: options.quiet ?? false });
        slots = (result.data ?? []);
    }
    catch (err) {
        error = err instanceof Error ? err.message : String(err);
    }
    const selected = options.selected && slots.some((s) => s.slot === options.selected)
        ? options.selected
        : null;
    const embed = new EmbedBuilder()
        .setColor(error ? COLORS.bad : COLORS.info)
        .setTitle(`🏛️  Your ${SERVER} archive`)
        .setTimestamp();
    if (error) {
        embed.setDescription(`The archive cannot be reached right now.\n\n${error}`);
        embed.setFooter({ text: SIGNATURE });
    }
    else if (slots.length === 0) {
        embed.setDescription('Nothing of yours is kept here yet.\n\n' +
            'Press **Store** while playing a **fully grown** dinosaur and it will be ' +
            'held safe until you call for it.');
        embed.setFooter({ text: `0 of ${MAX_SLOTS} vaults filled · ${SIGNATURE}` });
    }
    else {
        embed.addFields(slots.map((slot) => ({
            name: slot.slot === selected ? `▸ ${slot.slot}` : slot.slot,
            value: `${slot.species}\nSecured ${relative(slot.storedAt)}`,
            inline: true,
        })));
        embed.setFooter({
            text: selected
                ? `${slots.length} of ${MAX_SLOTS} vaults filled · ${selected} selected · ${SIGNATURE}`
                : `${slots.length} of ${MAX_SLOTS} vaults filled · pick one to release or discard · ${SIGNATURE}`,
        });
    }
    if (options.notice) {
        const marks = { good: '✅', bad: '⛔', warn: '⚠️' };
        embed.setDescription(`${marks[options.notice.tone]} ${options.notice.text}` +
            (embed.data.description ? `\n\n${embed.data.description}` : ''));
        if (options.notice.tone === 'good')
            embed.setColor(COLORS.good);
        if (options.notice.tone === 'bad')
            embed.setColor(COLORS.bad);
    }
    const rows = [];
    if (slots.length > 0) {
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId('st:pick')
            .setPlaceholder('Choose something from your archive')
            .addOptions(slots.map((slot) => ({
            label: slot.slot,
            value: slot.slot,
            description: slot.species,
            default: slot.slot === selected,
        })))));
    }
    rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId('st:store')
        .setLabel('Store')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(slots.length >= MAX_SLOTS), new ButtonBuilder()
        .setCustomId(`st:restore:${selected ?? ''}`)
        .setLabel('Release')
        .setStyle(ButtonStyle.Success)
        .setDisabled(selected === null), new ButtonBuilder()
        .setCustomId(`st:delete:${selected ?? ''}`)
        .setLabel('Discard')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(selected === null), new ButtonBuilder().setCustomId('st:refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)));
    return { embeds: [embed], components: rows };
}
/**
 * Keeps an open panel current.
 *
 * Storage changes from in game too — you can die, or store from another
 * session — so a panel that only updates when you press something goes stale
 * and quietly lies. Refreshing is paused while a confirmation is on screen, or
 * it would wipe the prompt out from under the player.
 *
 * Interaction tokens expire after 15 minutes; the timer stops before then and
 * gives up quietly if an edit fails.
 */
const REFRESH_MS = 20_000;
const PANEL_LIFETIME_MS = 13 * 60_000;
const activePanels = new Map();
export function stopAutoRefresh(userId) {
    const panel = activePanels.get(userId);
    if (panel) {
        clearTimeout(panel.timer);
        activePanels.delete(userId);
    }
}
/** Renders the panel and (re)arms auto-refresh. */
export async function showPanel(ctx, interaction, userId, steamId, options = {}) {
    await interaction.editReply(await buildPanel(ctx, steamId, options));
    stopAutoRefresh(userId);
    const startedAt = Date.now();
    // Backs off rather than polling every 20 seconds for a quarter of an hour.
    // The first minutes are when someone is actually storing something; a panel
    // left open on a second monitor does not need that attention.
    const delayFor = (elapsed) => elapsed < 2 * 60_000 ? REFRESH_MS : elapsed < 6 * 60_000 ? 45_000 : 90_000;
    const schedule = () => {
        const timer = setTimeout(() => {
            void (async () => {
                const elapsed = Date.now() - startedAt;
                if (elapsed > PANEL_LIFETIME_MS) {
                    stopAutoRefresh(userId);
                    return;
                }
                try {
                    // Rebuilt from scratch each time, so a slot stored or lost elsewhere
                    // shows up without anyone pressing Refresh.
                    await interaction.editReply(await buildPanel(ctx, steamId, { quiet: true }));
                }
                catch {
                    // Token expired or the message is gone.
                    stopAutoRefresh(userId);
                    return;
                }
                const next = activePanels.get(userId);
                if (next)
                    next.timer = schedule();
            })();
        }, delayFor(Date.now() - startedAt));
        timer.unref();
        return timer;
    };
    activePanels.set(userId, { timer: schedule(), startedAt });
}
export function storeModal() {
    return new ModalBuilder()
        .setCustomId('st:storemodal')
        .setTitle('Commit to the archive')
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
        .setCustomId('slot')
        .setLabel('A name for this vault')
        .setPlaceholder('my-rex')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(24)
        .setRequired(true)));
}
function confirmRows(action, slot) {
    return [
        new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`st:yes:${action}:${slot}`)
            .setLabel(action === 'store' ? 'Store & kill' : 'Discard')
            .setStyle(ButtonStyle.Danger), new ButtonBuilder().setCustomId('st:refresh').setLabel('Cancel').setStyle(ButtonStyle.Secondary)),
    ];
}
/**
 * Handles every component and modal on the panel. Returns true when the
 * interaction belonged to us.
 */
export async function handlePanelInteraction(ctx, interaction) {
    const id = interaction.customId;
    if (!id.startsWith('st:'))
        return false;
    const link = ctx.db.linkFor(interaction.user.id);
    if (!link) {
        if (interaction.isRepliable()) {
            await interaction.reply({
                content: `${ARCHIVE_CAP} no longer recognises you. Run \`/link\` again.`,
                ephemeral: true,
            });
        }
        return true;
    }
    // Opening a modal must be the FIRST response to the interaction, so it
    // cannot be deferred beforehand.
    if (id === 'st:store' && interaction.isButton()) {
        await interaction.showModal(storeModal());
        return true;
    }
    if (interaction.isModalSubmit()) {
        const typed = interaction.fields.getTextInputValue('slot');
        await interaction.deferUpdate();
        const slot = cleanSlotName(typed);
        if (slot === null) {
            await showPanel(ctx, interaction, interaction.user.id, link.steamId, {
                notice: {
                    text: 'That name has no letters or numbers in it. Try something like `my-rex`.',
                    tone: 'warn',
                },
            });
            return true;
        }
        // Storing kills the dinosaur, so it always asks first.
        const embed = new EmbedBuilder()
            .setColor(COLORS.warn)
            .setTitle('Commit this dinosaur to the archive?')
            .setDescription(`It will be kept as \`${slot}\`.\n\n` +
            '**Your dinosaur will die.** Nothing enters the archive alive — it leaves the ' +
            'world and is held exactly as it is until you call for it.\n\n' +
            'It must be fully grown. You may release it once, as the same species.');
        // A confirmation replaces the panel, so auto-refresh must not overwrite it.
        stopAutoRefresh(interaction.user.id);
        await interaction.editReply({ embeds: [embed], components: confirmRows('store', slot) });
        return true;
    }
    if (interaction.isStringSelectMenu() && id === 'st:pick') {
        await interaction.deferUpdate();
        await showPanel(ctx, interaction, interaction.user.id, link.steamId, {
            selected: interaction.values[0] ?? null,
        });
        return true;
    }
    if (!interaction.isButton())
        return false;
    await interaction.deferUpdate();
    const [, action, ...rest] = id.split(':');
    const slot = rest.join(':');
    try {
        if (action === 'refresh') {
            await showPanel(ctx, interaction, interaction.user.id, link.steamId);
            return true;
        }
        if (action === 'delete') {
            const embed = new EmbedBuilder()
                .setColor(COLORS.warn)
                .setTitle('Discard this permanently?')
                .setDescription(`\`${slot}\` will be struck from the archive for good. ` +
                'This does **not** give the dinosaur back.');
            stopAutoRefresh(interaction.user.id);
            await interaction.editReply({ embeds: [embed], components: confirmRows('delete', slot) });
            return true;
        }
        if (action === 'restore') {
            stopAutoRefresh(interaction.user.id);
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(COLORS.quiet).setTitle('Releasing…')
                        .setDescription(`${ARCHIVE_CAP} is giving it back. This takes a few seconds.`)],
                components: [],
            });
            const result = await ctx.mod.run('restore', link.steamId, { slot });
            await showPanel(ctx, interaction, interaction.user.id, link.steamId, {
                notice: {
                    text: result.ok ? `${result.msg} — that vault is empty again.` : result.msg,
                    tone: result.ok ? 'good' : 'bad',
                },
            });
            return true;
        }
        if (action === 'yes') {
            const [confirmed, ...slotParts] = rest;
            const target = slotParts.join(':');
            if (confirmed === 'store') {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(COLORS.quiet).setTitle('Securing…')
                            .setDescription('Committing your dinosaur to the archive.')],
                    components: [],
                });
                const result = await ctx.mod.run('store', link.steamId, { slot: target });
                await showPanel(ctx, interaction, interaction.user.id, link.steamId, {
                    notice: {
                        // The mod's own wording is the plumbing talking; on success the
                        // player should hear the archive instead.
                        text: result.ok ? SECURED : `${result.msg} — your dinosaur is unharmed.`,
                        tone: result.ok ? 'good' : 'bad',
                    },
                });
                return true;
            }
            if (confirmed === 'delete') {
                const result = await ctx.mod.run('delete', link.steamId, { slot: target });
                await showPanel(ctx, interaction, interaction.user.id, link.steamId, {
                    notice: { text: result.msg, tone: result.ok ? 'good' : 'bad' },
                });
                return true;
            }
        }
    }
    catch (err) {
        await showPanel(ctx, interaction, interaction.user.id, link.steamId, {
            notice: { text: err instanceof Error ? err.message : String(err), tone: 'bad' },
        });
        return true;
    }
    return true;
}
//# sourceMappingURL=panel.js.map