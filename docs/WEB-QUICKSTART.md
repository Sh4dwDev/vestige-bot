# Building the front end: a walkthrough

From an empty folder to a signed-in page showing somebody's vault.

[API.md](API.md) is the reference: every endpoint, every field, every error
code. This is the practical version, in order, with the code.

The examples are React with Vite and TypeScript because that is what the front
end is being written in. Nothing in the API depends on that choice.

---

## Before you start

You need the bot running with the website API switched on, and a Discord
application you can add redirect URIs to.

**In the Discord developer portal**, open your application, then OAuth2, and add
**two** redirects:

```
http://localhost:5173/auth/callback     <- for development
https://your-domain/auth/callback       <- for the real site
```

Both have to be there. Discord matches them exactly, and a missing one gives you
`invalid_redirect_uri` at the moment somebody tries to sign in.

**In the bot's `.env`, for development:**

```sh
WEB_BASE_URL=http://localhost:5173
DISCORD_CLIENT_ID=your-application-id
DISCORD_CLIENT_SECRET=your-client-secret
WEB_PORT=8787
```

`WEB_BASE_URL` is the address **the browser** uses, not the bot's own port. In
development that is the Vite dev server, and the next step makes Vite forward
the API calls to the bot. Getting this the wrong way round is the single most
common way to end up signed in on a page you are not looking at.

Start the bot. It prints what it will ask Discord for, so you can compare:

```
website API on port 8787, public at http://localhost:5173
  register this redirect URI with Discord: http://localhost:5173/auth/callback
```

---

## 1. Scaffold the app

```bash
npm create vite@latest vestige-web -- --template react-ts
cd vestige-web
npm install
```

## 2. Point Vite at the bot

Everything under `/api` and `/auth` goes to the bot. Everything else is your app.
The browser only ever sees one origin, which means no CORS, and session cookies
stay on the safer `SameSite=Lax` setting.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth': 'http://localhost:8787',
    },
  },
});
```

Check it before writing any UI:

```bash
npm run dev
# then open http://localhost:5173/api/status
```

You should see `{"ok":true,"serverName":"Vestige","online":...}`. If you do not,
stop here and fix it. Nothing later works until this does.

## 3. The API client

One file, used by everything. Copy the types from `src/webapi.ts` in the bot
repo rather than importing across the two projects: this is a wire format, and
keeping a copy is what makes a mismatch show up in a diff.

```ts
// src/api.ts

export interface ApiErrorBody {
  ok: false;
  code: 'signed_out' | 'not_linked' | 'server_unreachable'
      | 'not_found' | 'bad_request' | 'rate_limited' | 'server_error';
  reason: string;
}

export interface MeResponse {
  ok: true;
  discordId: string;
  steamId: string;
  name: string | null;
  points: number;
  minutes: number;
  kills: number;
  deaths: number;
  skins: Array<{ preset: string; grantedAt: string }>;
}

export interface VaultSlot {
  slot: string;
  species: string;
  growth: number;
  female: boolean;
  prime: boolean;
  elderStacks: number;
  mutations: string[];
}

export interface VaultResponse {
  ok: true;
  maxSlots: number;
  slots: VaultSlot[];
  readAt: number;
}

export interface StatusResponse {
  ok: true;
  serverName: string;
  online: number | null;
}

/** Carries the API's own code, so callers can switch on it. */
export class ApiError extends Error {
  constructor(readonly code: ApiErrorBody['code'], reason: string) {
    super(reason);
    this.name = 'ApiError';
  }
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      // Same-origin in development thanks to the proxy, and needed anyway if
      // the app is ever hosted somewhere else.
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
  } catch {
    // The network, not the API. Worth telling apart: one is the player's wifi,
    // the other is the game server.
    throw new ApiError('server_error', 'Could not reach the site. Check your connection.');
  }

  const body = (await res.json()) as T | ApiErrorBody;
  if (typeof body === 'object' && body !== null && 'ok' in body && body.ok === false) {
    throw new ApiError(body.code, body.reason);
  }
  return body as T;
}

export const getStatus = () => get<StatusResponse>('/api/status');
export const getMe = () => get<MeResponse>('/api/me');
export const getVault = () => get<VaultResponse>('/api/vault');

