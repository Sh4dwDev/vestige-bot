import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { describeError } from './commands.js';
import { encodeColours, hexToInt } from './skins.js';
/**
 * Founder skins: three looks reserved for the people who showed up first.
 *
 * Deliberately **claim order, not join date.** Discord join dates can be read,
 * but they make the reward invisible until someone audits a member list, and
 * they hand it to people who joined once and never played. First fifty to claim
 * is something a person can see happening and act on.
 *
 * A claim is permanent and cannot be changed: that is what makes the choice
 * mean anything, and it stops the panel becoming a free skin picker.
 *
 * Applying is a separate button on purpose. Skins live per species and are
 * cleared when a dinosaur dies, so a founder re-applies to whatever they are
 * playing now rather than having one look follow them onto everything forever.
 */
const CHANNEL_KEY = 'founder_channel';
export const FOUNDER_MESSAGE_KEY = 'founder_message';
const LIMIT_KEY = 'founder_limit';
export const DEFAULT_LIMIT = 50;
const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2 };
/**
 * Three, and only three. They are exclusive, so they do not appear in the
 * normal preset list and cannot be handed out with `/admin skin`.
 *
 * Field names come from PARTS in skins.ts, which is the verified list. Making
 * one up produces a colour that is silently dropped on the way to the pawn.
 */
