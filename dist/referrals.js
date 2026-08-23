import { EmbedBuilder } from 'discord.js';
import { SERVER, SIGNATURE } from './brand.js';
import { display } from './points.js';
/**
 * Points for bringing somebody who actually plays.
 *
 * **What it pays for matters more than the amount.** Paying on join rewards
 * mass-inviting strangers, which fills a Discord with people who never log in
 * and makes the server look busier than it is. So nothing is paid until the
 * invited player has linked a Steam account *and* put real time in on the
 * island — the behaviour worth rewarding is bringing somebody who stays.
 *
 * ## What stops it being farmed
 *
 * The obvious attack is inviting yourself on a second account, so the guards
 * are aimed squarely at that:
 *
 * - **A Steam account can be referred once, ever**, enforced by a unique index
 *   rather than a check that can be raced. Leaving and rejoining on a fresh
 *   Discord account earns nothing, because the reward is owed against the game
 *   account and that one is already spent.
 * - **A Steam account is a purchase.** The Isle is not free, so every fake
 *   referral costs the price of the game. That is the real defence; everything
 *   else here is tidying up around it.
 * - **You cannot refer yourself**, by Discord account or by Steam account.
 * - **Existing players do not count.** Somebody already known to the bot —
 *   linked, or seen in game — was not brought by anybody.
 * - **An hour in game**, not an hour idling in Discord. It comes from the same
 *   minutes the points system already counts, so it means time on the server.
 * - **A weekly cap per inviter**, so even a determined farmer with a shelf of
 *   Steam accounts cannot turn this into an income.
 *
 * None of this makes abuse impossible. It makes it cost more than it pays,
 * which is the most any reward scheme can honestly claim.
 */
const KEYS = {
    enabled: 'referrals_enabled',
    reward: 'referrals_reward',
    welcome: 'referrals_welcome',
    minutes: 'referrals_minutes',
    weekly: 'referrals_weekly_cap',
    existing: 'referrals_existing_minutes',
};
/** About eight hours of play at the default rate: worth having, not worth farming. */
const DEFAULT_REWARD = 500;
/** Smaller, and paid to the newcomer, so linking has an immediate point to it. */
const DEFAULT_WELCOME = 250;
const DEFAULT_MINUTES = 60;
const DEFAULT_WEEKLY_CAP = 5;
/**
 * Playtime that marks somebody out as an existing player rather than a newcomer.
 *
 * Only used when there is no first sighting on record. Somebody linking in
 * their first session has a handful of minutes; two hours means they were
 * already playing here.
 */
const DEFAULT_EXISTING_MINUTES = 120;
const number = (ctx, key, fallback) => {
    const raw = Number.parseFloat(ctx.db.getSetting(key) ?? '');
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};
export const referralsEnabled = (ctx) => ctx.db.getSetting(KEYS.enabled) === '1';
export const setReferralsEnabled = (ctx, on) => ctx.db.setSetting(KEYS.enabled, on ? '1' : '');
export const referralReward = (ctx) => number(ctx, KEYS.reward, DEFAULT_REWARD);
export const referralWelcome = (ctx) => number(ctx, KEYS.welcome, DEFAULT_WELCOME);
export const referralMinutes = (ctx) => number(ctx, KEYS.minutes, DEFAULT_MINUTES);
export const referralExistingMinutes = (ctx) => number(ctx, KEYS.existing, DEFAULT_EXISTING_MINUTES);
export const setReferralExistingMinutes = (ctx, minutes) => ctx.db.setSetting(KEYS.existing, String(Math.max(0, Math.round(minutes))));
export const referralWeeklyCap = (ctx) => number(ctx, KEYS.weekly, DEFAULT_WEEKLY_CAP);
export function setReferralAmounts(ctx, values) {
    if (values.reward !== undefined)
        ctx.db.setSetting(KEYS.reward, String(values.reward));
    if (values.welcome !== undefined)
        ctx.db.setSetting(KEYS.welcome, String(values.welcome));
    if (values.minutes !== undefined)
        ctx.db.setSetting(KEYS.minutes, String(values.minutes));
    if (values.weekly !== undefined)
        ctx.db.setSetting(KEYS.weekly, String(values.weekly));
}
// ------------------------------------------------------------ invite tracking --
/**
 * Uses per invite code, per guild, as they were at the last check.
 *
 * Discord never says which invite somebody used. The only way to know is to
 * hold the counts from a moment ago and find the one that went up, which means
 * this cache is the whole mechanism rather than an optimisation.
 */
