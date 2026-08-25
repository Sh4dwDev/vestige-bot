import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

import { SERVER } from './brand.js';
import { MAX_SLOTS } from './bridge.js';
import type { Ctx } from './commands.js';
import { slotInfo, type SlotInfo } from './market.js';
import {
  apiError,
  displayPoints,
  originAllowed,
  toVaultSlot,
  type MeResponse,
  type StatusResponse,
  type VaultResponse,
  type VaultSlot,
} from './webapi.js';
import {
  clearCookie,
  newSecret,
  newState,
  parseCookies,
  readSession,
  safeReturnPath,
  serializeCookie,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  signSession,
  STATE_COOKIE,
  STATE_TTL_MS,
} from './websession.js';

/**
 * The website API.
 *
 * This is a JSON API and a Discord sign-in, not a website. The front end is a
 * separate app, built with whatever it likes, and it talks to these endpoints.
 * `docs/API.md` is the contract and is written for whoever builds that app;
 * keep the two in step.
 *
 * It runs inside the bot process because that is the only place holding both
 * the database handle and the mod bridge. Splitting it out would mean either a
 * second writer on the SQLite file or an API on the bot to talk to, and the
 * second of those is what this already is.
 *
 * **Stage 1 reads and nothing else.** No route here changes any game state, and
 * none should until the question in `docs/WEBSITE.md` about Release and Sell
 * has an answer.
 */

const SECRET_KEY = 'web_session_secret';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Slot reads are cached per player.
 *
 * One read costs a bridge round trip of three to four seconds, and a full vault
 * needs one per occupied slot. Without this, a refresh would hammer the game
 * server and the person refreshing would wait again for an answer that cannot
 * have changed unless they alt-tabbed and stored something.
 */
const VAULT_TTL_MS = 90_000;

/** The bot polls the player list constantly anyway; this is plenty. */
const STATUS_TTL_MS = 15_000;

interface CachedVault {
  at: number;
  slots: VaultSlot[];
}

/**
 * Discord's OAuth2 endpoints.
 *
 * `identify` only. The site never needs an email, a guild list, or anything
 * else it would then be responsible for holding.
 */
const AUTHORIZE_URL = 'https://discord.com/api/oauth2/authorize';
const TOKEN_URL = 'https://discord.com/api/oauth2/token';
const ME_URL = 'https://discord.com/api/users/@me';
const SCOPE = 'identify';

export interface Website {
  server: Server;
  close: () => Promise<void>;
}

/**
 * The signing secret, kept in the database.
 *
 * Generated on first run rather than asked for in the environment, so there is
 * one fewer setting to get wrong. Living in the database also means a restart
 * does not sign everybody out, which an in-memory secret would.
 */
function sessionSecret(ctx: Ctx): string {
  const existing = ctx.db.getSetting(SECRET_KEY);
  if (existing && existing.length >= 32) return existing;

  const fresh = newSecret();
  ctx.db.setSetting(SECRET_KEY, fresh);
  return fresh;
}

/** Shown when no front end has been dropped in yet. */
const PLACEHOLDER = `<!doctype html>
<meta charset="utf-8">
<title>${SERVER}</title>
<body style="font:16px/1.6 system-ui;max-width:34rem;margin:12vh auto;padding:0 1.5rem">
<h1 style="font-size:1.4rem">${SERVER} API is running</h1>
<p>No front end is installed here. Point <code>WEB_APP_DIR</code> at a built app, or
call the API directly.</p>
<p>Start with <a href="/api/status">/api/status</a>, then <a href="/auth/login">/auth/login</a>.</p>
</body>`;

