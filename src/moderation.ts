import { EmbedBuilder, MessageFlags, type ChatInputCommandInteraction } from 'discord.js';

import { SIGNATURE } from './brand.js';
import { describeError, type Ctx } from './commands.js';

/**
 * Staff tools: moderation over RCON, and the small in-game favours admins get
 * asked for constantly.
 *
 * Everything here is **audited**. A kick or a ban that leaves no trace of who
 * did it is how a staff team ends up arguing about what happened, so each one
 * logs and posts to the staff channel if there is one.
 *
 * Two of these are toggles with no way to read the current state — whitelist
 * and global chat — so the reply from the server is the only truth about which
 * way they went, and it is shown verbatim rather than guessed at.
 */

const COLORS = { good: 0x57f287, bad: 0xed4245, warn: 0xfee75c, info: 0x5865f2 };
const LOG_KEY = 'mod_log_channel';

const embed = (color: number, title: string, description: string): EmbedBuilder =>
  new EmbedBuilder().setColor(color).setTitle(title).setDescription(description)
    .setFooter({ text: SIGNATURE }).setTimestamp();

export function setModLogChannel(ctx: Ctx, channelId: string | null): void {
  ctx.db.setSetting(LOG_KEY, channelId ?? '');
}

export function modLogChannel(ctx: Ctx): string | null {
  return ctx.db.getSetting(LOG_KEY) || null;
}

/** Never throws: an audit line failing must not fail the action itself. */
async function audit(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  title: string,
  detail: string,
): Promise<void> {
  const channelId = modLogChannel(ctx);
  if (!channelId) return;
  const channel = await i.client.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased() && 'send' in channel) {
    await channel.send({
      embeds: [embed(COLORS.info, title, `${detail}\n\nBy ${i.user} (${i.user.tag})`)],
    }).catch(() => undefined);
  }
}

/**
 * The Steam ID for a Discord user, or null with the reason already replied.
 *
 * Staff act on Discord users; the server only knows Steam IDs. Everything here
 * needs that translation, and it fails the same way every time.
 */
async function steamFor(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  optionName = 'user',
): Promise<{ steamId: string; label: string } | null> {
  const user = i.options.getUser(optionName, true);
  const link = ctx.db.linkFor(user.id);
  if (!link) {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Not linked',
        `${user} has not linked a Steam account, so the server does not know ` +
        'who they are. Ask them to run `/link`, or use the raw Steam ID with ' +
        'the game panel.')],
    });
    return null;
  }
  return { steamId: link.steamId, label: `${user} (\`${link.steamId}\`)` };
}

// -------------------------------------------------------------- moderation --