const uses = new Map();
/** Who created each code, so an inviter is still known after they delete it. */
const owners = new Map();
export async function cacheInvites(client, log) {
    for (const guild of client.guilds.cache.values()) {
        try {
            const invites = await guild.invites.fetch();
            const counts = new Map();
            const by = new Map();
            for (const invite of invites.values()) {
                counts.set(invite.code, invite.uses ?? 0);
                if (invite.inviter)
                    by.set(invite.code, invite.inviter.id);
            }
            uses.set(guild.id, counts);
            owners.set(guild.id, by);
        }
        catch {
            // Almost always the missing permission rather than anything transient.
            log(`referrals: cannot read invites for ${guild.name} — the bot needs `
                + '**Manage Server**, and without it nobody can be credited');
        }
    }
}
/** Exposed for tests: which code went up between two readings. */
export function whichInviteGrew(before, after) {
    const grew = [];
    for (const [code, count] of after) {
        if (count > (before.get(code) ?? 0))
            grew.push(code);
    }
    // Two joins between polls can leave two codes up. Crediting either would be a
    // guess, and a wrong credit is worse than none.
    return grew.length === 1 ? (grew[0] ?? null) : null;
}
/**
 * Works out who invited a new member, and records it.
 *
 * Never throws into the join handler: failing to credit somebody is a missed
 * reward, while throwing here would break the join role as well.
 */
