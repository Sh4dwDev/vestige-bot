import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
const CONDITIONS = [
    {
        index: 1,
        label: 'Visit a Sanctuary as a juvenile',
        passive: false,
        hint: 'Step inside any Sanctuary boundary while still a juvenile.',
    },
    {
        index: 2,
        label: 'Get nested in',
        passive: false,
        hint: 'Be born from another player’s nest, from the character select screen.',
    },
    {
        index: 3,
        label: 'Perfect diet',
        passive: false,
        hint: 'Hold at least 1% of all three of β, γ and α at the same time.',
    },
    {
        index: 4,
        label: 'Visit a Mass Migration zone',
        passive: false,
        hint: 'Stand inside an active Mass Migration zone.',
    },
    {
        index: 5,
        label: 'Visit 2 Migration zones',
        passive: false,
        hint: 'Two different ordinary Migration zones, over your whole life.',
    },
    {
        index: 6,
        label: 'Visit 4 Patrol zones',
        passive: false,
        hint: 'Four different Patrol zones, over your whole life.',
    },
    { index: 7, label: 'Never be infertile', passive: true },
    { index: 8, label: 'Never get muscle spasms', passive: true },
    {
        index: 9,
        label: 'Raise children to subadult',
        passive: false,
        hint: 'Hatch your nest and get a joiner to about 50% growth. The hardest one.',
    },
    { index: 10, label: 'Be a small species', passive: true },
];
const BY_INDEX = new Map(CONDITIONS.map((c) => [c.index, c]));
/**
 * Prime is **5 of 10**, not all ten — and 4 for the small species.
 *
 * The panel used to say "8 still to go", which was wrong in the way that
 * matters: it told people the thing was hopeless when they were two conditions
 * from having it.
 *
 * Which species count as small is not hardcoded. Condition 10 *is* that
 * question, already answered by the game, so it is read rather than guessed.
 */
export const conditionsNeeded = (state) => (state.conditions['10'] === true ? 4 : 5);
/** Everything has to be met before this, after which the window has closed. */
export const PRIME_DEADLINE_GROWTH = 0.75;
export function conditionsOf(state) {
    return Object.entries(state.conditions)
        .map(([key, met]) => {
        const index = Number.parseInt(key, 10);
        const known = BY_INDEX.get(index);
        return {
            index,
            met,
            label: known?.label ?? `Condition ${index}`,
            passive: known?.passive ?? false,
            ...(known?.hint ? { hint: known.hint } : {}),
        };
    })
        .filter((c) => Number.isFinite(c.index))
        .sort((a, b) => a.index - b.index);
}
const pct = (value, of = 1) => `${Math.round((value / of) * 100)}%`;
export function buildPrimeEmbed(state, ctx) {
    const conditions = conditionsOf(state);
    const met = conditions.filter((c) => c.met);
    const missing = conditions.filter((c) => !c.met);
    const needed = conditionsNeeded(state);
    const short = Math.max(0, needed - met.length);
    const past = state.growth >= PRIME_DEADLINE_GROWTH;
    const embed = new EmbedBuilder().setFooter({ text: SIGNATURE });
    if (state.eligible || short === 0) {
        return embed
            .setColor(0xfee75c)
            .setTitle('👑  Prime')
            .setDescription(`**${met.length}** conditions met, and only **${needed}** are needed — ` +
            'you have it.\n\n' +
            'Hold it to 100% growth and you become **Prime Elder**: better stats, ' +
            'a larger model, faster regeneration and an extra mutation slot.');
    }
    embed
        .setColor(past ? 0xed4245 : 0x5865f2)
        .setTitle(past ? '👑  Prime — window closed' : '👑  Prime progress')
        .setDescription(`**${met.length} of ${needed}** conditions met. **${short}** to go.\n` +
        (past
            ? `\n❌ You are at **${pct(state.growth)}** growth. Everything has to be ` +
                'done before **75%**, so this one cannot become Prime now — but it ' +
                'still counts for next time.'
            : `\n⏳ All of it must be done before **75%** growth. You are at ` +
                `**${pct(state.growth)}**.`));
    // Only what somebody can still act on. Listing "never be infertile" as a
    // to-do is noise — it is not a task, it is something already lost — and once
    // the window has shut nothing is actionable at all, so seven suggestions
    // would be a lie dressed up as help.
    const actionable = past ? [] : missing.filter((c) => !c.passive);
    if (actionable.length > 0) {
        embed.addFields({
            name: `📋  What you can still do (${actionable.length})`,
            value: actionable
                .map((c) => `**${c.label}**\n-# ${c.hint ?? ''}`)
                .join('\n'),
        });
    }
    // Not "lost": for most animals the species condition was never available in
    // the first place, and telling somebody they lost their own species reads as
    // a bug rather than a rule.
    const unavailable = past ? [] : missing.filter((c) => c.passive);
    if (unavailable.length > 0) {
        embed.addFields({
            name: '🔒  Not available on this one',
            value: `${unavailable.map((c) => `• ${c.label}`).join('\n')}\n` +
                '-# Decided at birth, or already lost. Nothing can change these now.',
        });
    }
    if (met.length > 0 && !past) {
        embed.addFields({
            name: `✅  Met (${met.length})`,
            value: met.map((c) => `• ${c.label}`).join('\n'),
        });
    }
    void ctx;
    void SERVER;
    return embed;
}
/** The raw flags, for checking the table above against a live animal. */
export function buildPrimeDebugEmbed(state, who) {
    const conditions = conditionsOf(state);
    return new EmbedBuilder()
        .setColor(0x4f545c)
        .setTitle('🔬  Raw prime flags')
        .setDescription(`For ${who}. Needs **${conditionsNeeded(state)}** of 10, before 75% growth.`)
        .addFields({
        name: 'Conditions',
        value: conditions.map((c) => `\`${String(c.index).padStart(2)}\` ${c.met ? '✅' : '❌'}  ${c.label}`
            + (c.passive ? ' _(passive)_' : '')).join('\n'),
    }, {
        name: 'Vitals',
        value: `\`growth   \` ${state.growth.toFixed(4)}\n` +
            `\`health   \` ${state.health.toFixed(1)} / ${state.maxHealth.toFixed(1)}\n` +
            `\`hunger   \` ${state.hunger.toFixed(1)} / ${state.maxHunger.toFixed(1)}\n` +
            `\`thirst   \` ${state.thirst.toFixed(1)} / ${state.maxThirst.toFixed(1)}\n` +
            `\`elder    \` ${state.elderStacks} stack(s)\n` +
            `\`eligible \` ${state.eligible}`,
    })
        .setFooter({ text: SIGNATURE });
}
//# sourceMappingURL=prime.js.map