/**
 * Sign-in is a browser redirect, not a fetch. Sending the browser away is the
 * whole point: Discord has to show the player its own approval screen.
 */
export function signIn(back: string = window.location.pathname): void {
  window.location.href = `/auth/login?return=${encodeURIComponent(back)}`;
}

export async function signOut(): Promise<void> {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/';
}
```

## 4. Know who is signed in

Three states, not two. Signed out, signed in but never linked to Steam, and
ready. The middle one is not an error, it is somebody who needs to run `/link`
in Discord, and the whole site is empty until they do.

```tsx
// src/useMe.ts
import { useEffect, useState } from 'react';
import { ApiError, getMe, type MeResponse } from './api';

export type Session =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'notLinked' }
  | { status: 'ready'; me: MeResponse }
  | { status: 'error'; reason: string };

export function useMe(): Session {
  const [session, setSession] = useState<Session>({ status: 'loading' });

  useEffect(() => {
    let live = true;

    getMe()
      .then((me) => { if (live) setSession({ status: 'ready', me }); })
      .catch((err: unknown) => {
        if (!live) return;
        const code = err instanceof ApiError ? err.code : 'server_error';
        const reason = err instanceof Error ? err.message : 'Something went wrong.';

        if (code === 'signed_out') setSession({ status: 'signedOut' });
        else if (code === 'not_linked') setSession({ status: 'notLinked' });
        else setSession({ status: 'error', reason });
      });

    // Stops a state update after the component has gone, which React warns
    // about and which hides real bugs in the noise.
    return () => { live = false; };
  }, []);

  return session;
}
```

## 5. The shell

Read `?error=` on the way in. A sign-in that failed sends the browser back to
where it started with that set, and silently swallowing it looks like a button
that does nothing.

```tsx
// src/App.tsx
import { signIn, signOut } from './api';
import { useMe } from './useMe';
import { Vault } from './Vault';

const SIGN_IN_ERRORS: Record<string, string> = {
  expired: 'That sign-in attempt timed out. Try again.',
  discord: 'Discord did not answer. Try again in a minute.',
};

export function App() {
  const session = useMe();
  const problem = SIGN_IN_ERRORS[new URLSearchParams(window.location.search).get('error') ?? ''];

  if (session.status === 'loading') return <p>Loading.</p>;

  if (session.status === 'signedOut') {
    return (
      <main>
        {problem && <p role="alert">{problem}</p>}
        <h1>Vestige</h1>
        <button onClick={() => signIn()}>Sign in with Discord</button>
      </main>
    );
  }

  if (session.status === 'notLinked') {
    return (
      <main>
        <h1>Link Steam first</h1>
        <p>Run <code>/link</code> in Discord, then come back.</p>
        <button onClick={signOut}>Sign out</button>
      </main>
    );
  }

  if (session.status === 'error') return <p role="alert">{session.reason}</p>;

  const { me } = session;
  return (
    <main>
      <h1>{me.name ?? 'Your account'}</h1>
      <p>{me.points.toLocaleString()} points, {Math.floor(me.minutes / 60)} hours played</p>
      <p>{me.kills} kills, {me.deaths} deaths</p>
      <Vault />
      <button onClick={signOut}>Sign out</button>
    </main>
  );
}
```

## 6. The vault

The one page that talks to the game server, so it is the one page that has to be
patient and honest.

```tsx
// src/Vault.tsx
import { useEffect, useState } from 'react';
import { ApiError, getVault, type VaultResponse } from './api';

type State =
  | { status: 'loading' }
  | { status: 'ready'; vault: VaultResponse }
  | { status: 'error'; reason: string };

