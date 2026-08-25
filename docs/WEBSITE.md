# The Vestige website

A player-facing web front end for the data Vesta already holds: your stored
animals, your points, and a private map showing where **you** are.

**Status: the API is built, the front end is not.** Stage 1 landed on
2026-08-24: Discord sign-in plus read-only endpoints for the vault, points,
kills and skins. The front end is being written separately in React and talks to
those endpoints.

- **[API.md](API.md) is the contract**: every endpoint, field and error code.
- **[WEB-QUICKSTART.md](WEB-QUICKSTART.md)** is the walkthrough for building the
  front end against it, with the Discord and dev server setup that trips people
  up first.
- A design mockup of the eventual pages lives at
  <https://claude.ai/code/artifact/9c085629-606e-45b7-8beb-e49556e5094a>. It is
  a picture, not code.

---

## Documentation rule for whoever works on this

**Keep this file current as you go, in the same commit as the code.** This
project has already lost a day to knowledge that lived in one person's head —
see the `StaticFindObject` and `SpawnDefaultController` entries in
[NOTES.md](NOTES.md), both of which cost hours to rediscover because nobody
wrote them down the first time.

When you learn something that would have saved you an hour, write it here or in
`NOTES.md` before moving on. Negative results count double: "X does not work
and here is the evidence" is worth more than another attempt at X.

---

## What already exists, and what it buys you

Most of the hard parts are done. This is largely a new window onto data the bot
already has.

| Thing you need | Where it already is | Notes |
| --- | --- | --- |
| Player identity | `links` table, `db.linkFor(discordId)` | Discord↔Steam, already the bot's identity model |
| Stored animals | mod verbs `list` and `slotinfo` via `ModBridge` | species, growth, sex, prime, mutations |
| Points and playtime | `points` table, `db.pointsFor(steamId)` | |
| Kills | `kills` table, `db.killStats(steamId)` | |
| Skins owned | `owned_skins`, `db.ownedSkins(steamId)` | |
| Market listings | `listings` table | escrow model already built |
| Live positions | `ctx.mod.players()` | polled every 5s by the events tick |
| Map projection | `src/heatmap.ts` `DEFAULT_BOUNDS`, `src/heatimage.ts` `toFraction` | **calibrated and measured** against two landmarks |
| Base map image | `data/map.png`, `resolveMapImage()` | |

The map calibration in particular was expensive to get right and is correct.
Reuse it; do not re-derive it. Note the one thing that is easy to get wrong:
**latitude grows southward**, and HUD coordinates are world units ÷ 1000 in the
order Lat(y), Long(x).

---

## Architecture

The API runs **inside the bot process**. That is the only place with both the
SQLite handle and the SFTP credentials, and it avoids inventing a second
transport or a second writer on the database file.

```
React app ──HTTPS──> bot process ──┬── SQLite (the handle it already holds)
                                   └── ModBridge over SFTP ──> game server
```

The front end is a separate project. Serve its build from the bot by pointing
`WEB_APP_DIR` at it, which keeps everything same-origin and needs no CORS, or
host it elsewhere and name that origin in `WEB_ALLOWED_ORIGINS`. The first is
simpler and is what to reach for.

### Why not a separate host

The database is a local file and the mod bridge is SFTP into the game server.
Splitting the site off means either exposing the database over a network or
building an API on the bot anyway — more moving parts for no gain at this size.

### The one real performance constraint

**The mod bridge is slow: roughly 3–4 seconds per round trip.** The mod polls
its inbox every 3 seconds and results are polled at 1 second. That is fine for
a page load and useless for anything live.

So:

- **Vault, points, kills, skins** — read from SQLite, fast, no bridge.
- **Slot contents** — needs the bridge. Cache per player for a minute or two.
- **Live map** — do *not* call the bridge per request. The bot already polls
  positions every 5 seconds for the contest and hunt; have it write the latest
  position per player into a small table and read that instead.

---

## Authentication

**Discord OAuth2.** Players already link Discord to Steam, so Discord login
resolves to a Steam ID through the `links` table with no new identity system.

This is the entire risk surface. Everything else on the site is a read.

