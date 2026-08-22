import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { describeError } from './commands.js';
import { earlyRole, hasEarlyRole } from './earlymember.js';
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
    const limit = founderLimit(ctx);
    return new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('✨  Early Member skins')
        .setDescription(`Three looks for the first **${limit}** members of ${SERVER}, and nobody ` +
        'after.\n\n' +
        '**All three are yours** if you have the Early Member role — wear whichever ' +
        'suits the dinosaur you are on, and change your mind as often as you like.')
        .addFields(...FOUNDER_SKINS.map((skin) => ({
        name: `${skin.emoji}  ${skin.name}`,
        value: `${skin.blurb}
\`${skin.colours['BodyColor']}\` · pattern ` +
            `**${String.fromCharCode(65 + (skin.pattern ?? 0))}**`,
        inline: false,
    })), {
        name: '🎨  Wearing one',
        value: 'Press a skin while you are on a dinosaur. Colours are lost when ' +
            'a dinosaur dies, so press it again on the next one.',
        inline: false,
    })
        .setFooter({ text: SIGNATURE })
        .setTimestamp();
}
export function founderRows(ctx) {
    void ctx;
    return [
        // One button per skin. There is no claiming any more: the role is the
        // entitlement, and it already says who is allowed.
        new ActionRowBuilder().addComponents(...FOUNDER_SKINS.map((skin) => new ButtonBuilder()
            .setCustomId(`fs:wear:${skin.id}`)
            .setLabel(skin.name)
            .setEmoji(skin.emoji)
            .setStyle(ButtonStyle.Primary))),
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
    if (!interaction.inCachedGuild())
        return true;
    const roleId = earlyRole(ctx);
    if (!roleId) {
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Not set up yet')
                    .setDescription('An admin needs to choose the Early Member role with '
                    + '`/setup founders role` before these can be worn.')],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    // The role is the entitlement. Checked on every press rather than recorded
    // once, so losing the role loses the skins — which is what a role is for.
    if (!hasEarlyRole(interaction.member, roleId)) {
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('Early Members only')
                    .setDescription(`These belong to the first ${founderLimit(ctx)} members `
                    + `of ${SERVER}. The role is given automatically while there is room, `
                    + 'and it is full now.')],
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }
    const skin = skinById(id.slice('fs:wear:'.length));
    if (!skin)
        return true;
    await applyFounderSkin(ctx, interaction, link.steamId, skin);
    return true;
}
async function applyFounderSkin(ctx, interaction, steamId, skin) {
    if (!skin) {
        await interaction.reply({
            embeds: [new EmbedBuilder().setColor(COLORS.warn).setTitle('No such skin')
                    .setDescription('Pick one of the three above.')],
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
//# sourceMappingURL=founders.js.map