const baseHeaders = (): Record<string, string> => ({
  'referrer-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { ...baseHeaders(), ...headers });
  res.end(body);
}

const sendJson = (
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => send(res, status, JSON.stringify(body), {
  'content-type': 'application/json; charset=utf-8',
  // Every one of these answers is about one person.
  'cache-control': 'no-store',
  ...headers,
});

function redirect(res: ServerResponse, to: string, headers: Record<string, string> = {}): void {
  res.writeHead(302, { ...baseHeaders(), location: to, ...headers });
  res.end();
}

/**
 * Trades the one-time code for a token and asks Discord who it belongs to.
 *
 * Throws on anything unexpected. Every failure becomes the same answer to the
 * browser, because none of them are the player's fault or something they can
 * act on.
 */
async function identify(ctx: Ctx, code: string, redirectUri: string): Promise<string> {
  const web = ctx.config.web;
  if (!web) throw new Error('the website is not configured');

  const token = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: web.clientId,
      client_secret: web.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!token.ok) throw new Error(`token exchange failed with ${token.status}`);

  const granted = (await token.json()) as { access_token?: unknown };
  if (typeof granted.access_token !== 'string') throw new Error('no access token in the reply');

  const me = await fetch(ME_URL, {
    headers: { authorization: `Bearer ${granted.access_token}` },
  });
  if (!me.ok) throw new Error(`identify failed with ${me.status}`);

  const user = (await me.json()) as { id?: unknown };
  if (typeof user.id !== 'string') throw new Error('no user id in the reply');

  return user.id;
}

/**
 * Reads every occupied slot, through the cache.
 *
 * Sequential rather than parallel: the bridge serialises its writes anyway, and
 * firing three at once only makes the failure modes harder to read.
 */
async function readVault(
  ctx: Ctx,
  steamId: string,
  cache: Map<string, CachedVault>,
): Promise<CachedVault> {
  const hit = cache.get(steamId);
  if (hit && Date.now() - hit.at < VAULT_TTL_MS) return hit;

  const listed = await ctx.mod.run('list', steamId, {}, { quiet: true });
  if (!listed.ok) throw new Error(listed.msg || 'the game server did not answer');

  const rows = Array.isArray(listed.data) ? listed.data : [];
  const slots: VaultSlot[] = [];

  for (const row of rows) {
    const slot = (row as { slot?: unknown }).slot;
    if (typeof slot !== 'string') continue;

    const info: SlotInfo | null = await slotInfo(ctx, steamId, slot);
    // A slot the mod would not describe still exists, so it is reported with
    // what the cheaper call already told us rather than quietly dropped.
    slots.push(toVaultSlot(info ?? {
      slot,
      species: String((row as { species?: unknown }).species ?? 'Unknown'),
      growth: 0,
      female: false,
      prime: false,
      elderStacks: 0,
      mutations: [],
    }));
  }

  const fresh: CachedVault = { at: Date.now(), slots };
  cache.set(steamId, fresh);
  return fresh;
}

/**
 * Starts the API, or returns null when it is not configured.
 *
 * Never throws on a bad request or a failed Discord call. A website that can
 * take the bot down with it would be a poor trade for a page of statistics.
 */
export function startWebsite(ctx: Ctx, log: (m: string) => void): Website | null {
  const web = ctx.config.web;
  if (!web) return null;

  const secret = sessionSecret(ctx);
  const secure = web.baseUrl.startsWith('https://');
  const redirectUri = `${web.baseUrl}/auth/callback`;
  const appDir = web.appDir ? resolve(web.appDir) : null;

  /**
   * A cookie usable from another origin has to be `SameSite=None`, which
   * browsers only accept alongside `Secure`. Same-origin hosting keeps `Lax`,
   * which is safer and is the arrangement to prefer.
   */
  const sameSite: 'Lax' | 'None' = web.allowedOrigins.length > 0 ? 'None' : 'Lax';

  const vaultCache = new Map<string, CachedVault>();
  let statusCache: { at: number; online: number | null } | null = null;

  /**
   * The Steam ID for a request, resolved from the session cookie every time.
   *
   * This is the one function deciding whose data a request may see. It takes a
   * Discord ID out of a signed cookie and looks the Steam ID up in the
   * database. Nothing from the query string, the path or a header is ever
   * consulted, so there is no parameter for a caller to tamper with.
   */
  function whoIsAsking(req: IncomingMessage): { discordId: string; steamId: string | null } | null {
    const discordId = readSession(parseCookies(req.headers.cookie)[SESSION_COOKIE], secret);
    if (!discordId) return null;

    return { discordId, steamId: ctx.db.linkFor(discordId)?.steamId ?? null };
  }

  /**
   * Cross-origin headers, for a front end served from somewhere else.
   *
   * Only origins named in the configuration are answered, and the origin is
   * echoed rather than answered with `*`: a wildcard and credentials are not
   * allowed together, and for good reason.
   */
  const corsHeaders = (req: IncomingMessage): Record<string, string> => {
    const origin = req.headers.origin;
    if (!originAllowed(origin, web.allowedOrigins)) return {};

    return {
      'access-control-allow-origin': origin as string,
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      vary: 'Origin',
    };
  };

  /** Serves the built front end, with an SPA fallback to its index.html. */
  async function sendApp(res: ServerResponse, path: string): Promise<void> {
    if (!appDir) {
      send(res, 200, PLACEHOLDER, { 'content-type': 'text/html; charset=utf-8' });
      return;
    }

    // normalize collapses "..", and the result is then checked to be inside the
    // app directory. Either check on its own has been enough, on somebody
    // else's project, to serve a file well outside it.
    const wanted = resolve(join(appDir, normalize(path)));
    const inside = wanted === appDir || wanted.startsWith(appDir + sep);

    // Anything without an extension is a route in the app, not a file, so it
    // gets index.html and the router sorts it out.
    const file = inside && extname(wanted) !== '' ? wanted : join(appDir, 'index.html');
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';

    try {
      const body = await readFile(file);
      send(res, 200, body, {
        'content-type': type,
        // index.html must never be cached: it names the hashed bundles, and a
        // stale copy points at files the next deploy has already removed.
        'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
      });
    } catch {
      send(res, 404, PLACEHOLDER, { 'content-type': 'text/html; charset=utf-8' });
    }
  }

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', web.baseUrl);
    const path = url.pathname;
    const cors = corsHeaders(req);

    if (req.method === 'OPTIONS') {
      send(res, 204, '', cors);
      return;
    }

    // ---- signing in -------------------------------------------------------

    if (path === '/auth/login' && req.method === 'GET') {
      const state = newState();
      const target = new URL(AUTHORIZE_URL);
      target.searchParams.set('client_id', web.clientId);
      target.searchParams.set('redirect_uri', redirectUri);
      target.searchParams.set('response_type', 'code');
      target.searchParams.set('scope', SCOPE);
      target.searchParams.set('state', state);

      // Where to land afterwards rides in the state cookie rather than the URL,
      // so Discord never sees it and it cannot be swapped in flight.
      const back = safeReturnPath(url.searchParams.get('return'));
      redirect(res, target.toString(), {
        'set-cookie': serializeCookie(STATE_COOKIE, `${state}|${back}`, {
          maxAgeMs: STATE_TTL_MS,
          secure,
          sameSite,
        }),
      });
      return;
    }

    if (path === '/auth/callback' && req.method === 'GET') {
      const held = parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '';
      const bar = held.indexOf('|');
      const expected = bar < 0 ? held : held.slice(0, bar);
      const back = safeReturnPath(bar < 0 ? '/' : held.slice(bar + 1));
      const joiner = back.includes('?') ? '&' : '?';

      const given = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      // The state cookie proves this callback belongs to a sign-in this browser
      // started. Without it, anybody could hand somebody a callback link and
      // sign them into an account that is not theirs.
      if (!expected || !given || expected !== given || !code) {
        redirect(res, `${back}${joiner}error=expired`, {
          'set-cookie': clearCookie(STATE_COOKIE, secure, sameSite),
        });
        return;
      }

      let discordId: string;
      try {
        discordId = await identify(ctx, code, redirectUri);
      } catch (err) {
        log(`web: sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
        redirect(res, `${back}${joiner}error=discord`, {
          'set-cookie': clearCookie(STATE_COOKIE, secure, sameSite),
        });
        return;
      }

      const token = signSession(discordId, Date.now() + SESSION_TTL_MS, secret);
      res.writeHead(302, {
        ...baseHeaders(),
        location: back,
        'set-cookie': [
          serializeCookie(SESSION_COOKIE, token, { maxAgeMs: SESSION_TTL_MS, secure, sameSite }),
          clearCookie(STATE_COOKIE, secure, sameSite),
        ],
      });
      res.end();
      return;
    }

    // POST, so a link posted in Discord cannot sign somebody out.
    if (path === '/auth/logout' && req.method === 'POST') {
      sendJson(res, 200, { ok: true }, {
        ...cors,
        'set-cookie': clearCookie(SESSION_COOKIE, secure, sameSite),
      });
      return;
    }

    // ---- the API ----------------------------------------------------------

    if (path === '/api/status' && req.method === 'GET') {
      if (!statusCache || Date.now() - statusCache.at > STATUS_TTL_MS) {
        const online = await ctx.mod.players().then((p) => p.length).catch(() => null);
        statusCache = { at: Date.now(), online };
      }

      const body: StatusResponse = { ok: true, serverName: SERVER, online: statusCache.online };
      sendJson(res, 200, body, cors);
      return;
    }

    if ((path === '/api/me' || path === '/api/vault') && req.method === 'GET') {
      const who = whoIsAsking(req);
      if (!who) {
        sendJson(res, 401, apiError('signed_out', 'You are signed out.'), cors);
        return;
      }
      if (!who.steamId) {
        sendJson(res, 403, apiError('not_linked',
          'This Discord account has no Steam account linked yet. Run /link in Discord.'), cors);
        return;
      }

      if (path === '/api/me') {
        const points = ctx.db.pointsFor(who.steamId);
        const kills = ctx.db.killStats(who.steamId);

        const body: MeResponse = {
          ok: true,
          discordId: who.discordId,
          steamId: who.steamId,
          name: ctx.db.gameName(who.steamId),
          points: displayPoints(points.balance),
          minutes: Math.floor(points.minutes),
          kills: kills.kills,
          deaths: kills.deaths,
          skins: ctx.db.ownedSkins(who.steamId)
            .map((s) => ({ preset: s.preset, grantedAt: s.grantedAt })),
        };
        sendJson(res, 200, body, cors);
        return;
      }

      try {
        const read = await readVault(ctx, who.steamId, vaultCache);
        const body: VaultResponse = {
          ok: true,
          maxSlots: MAX_SLOTS,
          slots: read.slots,
          readAt: read.at,
        };
        sendJson(res, 200, body, cors);
      } catch (err) {
        log(`web: vault read failed for ${who.steamId}: ${err instanceof Error ? err.message : String(err)}`);
        sendJson(res, 503, apiError('server_unreachable',
          'The game server did not answer. Your animals are safe, this page just cannot '
          + 'read them right now. Try again in a minute.'), cors);
      }
      return;
    }

    if (path.startsWith('/api/') || path.startsWith('/auth/')) {
      sendJson(res, 404, apiError('not_found', 'There is nothing at that address.'), cors);
      return;
    }

    // ---- the front end ----------------------------------------------------

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, apiError('bad_request', 'That is not something this site does.'), cors);
      return;
    }

    await sendApp(res, path);
  };

  const server = createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      log(`web: ${req.method} ${req.url} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (!res.headersSent) {
        sendJson(res, 500, apiError('server_error', 'Something went wrong at our end.'));
      } else res.end();
    });
  });

  server.on('error', (err) => log(`web: server error: ${err.message}`));
  server.listen(web.port, () => {
    log(`website API on port ${web.port}, public at ${web.baseUrl}`);
    log(`  register this redirect URI with Discord: ${redirectUri}`);
    if (appDir) log(`  serving the front end from ${appDir}`);
    if (web.allowedOrigins.length > 0) {
      log(`  cross-origin front ends allowed: ${web.allowedOrigins.join(', ')}`);
    }
  });

  return {
    server,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
