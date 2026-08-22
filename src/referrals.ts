import { EmbedBuilder, type Client, type GuildMember } from 'discord.js';

import { SERVER, SIGNATURE } from './brand.js';
import type { Ctx } from './commands.js';
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
} as const;

/** About eight hours of play at the default rate: worth having, not worth farming. */
const DEFAULT_REWARD = 500;
/** Smaller, and paid to the newcomer, so linking has an immediate point to it. */
const DEFAULT_WELCOME = 250;
const DEFAULT_MINUTES = 60;
const DEFAULT_WEEKLY_CAP = 5;

const number = (ctx: Ctx, key: string, fallback: number): number => {
  const raw = Number.parseFloat(ctx.db.getSetting(key) ?? '');
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
};

export const referralsEnabled = (ctx: Ctx): boolean =>
  ctx.db.getSetting(KEYS.enabled) === '1';

export const setReferralsEnabled = (ctx: Ctx, on: boolean): void =>
  ctx.db.setSetting(KEYS.enabled, on ? '1' : '');

export const referralReward = (ctx: Ctx): number => number(ctx, KEYS.reward, DEFAULT_REWARD);
export const referralWelcome = (ctx: Ctx): number => number(ctx, KEYS.welcome, DEFAULT_WELCOME);
export const referralMinutes = (ctx: Ctx): number => number(ctx, KEYS.minutes, DEFAULT_MINUTES);
export const referralWeeklyCap = (ctx: Ctx): number =>
  number(ctx, KEYS.weekly, DEFAULT_WEEKLY_CAP);

export function setReferralAmounts(
  ctx: Ctx,
  values: { reward?: number; welcome?: number; minutes?: number; weekly?: number },
): void {
  if (values.reward !== undefined) ctx.db.setSetting(KEYS.reward, String(values.reward));
  if (values.welcome !== undefined) ctx.db.setSetting(KEYS.welcome, String(values.welcome));
  if (values.minutes !== undefined) ctx.db.setSetting(KEYS.minutes, String(values.minutes));
  if (values.weekly !== undefined) ctx.db.setSetting(KEYS.weekly, String(values.weekly));
}

// ------------------------------------------------------------ invite tracking --

/**
 * Uses per invite code, per guild, as they were at the last check.
 *
 * Discord never says which invite somebody used. The only way to know is to
 * hold the counts from a moment ago and find the one that went up, which means
 * this cache is the whole mechanism rather than an optimisation.
 */
const uses = new Map<string, Map<string, number>>();

/** Who created each code, so an inviter is still known after they delete it. */
const owners = new Map<string, Map<string, string>>();

export async function cacheInvites(client: Client, log: (m: string) => void): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch();
      const counts = new Map<string, number>();
      const by = new Map<string, string>();
      for (const invite of invites.values()) {
        counts.set(invite.code, invite.uses ?? 0);
        if (invite.inviter) by.set(invite.code, invite.inviter.id);
      }
      uses.set(guild.id, counts);
      owners.set(guild.id, by);
    } catch {
      // Almost always the missing permission rather than anything transient.
      log(`referrals: cannot read invites for ${guild.name} — the bot needs `
        + '**Manage Server**, and without it nobody can be credited');
    }
  }
}

