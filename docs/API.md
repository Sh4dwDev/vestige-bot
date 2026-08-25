# The Vestige web API

The bot exposes a small JSON API and a Discord sign-in. Build the front end in
whatever you like; it talks to these endpoints and nothing else.

New to this? [WEB-QUICKSTART.md](WEB-QUICKSTART.md) walks through it in order,
from an empty folder to a signed-in page. This document is the reference to come
back to.

**This document is the contract.** If you change an endpoint or a field in
`src/web.ts` or `src/webapi.ts`, change it here in the same commit. A front end
is deployed separately and will be running against an older idea of this file
for as long as somebody leaves a tab open.

Stage 1 is **read only**. There is no endpoint that changes anything in game,
and there should not be one until the Release and Sell question in
[WEBSITE.md](WEBSITE.md) has an answer.

---

## Setting it up

### 1. Discord

In the [Discord developer portal](https://discord.com/developers/applications),
open your application, then **OAuth2**:

- Copy the **Client ID** and **Client Secret**.
- Under **Redirects**, add exactly `https://your-domain/auth/callback`.

The redirect has to match what the bot sends, character for character. The bot
prints the one it will use at startup:

```
website API on port 8787, public at https://your-domain
  register this redirect URI with Discord: https://your-domain/auth/callback
```

### 2. Environment

```sh
WEB_BASE_URL=https://your-domain     # public origin, no trailing slash
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
WEB_PORT=8787                        # optional, this is the default
WEB_APP_DIR=/srv/vestige-web/dist    # optional, your built front end
WEB_ALLOWED_ORIGINS=                 # optional, only for a front end elsewhere
```

Leave `WEB_BASE_URL` and `DISCORD_CLIENT_SECRET` blank and the API never starts.
The bot behaves exactly as it did before, with no listening socket.

There is no session secret to set. One is generated on first run and kept in the
database, so restarts do not sign everybody out.

### 3. Choose how the front end is served

**Same origin, recommended.** Build your React app and point `WEB_APP_DIR` at
the output directory. The bot serves it, falls back to `index.html` for client
side routes, and cookies stay `SameSite=Lax`. Leave `WEB_ALLOWED_ORIGINS` empty:
no CORS is involved at all.

**Separate origin.** Set `WEB_ALLOWED_ORIGINS` to the exact origins allowed to
call the API with a session, comma separated and scheme plus host only:

```sh
WEB_ALLOWED_ORIGINS=http://localhost:5173,https://vestige.pages.dev
```

Two consequences, both unavoidable:

- Session cookies switch to `SameSite=None`, which browsers only accept
  alongside `Secure`. **The API must then be on HTTPS**, including in
  development. A Vite dev server on plain `http://localhost:5173` talking to an
  API on plain `http://localhost:8787` will appear to sign in and then be signed
  out on the next request, because the browser silently drops the cookie.
- Every request needs `credentials: 'include'`.

The simplest development setup avoids all of this: proxy `/api` and `/auth` from
Vite to the bot, so the browser only ever sees one origin.

```js
// vite.config.js
export default {
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
};
```

With that proxy, `WEB_BASE_URL` in development is the **Vite** origin
(`http://localhost:5173`), not the bot's port, and Discord needs
`http://localhost:5173/auth/callback` registered alongside the production one.
[WEB-QUICKSTART.md](WEB-QUICKSTART.md) sets this up step by step.

---

## Signing in

Auth is a browser redirect, not something to call with `fetch`.

1. Send the browser to `/auth/login?return=/wherever`. A plain link or
   `window.location.href` is right; `fetch` is not.
2. The player approves on Discord.
3. Discord returns to `/auth/callback`, the bot sets an `HttpOnly` session
   cookie, and the browser lands back on `return`.
4. Every later request carries the cookie automatically.

`return` must be a path on this site. Anything else, including a full URL, is
replaced with `/`, so the login cannot be used to bounce somebody off site.

If sign-in fails, the browser still lands on `return`, with `?error=expired`
(the attempt timed out or was not started here) or `?error=discord` (Discord did
not answer). Read it from the query string and show something; do not retry
automatically, because both cases repeat.

Sign out with `POST /auth/logout`. It is POST on purpose: a link in a Discord
message must not be able to sign people out.

**The session names a Discord account and nothing else.** The Steam ID is looked
up from the `links` table on every request. There is no parameter anywhere in
this API that says whose data to return, which is deliberate: that parameter is
the bug that hands somebody else's animals over.

---

## Endpoints

All responses are JSON. Every failure has the same shape:

```ts
interface ApiError {
  ok: false;
  code: 'signed_out' | 'not_linked' | 'server_unreachable'
      | 'not_found' | 'bad_request' | 'rate_limited' | 'server_error';
  reason: string;   // written for a player, safe to show as it is
}
```

Switch on `code`. Treat `reason` as copy that may be reworded at any time.

### `GET /api/status`

Public, no session needed.

```ts
interface StatusResponse {
  ok: true;
  serverName: string;
  online: number | null;   // null when the bot cannot reach the game server
}
```

`online` being null is normal during a restart. Say "server is restarting"
rather than "0 players", which reads as an empty server.

### `GET /api/me`

Needs a session.

```ts
interface MeResponse {
  ok: true;
  discordId: string;
  steamId: string;
  name: string | null;     // most recent name in game, null if never seen
  points: number;          // whole, already rounded down
  minutes: number;         // total minutes played
  kills: number;
  deaths: number;
  skins: Array<{ preset: string; grantedAt: string }>;  // grantedAt is ISO 8601 UTC
}
```

- `401 signed_out` when there is no valid session.
- `403 not_linked` when the Discord account has no Steam account linked. Send
  them to run `/link` in Discord; there is nothing to show until they do.

### `GET /api/vault`

Needs a session. This is the only endpoint that talks to the game server.

```ts
interface VaultResponse {
  ok: true;
  maxSlots: number;        // 3 today, enforced by the mod, not by this API
  slots: VaultSlot[];
  readAt: number;          // epoch ms of the underlying read
}

interface VaultSlot {
  slot: string;            // the player's own name for it, unique per player
  species: string;
  growth: number;          // 0 to 1
  female: boolean;
  prime: boolean;
  elderStacks: number;
  mutations: string[];
}
```

- `401 signed_out`, `403 not_linked` as above.
- `503 server_unreachable` when the game server does not answer.

Two things worth building around:

**It is slow the first time.** Each slot is a round trip to the game server of
three to four seconds, so a full vault can take ten. Show a loading state, and
do not block the rest of the page on it.

**Answers are cached for 90 seconds**, which is what `readAt` is for. Show it as
"as of a minute ago" rather than implying it is live. Somebody who stores a
dinosaur and refreshes immediately will not see it until the cache expires, and
saying so up front is better than them thinking it was lost.

**Never show an empty vault when the read failed.** `503` and "no animals" look
identical in a careless UI, and one of them reads as "my dinosaurs are gone".

---

## A working example

```tsx
// api.ts
const base = import.meta.env.VITE_API_BASE ?? '';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(base + path, {
    // Needed only for a front end on its own origin, harmless otherwise.
    credentials: 'include',
    headers: { accept: 'application/json' },
  });

  const body = await res.json();
  if (!body.ok) throw Object.assign(new Error(body.reason), { code: body.code });
  return body as T;
}

export const getMe = () => get<MeResponse>('/api/me');
export const getVault = () => get<VaultResponse>('/api/vault');
export const signIn = (back = window.location.pathname) => {
  window.location.href = `${base}/auth/login?return=${encodeURIComponent(back)}`;
};
```

```tsx
// Vault.tsx
function Vault() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    getVault()
      .then((v) => setState({ status: 'ready', vault: v }))
      .catch((err) => setState({ status: 'error', code: err.code, reason: err.message }));
  }, []);

  if (state.status === 'loading') return <p>Reading your slots, this takes a few seconds.</p>;

  if (state.status === 'error') {
    if (state.code === 'signed_out') return <button onClick={() => signIn()}>Sign in</button>;
    if (state.code === 'not_linked') return <p>Run /link in Discord first.</p>;
    // Anything else, including server_unreachable. Say what happened; never
    // fall through to an empty list.
    return <p>{state.reason}</p>;
  }

  const { slots, maxSlots, readAt } = state.vault;
  return (
    <>
      <p>{slots.length} of {maxSlots} slots used, as of {new Date(readAt).toLocaleTimeString()}</p>
      {slots.map((s) => <SlotCard key={s.slot} slot={s} />)}
    </>
  );
}
```

The types above are exported from `src/webapi.ts`. Copy them into the front end
rather than importing across the two projects: they are a wire format, and the
copy is what makes a mismatch visible in a diff.

---

## Things that will bite you

All measured, not guessed.

- **`SameSite=None` without HTTPS is silently dropped.** Cross-origin
  development over plain http looks like a sign-in that does not stick. Use the
  Vite proxy instead.
- **The mod bridge is slow and serialised.** Roughly three to four seconds per
  round trip, and concurrent calls queue behind each other. Never call
  `/api/vault` on a timer.
- **Storage slot names collide between players.** The key is always
  `(steamId, slot)`, never the slot name alone.
- **Growth can come back slightly over 1** from the mod on a fully grown adult.
  The API clamps it, so `growth * 100` is safe to render.
- **`points` is stored as a float** and rounded down once, here. Do not round it
  again differently in the front end or the site and the bot will disagree by a
  point.
- **Never trust a Steam ID from the client.** There is no endpoint that accepts
  one, and adding one would undo the whole design.

---

## Adding an endpoint

1. Add the response type to `src/webapi.ts`, with any shaping as a pure function
   next to it.
2. Add the route to `src/web.ts`. Resolve the player with `whoIsAsking`, never
   from the request.
3. Cover the shaping in `test/web.test.mjs`.
4. Write it down here, in the same commit.

Adding a field to an existing response is safe. Renaming or removing one is not,
because an already deployed front end is still asking for it.