export async function handleModeration(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  if (action === 'log') {
    const channel = i.options.getChannel('channel', true);
    setModLogChannel(ctx, channel.id);
    await i.reply({
      embeds: [embed(COLORS.good, 'Staff log set',
        `Kicks, bans and whitelist changes will be posted in <#${channel.id}>, ` +
        'with who did them.')],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    if (action === 'kick') {
      const target = await steamFor(ctx, i);
      if (!target) return;
      const reason = i.options.getString('reason') ?? '';

      // Told first, then removed: being dropped with no explanation is how a
      // kick turns into a Discord argument.
      if (reason) await ctx.mod.notify(target.steamId, `Kicked: ${reason}`);
      const reply = await ctx.rcon.kick(target.steamId);

      await i.editReply({
        embeds: [embed(COLORS.good, 'Kicked',
          `${target.label} has been removed. They can rejoin straight away.` +
          (reason ? `\n\nReason: ${reason}` : '') +
          (reply ? `\n\nServer said: \`${reply}\`` : ''))],
      });
      await audit(ctx, i, 'Player kicked', `${target.label}${reason ? `\nReason: ${reason}` : ''}`);
      return;
    }

    if (action === 'ban') {
      const target = await steamFor(ctx, i);
      if (!target) return;
      const user = i.options.getUser('user', true);
      const reason = i.options.getString('reason') ?? 'No reason given';
      const hours = i.options.getInteger('hours') ?? 0;

      const reply = await ctx.rcon.ban(user.username, target.steamId, reason, hours);

      await i.editReply({
        embeds: [embed(COLORS.bad, hours > 0 ? `Banned for ${hours}h` : 'Banned permanently',
          `${target.label}\n\nReason: ${reason}` +
          (reply ? `\n\nServer said: \`${reply}\`` : '') +
          '\n\nThis bans the Steam account on the game server. It does not touch ' +
          'their Discord account.')],
      });
      await audit(ctx, i, hours > 0 ? `Player banned (${hours}h)` : 'Player banned permanently',
        `${target.label}\nReason: ${reason}`);
      return;
    }

    if (action === 'whitelist') {
      const mode = i.options.getString('mode', true);

      if (mode === 'toggle') {
        const reply = await ctx.rcon.toggleWhitelist();
        await i.editReply({
          embeds: [embed(COLORS.warn, 'Whitelist toggled',
            `Server said: \`${reply || '(no reply)'}\`\n\n` +
            '⚠️ This is a **toggle**, not a switch — there is no way to ask the ' +
            'server which state it is in, so the reply above is the only answer. ' +
            'Run it twice and you are back where you started.')],
        });
        await audit(ctx, i, 'Whitelist toggled', `Server said: ${reply || '(no reply)'}`);
        return;
      }

      const target = await steamFor(ctx, i);
      if (!target) return;

      const reply = mode === 'add'
        ? await ctx.rcon.addWhitelist([target.steamId])
        : await ctx.rcon.removeWhitelist([target.steamId]);

      await i.editReply({
        embeds: [embed(COLORS.good, mode === 'add' ? 'Added to the whitelist' : 'Removed',
          `${target.label}` + (reply ? `\n\nServer said: \`${reply}\`` : ''))],
      });
      await audit(ctx, i, mode === 'add' ? 'Whitelisted' : 'Removed from whitelist', target.label);
      return;
    }

    if (action === 'globalchat') {
      const reply = await ctx.rcon.toggleGlobalChat();
      await i.editReply({
        embeds: [embed(COLORS.warn, 'Global chat toggled',
          `Server said: \`${reply || '(no reply)'}\`\n\n` +
          '⚠️ A **toggle** with no readable state, so the reply is the only ' +
          'answer. Useful for cooling a room down without banning anybody.')],
      });
      await audit(ctx, i, 'Global chat toggled', `Server said: ${reply || '(no reply)'}`);
      return;
    }

    if (action === 'say') {
      const message = i.options.getString('message', true);
      await ctx.rcon.announce(message);
      await i.editReply({
        embeds: [embed(COLORS.good, 'Announced',
          `Sent to everyone in game:\n\n> ${message}`)],
      });
      await audit(ctx, i, 'Announcement', message);
      return;
    }

    if (action === 'tell') {
      const target = await steamFor(ctx, i);
      if (!target) return;
      const message = i.options.getString('message', true);

      const shown = await ctx.mod.notify(target.steamId, message);
      await i.editReply({
        embeds: [shown
          ? embed(COLORS.good, 'Told them',
            `${target.label} sees this on screen:\n\n> ${message}`)
          : embed(COLORS.warn, 'Could not show it',
            `${target.label} is not on a dinosaur right now, so there is nothing ` +
            'to draw the notice over. They may be in admin cam or on the spawn ' +
            'screen.')],
      });
      return;
    }
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not do that', describeError(err))],
    });
  }
}

// --------------------------------------------------------------- in game --

/**
 * The small favours: patch someone up, or move people around.
 *
 * `bring` and `goto` are the same mod verb with the ends swapped, which is why
 * they read as one thing here rather than two.
 */
export async function handleInGame(
  ctx: Ctx,
  i: ChatInputCommandInteraction,
  action: string,
): Promise<void> {
  await i.deferReply({ flags: MessageFlags.Ephemeral });

  const me = ctx.db.linkFor(i.user.id);
  if (!me && action !== 'heal') {
    await i.editReply({
      embeds: [embed(COLORS.warn, 'Link first',
        'This moves someone relative to **you**, so the bot needs to know which ' +
        'character is yours. Run `/link`.')],
    });
    return;
  }

  try {
    const target = await steamFor(ctx, i);
    if (!target) return;

    if (action === 'heal') {
      const result = await ctx.mod.run('heal', target.steamId, {});
      await i.editReply({
        embeds: [result.ok
          ? embed(COLORS.good, 'Patched up',
            `${target.label} is back to full health, food, water and stamina.\n\n` +
            'Growth and mutations are untouched.')
          : embed(COLORS.bad, 'Could not heal them', result.msg)],
      });
      if (result.ok) await ctx.mod.notify(target.steamId, 'An admin has healed you.');
      await audit(ctx, i, 'Player healed', target.label);
      return;
    }

    // bring: them to me. goto: me to them.
    const mover = action === 'bring' ? target.steamId : me!.steamId;
    const destination = action === 'bring' ? me!.steamId : target.steamId;

    const result = await ctx.mod.run('teleport', mover, { to: destination });
    await i.editReply({
      embeds: [result.ok
        ? embed(COLORS.good, action === 'bring' ? 'Brought them to you' : 'Moved you to them',
          `${result.msg}\n\n${target.label}`)
        : embed(COLORS.bad, 'Could not move anyone', result.msg)],
    });
    await audit(ctx, i, action === 'bring' ? 'Player brought to admin' : 'Admin moved to player',
      target.label);
  } catch (err) {
    await i.editReply({
      embeds: [embed(COLORS.bad, 'Could not do that', describeError(err))],
    });
  }
}