/** Exposed for tests: which code went up between two readings. */
export function whichInviteGrew(
  before: Map<string, number>,
  after: Map<string, number>,
): string | null {
  const grew: string[] = [];
  for (const [code, count] of after) {
    if (count > (before.get(code) ?? 0)) grew.push(code);
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
export async function noteJoin(
  ctx: Ctx,
  member: GuildMember,
  log: (m: string) => void,
): Promise<void> {
  if (!referralsEnabled(ctx)) return;
  if (member.user.bot) return;

  try {
    const guild = member.guild;
    const before = uses.get(guild.id) ?? new Map<string, number>();

    const invites = await guild.invites.fetch();
    const after = new Map<string, number>();
    const by = owners.get(guild.id) ?? new Map<string, string>();
    for (const invite of invites.values()) {
      after.set(invite.code, invite.uses ?? 0);
      if (invite.inviter) by.set(invite.code, invite.inviter.id);
    }
    uses.set(guild.id, after);
    owners.set(guild.id, by);

    const code = whichInviteGrew(before, after);
    if (!code) return;

    const inviter = by.get(code);
    if (!inviter || inviter === member.id) return;

    ctx.db.recordReferral(member.id, inviter);
    log(`referrals: ${member.id} joined via ${code} from ${inviter}`);
  } catch (err) {
    log(`referrals: could not work out who invited ${member.id}: ${
      err instanceof Error ? err.message : String(err)}`);
  }
}

// ------------------------------------------------------------------ payouts --

export type LinkOutcome = 'attached' | 'already-referred' | 'not-referred' | 'self' | 'existing';

/**
 * Called when somebody links, to tie their Steam account to their referral.
 *
 * This is where an alt is caught. The account has to be new to the bot: a
 * Steam ID already seen in game, or already carrying playtime, belongs to
 * somebody who was here anyway and was not brought by the person claiming them.
 */
export function noteLink(ctx: Ctx, discordId: string, steamId: string): LinkOutcome {
  if (!referralsEnabled(ctx)) return 'not-referred';

  const referral = ctx.db.referralFor(discordId);
  if (!referral || referral.paidAt) return 'not-referred';

  const inviterLink = ctx.db.linkFor(referral.inviterDiscord);
  if (inviterLink?.steamId === steamId) return 'self';

  // Seen in game before they were invited, or already carrying playtime: an
  // existing player, however they arrived in the Discord.
  const seen = ctx.db.gameName(steamId) !== null;
  const played = ctx.db.pointsFor(steamId).minutes > 0;
  if (seen || played) return 'existing';

  return ctx.db.attachReferralSteam(discordId, steamId) ? 'attached' : 'already-referred';
}

export interface Payout {
  inviterDiscord: string;
  inviteeDiscord: string;
  reward: number;
  welcome: number;
  welcomeSteam: string;
}

/**
 * Pays every referral that has come good since the last check.
 *
 * Deliberately not called from the link handler: the requirement is playtime,
 * which only accrues later, so this runs on the same poll that awards it.
 */
export function collectPayouts(ctx: Ctx, now = new Date()): Payout[] {
  if (!referralsEnabled(ctx)) return [];

  const required = referralMinutes(ctx);
  const reward = referralReward(ctx);
  const welcome = referralWelcome(ctx);
  const cap = referralWeeklyCap(ctx);
  const weekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

  const paid: Payout[] = [];

  for (const referral of ctx.db.pendingReferrals()) {
    const steamId = referral.inviteeSteam;
    if (!steamId) continue;
    if (ctx.db.pointsFor(steamId).minutes < required) continue;

    // Counted per payout rather than once, so a backlog cannot all land at once
    // and slip past the cap together.
    if (cap > 0 && ctx.db.paidReferralsSince(referral.inviterDiscord, weekAgo) >= cap) continue;

    const inviterLink = ctx.db.linkFor(referral.inviterDiscord);

    // Marked paid either way. An inviter who never linked cannot be credited in
    // points, and leaving the row pending would retry it on every poll forever.
    ctx.db.markReferralPaid(referral.inviteeDiscord, inviterLink ? reward : 0);
    if (!inviterLink) continue;

    ctx.db.addPoints(inviterLink.steamId, reward, 0);
    if (welcome > 0) ctx.db.addPoints(steamId, welcome, 0);

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
export async function tellInviter(client: Client, payout: Payout): Promise<void> {
  try {
    const user = await client.users.fetch(payout.inviterDiscord);
    await user.send({
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('🎉  Your invite paid off')
        .setDescription(
          `<@${payout.inviteeDiscord}> joined ${SERVER} through your invite, ` +
          'linked, and has played long enough to count.\n\n' +
          `**+${display(payout.reward).toLocaleString()} points** to you` +
          (payout.welcome > 0
            ? `, and **${display(payout.welcome).toLocaleString()}** to them as a welcome.`
            : '.'),
        )
        .setFooter({ text: SIGNATURE })],
    });
  } catch {
    // They have DMs closed, or have left. Nothing worth logging.
  }
}

export function buildReferralEmbed(
  ctx: Ctx,
  counts: { total: number; paid: number; pending: number },
  top: Array<{ inviterDiscord: string; count: number }>,
): EmbedBuilder {
  const on = referralsEnabled(ctx);

  return new EmbedBuilder()
    .setColor(on ? 0x57f287 : 0x4f545c)
    .setTitle('🤝  Referrals')
    .setDescription(
      on
        ? `**On.** ${display(referralReward(ctx)).toLocaleString()} points to the ` +
          `inviter once their friend links and plays **${referralMinutes(ctx)} ` +
          `minutes**, and ${display(referralWelcome(ctx)).toLocaleString()} to the ` +
          'friend.'
        : '**Off.** Nobody is being credited for invites.',
    )
    .addFields(
      {
        name: 'So far',
        value:
          `• **${counts.paid}** paid\n` +
          `• **${counts.pending}** linked and waiting on playtime\n` +
          `• **${counts.total}** joined through an invite`,
      },
      {
        name: 'Limits',
        value:
          `• At most **${referralWeeklyCap(ctx)}** paid per person per week\n` +
          '• A Steam account can be referred **once, ever**\n' +
          '• Players already known to the bot do not count\n' +
          '• You cannot refer yourself',
      },
      ...(top.length > 0
        ? [{
          name: 'Most invites that stuck',
          value: top.map((t, n) => `**${n + 1}.** <@${t.inviterDiscord}> — ${t.count}`).join('\n'),
        }]
        : []),
    )
    .setFooter({ text: SIGNATURE });
}