export function Vault() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    getVault()
      .then((vault) => { if (live) setState({ status: 'ready', vault }); })
      .catch((err: unknown) => {
        if (!live) return;
        setState({
          status: 'error',
          reason: err instanceof ApiError ? err.message : 'Could not read your vault.',
        });
      });
    return () => { live = false; };
  }, []);

  if (state.status === 'loading') {
    return <p>Asking the game server what is in your slots. This takes a few seconds.</p>;
  }

  // Never fall through to an empty list here. "No animals" and "the server did
  // not answer" look identical in a careless UI, and one of them reads as
  // "my dinosaurs are gone".
  if (state.status === 'error') return <p role="alert">{state.reason}</p>;

  const { slots, maxSlots, readAt } = state.vault;

  return (
    <section>
      <h2>Stored animals</h2>
      <p>
        {slots.length} of {maxSlots} slots used, as of{' '}
        <time dateTime={new Date(readAt).toISOString()}>
          {new Date(readAt).toLocaleTimeString()}
        </time>
      </p>

      {slots.length === 0 && <p>Nothing stored yet.</p>}

      {slots.map((s) => (
        <article key={s.slot}>
          <h3>{s.species}</h3>
          <dl>
            <dt>Slot</dt><dd>{s.slot}</dd>
            <dt>Growth</dt><dd>{Math.round(s.growth * 100)}%</dd>
            <dt>Sex</dt><dd>{s.female ? 'Female' : 'Male'}</dd>
            <dt>Prime</dt><dd>{s.prime ? 'Eligible' : 'No'}</dd>
            <dt>Mutations</dt>
            <dd>{s.mutations.length > 0 ? s.mutations.join(', ') : 'None'}</dd>
          </dl>
        </article>
      ))}
    </section>
  );
}
```

Two things not to do, both of which will look fine until they are not:

- **Do not poll `/api/vault`.** Answers are cached for 90 seconds and each miss
  costs several seconds of game server time. Refetch when the player asks, not
  on a timer.
- **Do not treat a slow reply as a failure.** A cold read of three slots can take
  ten seconds. Let it finish.

---

## Shipping it

Build the app and point the bot at the output. The bot serves it, falls back to
`index.html` for client-side routes, and everything stays same-origin.

```bash
npm run build          # writes dist/
```

In the bot's `.env` on the server:

```sh
WEB_BASE_URL=https://your-domain
WEB_APP_DIR=/srv/vestige-web/dist
WEB_PORT=8787
```

Restart the bot. Put a reverse proxy in front for TLS, since the bot speaks
plain HTTP:

```
# Caddy
your-domain {
  reverse_proxy localhost:8787
}
```

Then check the two things that actually break in production:

1. `https://your-domain/api/status` answers.
2. Sign-in completes and lands you back on the page you started from.

### Hosting the front end somewhere else

Only if you want to. It costs you HTTPS in development and gains you nothing at
this size. Set `WEB_ALLOWED_ORIGINS` to the exact origins, keep
`credentials: 'include'` on every call, and read the CORS section of
[API.md](API.md) first.

---

## When it does not work

| What you see | What it is |
| --- | --- |
| `invalid_redirect_uri` from Discord | The redirect is not registered, or does not match to the character. Compare it against the line the bot prints at startup. |
| Sign-in completes, then everything is `signed_out` again | `WEB_BASE_URL` points at the bot's port instead of the address in the browser's URL bar. In development it should be the Vite origin. |
| Sign-in lands on a plain "API is running" page | Same cause. The browser was sent to the bot's own origin, which has no app on it. |
| `/api/status` 404s from the app but works directly | The Vite proxy is missing `/auth`, or the dev server was not restarted after editing `vite.config.ts`. |
| Everything works locally, nothing works deployed | The reverse proxy is not passing cookies or the `Host` header through. |
| `not_linked` for an account you know is linked | The link is per Discord account. Signing in with a second Discord account gives a second, unlinked identity. |
| The vault is empty but Discord shows animals | Look for a `503`. An empty list and an unreachable server are different answers and must not render the same. |
| Storing something in game does not show up | The 90 second cache. `readAt` says how old the answer is. |

---

## Checklist

- [ ] `/api/status` answers through the Vite proxy
- [ ] Sign-in returns to the page it started from
- [ ] Signing in with an unlinked Discord account shows the `/link` message, not an error
- [ ] The vault shows a loading state rather than an empty list while reading
- [ ] Stopping the game server makes the vault say so, and does not show zero animals
- [ ] Sign-out clears the session and a refresh does not restore it