export const FOUNDER_SKINS = [
    {
        id: 'firstlight',
        name: 'First Light',
        emoji: '🌅',
        blurb: 'Pale gold over deep grey, like the first morning on the island.',
        pattern: 1,
        colours: {
            BodyColor: '#D9B26A',
            MarkingsColor: '#3A3A42',
            UnderbellyColor: '#EDD9A8',
            FlankColor: '#8A6E3C',
            Detail1Color: '#C9A05A',
            EyesColor: '#FFE9A8',
        },
    },
    {
        id: 'deepwood',
        name: 'Deepwood',
        emoji: '🌲',
        blurb: 'Moss and bark. Made for standing perfectly still in the treeline.',
        pattern: 2,
        colours: {
            BodyColor: '#2F4A2C',
            MarkingsColor: '#16261A',
            UnderbellyColor: '#6B7A4A',
            FlankColor: '#3F5A33',
            Detail1Color: '#253D24',
            EyesColor: '#C8F08A',
        },
    },
    {
        id: 'oldscar',
        name: 'Old Scar',
        emoji: '🩸',
        blurb: 'Ash grey with dried red across the flanks. Survived something.',
        pattern: 3,
        colours: {
            BodyColor: '#4A4448',
            MarkingsColor: '#6E2320',
            UnderbellyColor: '#7D7378',
            FlankColor: '#33292C',
            Detail1Color: '#3B3538',
            EyesColor: '#FF6B4A',
        },
    },
];
export const skinById = (id) => FOUNDER_SKINS.find((s) => s.id === id);
// ---------------------------------------------------------------- settings --
export function setFounderChannel(ctx, channelId) {
    ctx.db.setSetting(CHANNEL_KEY, channelId ?? '');
    ctx.db.setSetting(FOUNDER_MESSAGE_KEY, '');
}
export function founderChannel(ctx) {
    return ctx.db.getSetting(CHANNEL_KEY) || null;
}
export function founderLimit(ctx) {
    const raw = Number.parseInt(ctx.db.getSetting(LIMIT_KEY) ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_LIMIT;
}
export function setFounderLimit(ctx, limit) {
    ctx.db.setSetting(LIMIT_KEY, String(limit));
}
// ------------------------------------------------------------------- panel --
export function buildFounderPanel(ctx) {
    const taken = ctx.db.founderCount();
    const limit = founderLimit(ctx);
    const left = Math.max(0, limit - taken);
    return new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('✨  Founder skins')
        .setDescription(`The first **${limit}** people to claim get one of three looks that will ` +
        `never be handed out again on ${SERVER}.\n\n` +
        (left > 0
            ? `**${left}** of ${limit} still unclaimed.`
            : '**All claimed.** These are closed for good.') +
        '\n\nYou get **one**, and it cannot be changed afterwards. Pick the one ' +
        'you want to be wearing a year from now.')
        .addFields(...FOUNDER_SKINS.map((skin) => ({
        name: `${skin.emoji}  ${skin.name}`,
        value: `${skin.blurb}\n\`${skin.colours['BodyColor']}\` · pattern ` +
            `**${String.fromCharCode(65 + (skin.pattern ?? 0))}**`,
        inline: false,
    })), {
        name: '🎨  Wearing it',
        value: 'Claim once, then press **Apply** whenever you want it on the ' +
            'dinosaur you are playing. Colours are lost when a dinosaur dies, so ' +
            'apply again on the next one.',
        inline: false,
    })
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
}
export function founderRows(ctx) {
    const closed = ctx.db.founderCount() >= founderLimit(ctx);
    return [
        new ActionRowBuilder().addComponents(...FOUNDER_SKINS.map((skin) => new ButtonBuilder()
            .setCustomId(`fs:claim:${skin.id}`)
            .setLabel(skin.name)
            .setEmoji(skin.emoji)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(closed))),
        new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId('fs:apply')
            .setLabel('Apply my skin')
            .setEmoji('🎨')
            .setStyle(ButtonStyle.Secondary)),
    ];
}
// ------------------------------------------------------------ interactions --
/** Returns true when this interaction was ours. */
export async function handleFounderInteraction(ctx, interaction) {
    const id = interaction.customId;
    if (!id.startsWith('fs:'))
        return false;
    const link = ctx.db.linkFor(interaction.user.id);
    if (!link) {
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Link first')
                    .setDescription('A skin is painted onto your dinosaur, so the bot needs ' +
                    'to know which character is yours. Run `/link`.')],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    if (id === 'fs:apply') {
        await applyFounderSkin(ctx, interaction, link.steamId);
        return true;
    }
    const skin = skinById(id.slice('fs:claim:'.length));
    if (!skin)
        return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const existing = ctx.db.founderSkin(interaction.user.id);
    if (existing) {
        const already = skinById(existing);
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('You already have one')
                    .setDescription(`You claimed **${already?.name ?? existing}**. Founder ` +
                    'skins cannot be swapped — that is what makes the choice mean ' +
                    'something.\n\nUse **Apply my skin** to put it on.')],
        });
        return true;
    }
    // The count and the insert have to be one decision, or two people clicking
    // together both pass the check and claim slot fifty-one.
    const claimed = ctx.db.claimFounder(interaction.user.id, skin.id, founderLimit(ctx));
    if (!claimed) {
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('All claimed')
                    .setDescription('The last one went before yours landed. Nothing has ' +
                    'been taken from you.')],
        });
        return true;
    }
    await interaction.editReply({
        embeds: [new EmbedBuilder()
                .setColor(hexToInt(skin.colours['BodyColor'] ?? '') ?? COLORS.good)
                .setTitle(`${skin.emoji}  ${skin.name} is yours`)
                .setDescription(`${skin.blurb}\n\nYou are founder **#${ctx.db.founderCount()}** ` +
                `of ${founderLimit(ctx)}.\n\nPress **Apply my skin** while you are on a ` +
                'dinosaur to wear it.')
                .setFooter({ text: SIGNATURE })],
    });
    // The panel shows how many are left, so it is now out of date.
    await refreshFounderPanel(ctx, interaction).catch(() => undefined);
    return true;
}
async function applyFounderSkin(ctx, interaction, steamId) {
    const owned = ctx.db.founderSkin(interaction.user.id);
    const skin = owned ? skinById(owned) : undefined;
    if (!skin) {
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('You have not claimed one')
                    .setDescription('Pick one of the three above first.')],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
        // Pattern first and checked: an index this species does not have is
        // refused, and the refusal aborts the colour rebuild with it.
        if (skin.pattern !== undefined) {
            const result = await ctx.mod.run('pattern', steamId, { index: skin.pattern });
            if (!result.ok) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Not on this species')
                            .setDescription(`${result.msg}\n\nThis dinosaur does not have the ` +
                            `pattern **${skin.name}** uses. Try it on another species.`)],
                });
                return;
            }
        }
        const result = await ctx.mod.run('skinmany', steamId, {
            colors: encodeColours(skin.colours),
        });
        if (!result.ok) {
            await interaction.editReply({
                embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Could not apply it')
                        .setDescription(`${result.msg}\n\nYou need to be **on a dinosaur** — ` +
                        'admin cam and the spawn screen have nothing to paint.')],
            });
            return;
        }
        await interaction.editReply({
            embeds: [new EmbedBuilder()
                    .setColor(hexToInt(skin.colours['BodyColor'] ?? '') ?? COLORS.good)
                    .setTitle(`${skin.emoji}  ${skin.name} applied`)
                    .setDescription('It is on your dinosaur now.\n\nColours are lost when ' +
                    'a dinosaur dies, so press this again on the next one.')
                    .setFooter({ text: SIGNATURE })],
        });
    }
    catch (err) {
        await interaction.editReply({
            embeds: [new EmbedBuilder().setColor(COLORS.bad).setTitle('Something went wrong')
                    .setDescription(describeError(err))],
        });
    }
}
async function refreshFounderPanel(ctx, interaction) {
    if (!interaction.message.editable)
        return;
    await interaction.message.edit({
        embeds: [buildFounderPanel(ctx)],
        components: founderRows(ctx),
    });
}
//# sourceMappingURL=founders.js.map