- Sessions in an HTTP-only, `Secure`, `SameSite=Lax` cookie.
- **Resolve the Steam ID server-side from the session on every request.** Never
  accept a Steam ID from the client — a query parameter naming whose vault to
  show is the bug that hands somebody else's animals over.
- Nobody unlinked gets past the door. There is nothing to show them.
- Staff pages, if any, check the same bot-admin list `mayAdminister` uses.

---

## Build order

### 1. Read-only vault and points, done

`src/web.ts` (routing, auth, static hosting), `src/webapi.ts` (the wire types
and their pure shaping) and `src/websession.ts` (cookies and signed sessions).
Covered by `test/web.test.mjs`.

Endpoints: `/api/status`, `/api/me`, `/api/vault`, plus `/auth/login`,
`/auth/callback` and `/auth/logout`. All documented in [API.md](API.md).

### 2. The private map

Add a position table written by the bot's existing 5 second poll, and an
endpoint returning **only the caller's own** position. Do not call the bridge
per request. The projection in `src/heatmap.ts` and `src/heatimage.ts` is
already calibrated; reuse it rather than re-deriving it.

### 3. Market, read-only

`GET /api/market` over the `listings` table. Buying stays in Discord until the
write path is trusted.

### 4. Writes, if wanted at all

Release, list for sale, buy. See the open question below before starting.

## Open questions, to settle before building

**Does the site show anybody else's position?** The mockup deliberately shows
only your own. Showing everybody's is not a feature addition — it changes the
game. Vesta has consistently refused to reveal positions (the heatmap is
aggregate and staff-only; the Active Region feature was built specifically to
gather people *without* telling anyone where anyone is). Breaking that on the
website breaks it everywhere.

**Do Release and Sell exist on the site?** They are the only controls that can
cost somebody an animal. Everything else is a read and a mistake is cosmetic.
Leaving them in Discord is a defensible permanent answer.

**What happens when the game server is down?** The bridge times out after 15
seconds. The site must say so plainly rather than hanging or showing an empty
vault, which reads as "my dinosaurs are gone".

---

## Design

The mockup is a specimen ledger, not a card grid: hairline rules, square
corners, stored animals as full-width records with tabular figures, and the map
as a quiet plate rather than a hero image. Bricolage Grotesque for headings,
Archivo for text, JetBrains Mono for anything numeric or labelled.

Every colour is sampled from the logo, so the palette and the mark cannot drift
apart: bone `#EBE2CF`, ochre `#D6A03A` dark / `#9C6E12` light, against the
near-black `#0C0B09` the logo was drawn on. Both themes are defined at token
level. Keep that. Do not add a colour that only exists inside a `@media` or
`[data-theme]` block.

### The logo

**The clean master is `C:\Users\Arne\Pictures\vestige-logo-clean.png`**
(1254 px square, transparent background). The copies named
`vestige-discord-icon*.png` in the same folder are bad re-encodes: the alpha is
flattened, which turns the faint ochre glow into a solid disc and leaves JPEG
speckle around the bone. Do not use them.

Two things that cost time here, both measured:

- The soft ochre arcs are **low opacity**, not solid. Any pipeline that drops
  the alpha channel renders them as a filled disc. That is the tell that alpha
  was lost, and it is easy to mistake for a bad source file.
- In WPF, `DrawImage` on a decoded WebP frame whose `Format` reports `Default`
  discards alpha. Convert to `Bgra32` with `FormatConvertedBitmap` first, then
  draw the converted bitmap.

### House style for copy

**No em dashes anywhere on the site.** Use a comma, a full stop, or a colon.
This applies to generated strings as much as to static text.

## Things that will bite you

Carried over from building the bot. All of these are measured, not guessed.

- **`StaticFindObject` cannot test whether a game asset exists.** It returns
  non-nil for total nonsense. Irrelevant to the website directly, but it is the
  reason to distrust any "does X exist" check that has not been controlled.
- **The mod bridge serialises writes.** Two requests appending to the inbox at
  once will clobber each other without the existing lock. Use `ModBridge`, do
  not reimplement it.
- **Storage slot names are per player and can collide.** A slot called `rex`
  exists for many people; the key is always `(steamId, slot)`.
- **Never trust a Steam ID from the client.** Stated twice on purpose.