export async function noteJoin(ctx, member, log) {
    if (!referralsEnabled(ctx))
        return;
    if (member.user.bot)
        return;
    try {
        const guild = member.guild;
        const before = uses.get(guild.id) ?? new Map();
        const invites = await guild.invites.fetch();
        const after = new Map();
        const by = owners.get(guild.id) ?? new Map();
        for (const invite of invites.values()) {
            after.set(invite.code, invite.uses ?? 0);
            if (invite.inviter)
                by.set(invite.code, invite.inviter.id);
        }
        uses.set(guild.id, after);
        owners.set(guild.id, by);
        const code = whichInviteGrew(before, after);
        if (!code)
            return;
        const inviter = by.get(code);
        if (!inviter || inviter === member.id)
            return;
        ctx.db.recordReferral(member.id, inviter);
        log(`referrals: ${member.id} joined via ${code} from ${inviter}`);
    }
    catch (err) {
        log(`referrals: could not work out who invited ${member.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
/**
 * Called when somebody links, to tie their Steam account to their referral.
 *
 * This is where an alt is caught. The account has to be new to the bot: a
 * Steam ID already seen in game, or already carrying playtime, belongs to
 * somebody who was here anyway and was not brought by the person claiming them.
 */
/**
 * Was this account playing here *before* the invite?
 *
 * The original test asked whether they had ever been seen in game, or had any
 * playtime at all — and rejected every legitimate invitee, because linking
 * happens by typing a code **in game**. Being in game is what the check treated
 * as disqualifying, so nobody could ever satisfy it. Eleven referrals, none
 * attached, none paid.
 *
 * The honest question is about order, not existence:
 *
 * - **A first sighting before the invite** is decisive, and exact.
 * - **No first sighting on record** — the column is newer than they are — falls
 *   back to how much they have played. Somebody linking in their first session
 *   has minutes; an established player has hours.
 */
export function wasAlreadyPlaying(ctx, steamId, joinedAt) {
    const first = ctx.db.firstSeen(steamId);
    if (first !== null) {
        const seen = Date.parse(first);
        const invited = Date.parse(joinedAt);
        // An unparseable date decides nothing; fall through to playtime rather than
        // guessing in either direction.
        // `<=`, not `<`: somebody already known at the very moment of the invite
        // was here first. The boundary errs towards refusing a doubtful referral
        // rather than paying one.
        if (Number.isFinite(seen) && Number.isFinite(invited))
            return seen <= invited;
    }
    return ctx.db.pointsFor(steamId).minutes >= referralExistingMinutes(ctx);
}
export function noteLink(ctx, discordId, steamId) {
    if (!referralsEnabled(ctx))
        return 'not-referred';
    const referral = ctx.db.referralFor(discordId);
    if (!referral || referral.paidAt)
        return 'not-referred';
    const inviterLink = ctx.db.linkFor(referral.inviterDiscord);
    if (inviterLink?.steamId === steamId)
        return 'self';
    if (wasAlreadyPlaying(ctx, steamId, referral.joinedAt))
        return 'existing';
    return ctx.db.attachReferralSteam(discordId, steamId) ? 'attached' : 'already-referred';
}
/**
 * Pays every referral that has come good since the last check.
 *
 * Deliberately not called from the link handler: the requirement is playtime,
 * which only accrues later, so this runs on the same poll that awards it.
 */
export function collectPayouts(ctx, now = new Date()) {
    if (!referralsEnabled(ctx))
        return [];
    const required = referralMinutes(ctx);
    const reward = referralReward(ctx);
    const welcome = referralWelcome(ctx);
    const cap = referralWeeklyCap(ctx);
    const weekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    const paid = [];
    for (const referral of ctx.db.pendingReferrals()) {
        const steamId = referral.inviteeSteam;
        if (!steamId)
            continue;
        if (ctx.db.pointsFor(steamId).minutes < required)
            continue;
        // Counted per payout rather than once, so a backlog cannot all land at once
        // and slip past the cap together.
        if (cap > 0 && ctx.db.paidReferralsSince(referral.inviterDiscord, weekAgo) >= cap)
            continue;
        const inviterLink = ctx.db.linkFor(referral.inviterDiscord);
        // Marked paid either way. An inviter who never linked cannot be credited in
        // points, and leaving the row pending would retry it on every poll forever.
        ctx.db.markReferralPaid(referral.inviteeDiscord, inviterLink ? reward : 0);
        if (!inviterLink)
            continue;
        ctx.db.addPoints(inviterLink.steamId, reward, 0);
        if (welcome > 0)
            ctx.db.addPoints(steamId, welcome, 0);
        paid.push({
            inviterDiscord: referral.inviterDiscord,
            inviteeDiscord: referral.inviteeDiscord,
            reward,
            welcome,
            welcomeSteam: steamId,
        });
    }
    return paid;
}
/** Best effort: a closed DM must not stop the points being paid. */
export async function tellInviter(client, payout) {
    try {
        const user = await client.users.fetch(payout.inviterDiscord);
        await user.send({
            embeds: [new EmbedBuilder()
                    .setColor(0x57f287)
                    .setTitle('🎉  Your invite paid off')
                    .setDescription(`<@${payout.inviteeDiscord}> joined ${SERVER} through your invite, ` +
                    'linked, and has played long enough to count.\n\n' +
                    `**+${display(payout.reward).toLocaleString()} points** to you` +
                    (payout.welcome > 0
                        ? `, and **${display(payout.welcome).toLocaleString()}** to them as a welcome.`
                        : '.'))
                    .setFooter({ text: SIGNATURE })],
        });
    }
    catch {
        // They have DMs closed, or have left. Nothing worth logging.
    }
}
export function buildReferralEmbed(ctx, counts, top) {
    const on = referralsEnabled(ctx);
    return new EmbedBuilder()
        .setColor(on ? 0x57f287 : 0x4f545c)
        .setTitle('🤝  Referrals')
        .setDescription(on
        ? `**On.** ${display(referralReward(ctx)).toLocaleString()} points to the ` +
            `inviter once their friend links and plays **${referralMinutes(ctx)} ` +
            `minutes**, and ${display(referralWelcome(ctx)).toLocaleString()} to the ` +
            'friend.'
        : '**Off.** Nobody is being credited for invites.')
        .addFields({
        name: 'So far',
        value: `• **${counts.paid}** paid\n` +
            `• **${counts.pending}** linked and waiting on playtime\n` +
            `• **${counts.total}** joined through an invite`,
    }, {
        name: 'Limits',
        value: `• At most **${referralWeeklyCap(ctx)}** paid per person per week\n` +
            '• A Steam account can be referred **once, ever**\n' +
            '• Players already known to the bot do not count\n' +
            '• You cannot refer yourself',
    }, ...(top.length > 0
        ? [{
                name: 'Most invites that stuck',
                value: top.map((t, n) => `**${n + 1}.** <@${t.inviterDiscord}> — ${t.count}`).join('\n'),
            }]
        : []))
        .setFooter({ text: SIGNATURE });
}
/**
 * Attaches Steam accounts to referrals the broken guard rejected.
 *
 * Every referral before this fix was left with no Steam account, so there is
 * nothing on them to pay against and the poll will never look at them again.
 * They are not recoverable by waiting — the attach only ever happened at the
 * moment of linking, and that moment has passed.
 *
 * This walks them and does what the link handler should have. It runs the same
 * checks, so a genuine existing player is still refused and nobody is credited
 * for somebody who was already here.
 */
export function repairReferrals(ctx) {
    const out = { attached: 0, unlinked: 0, existing: 0, refused: 0 };
    for (const row of ctx.db.unattachedReferrals()) {
        const link = ctx.db.linkFor(row.inviteeDiscord);
        // Still not linked. Nothing is owed yet, and the link handler will catch
        // them properly now that it works.
        if (!link) {
            out.unlinked += 1;
            continue;
        }
        const inviter = ctx.db.linkFor(row.inviterDiscord);
        if (inviter?.steamId === link.steamId) {
            out.refused += 1;
            continue;
        }
        if (wasAlreadyPlaying(ctx, link.steamId, row.joinedAt)) {
            out.existing += 1;
            continue;
        }
        // The unique index still has the last word: an account referred once
        // already cannot be attached to a second referral.
        if (ctx.db.attachReferralSteam(row.inviteeDiscord, link.steamId))
            out.attached += 1;
        else
            out.refused += 1;
    }
    return out;
}
//# sourceMappingURL=referrals.js.map