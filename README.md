# evrima-storage

Dinosaur storage for a **The Isle: Evrima** community server: a UE4SS Lua mod
that runs inside the game server, and a Discord bot that drives it.

Players store a fully grown dinosaur from Discord and get it back later with its
growth, vitals, mutations and prime status intact.

---

## Read this first if you are picking the project up

Four things explain most of the design. None of them are obvious, and all of
them were learned by hitting them.

1. **There is no mod API for Evrima.** Everything here is UE4SS hooking live
   engine objects, plus the server's own RCON. Anything you read about "the
   storage mod" other servers use is this, or a variant of it.

2. **The save files are encrypted, and this project does not touch them.**
   State is captured from the **live pawn** in memory and written back to a live
   pawn. Do not add save-file parsing or key extraction — it is deliberately out
   of scope, and the whole architecture exists to avoid needing it.

3. **`RequestRespawn` crashes from Lua**, so a dinosaur cannot be spawned
   cleanly. Restore is *transform-in-place*: the player dies, respawns as a
   juvenile of the same species, and the mod mutates that pawn back into what
   they had. This is why storing kills you, and why restore is same-species only.

4. **The mod cannot open a socket, and cannot write to game chat.** It talks to
   the bot through two append-only NDJSON files over SFTP, and anything a player
   must *see* is sent by the bot over RCON.

[`docs/NOTES.md`](docs/NOTES.md) records engine behaviour that fails
**silently** — wrong method names, mandatory write ordering, calls that crash a
second later. Read it before touching `main.lua`. It is the most expensive
document in the repo.

---

## How the pieces fit

```
Discord  ──slash commands──▶  bot (Node, one process)
                                │
                                ├── RCON ──────────▶ game server
                                │   who is online, direct messages
                                │
                                └── SFTP ─────────▶ game server files
                                    inbox.ndjson   → mod reads commands
                                    results.ndjson ← mod writes answers
                                    Game.ini       ↔ admin list
                                          │
                                    UE4SS Lua mod (inside the game process)
                                          │
                                    live dinosaur pawns
```

### The bridge

Lua has no sockets here, so commands are files.

- The bot appends a line to `inbox.ndjson`; the mod polls it every 3 s.
- The mod appends its answer to `results.ndjson`; the bot polls for the matching
  id.
- **Every write is temp-file-then-rename.** SFTP creates a file before filling
  it, and a poller that reads the empty version swallows the command silently.
- Commands carry an id and are deduped on both sides, because chat hooks and
  polls both fire more than once.

### RCON

Evrima's RCON is **not Source RCON**. It is a bespoke binary protocol: `0x01` to
authenticate, then `0x02 <opcode>`, and arguments inside a command are **comma
separated**. Used here: `announce 0x10`, `directmessage 0x11`,
`playerlist 0x40`. See [`src/rcon.ts`](src/rcon.ts).

---

## Voice

The server is **Vestige**. The bot is **Vesta**, *Keeper of Vestige*. Storage is
**the Vestige archive** — things are *secured*, *kept* and *released*, not
"saved" and "loaded".

Every name and phrase players see lives in [`src/brand.ts`](src/brand.ts), so a
rename is one edit and the tone cannot drift file by file. Import from there
rather than typing "Vestige" into an embed.

Two rules worth keeping:

- **Warnings stay blunt.** The store button still says *Store & kill*, because
  flavour must never obscure the fact that a dinosaur dies. Atmosphere belongs
  on confirmations and idle panels, not on the thing that destroys something.
- **Errors say what happened.** `Vestige is not responding` is in voice and
  still diagnostic; the mod's raw message is passed through on failure rather
  than replaced with something evocative.

## Layout

| Path | What it is |
| --- | --- |
| `mod/DinoStorage/Scripts/main.lua` | The entire mod. Runs inside the game server under UE4SS |
| `src/index.ts` | Entry point: boots the bridge, RCON and Discord, runs the two background watchers |
| `src/bridge.ts` | NDJSON-over-SFTP transport to the mod, with per-verb timeouts |
| `src/rcon.ts` | Evrima RCON client |
| `src/commands.ts` | Slash commands and their replies |
| `src/panel.ts` | The `/storage` embed-and-buttons panel |
| `src/population.ts` | `/population` tallying and embed |
| `src/admins.ts` | Reading and rewriting `AdminsSteamIDs` in Game.ini |
| `src/brand.ts` | Every name and phrase players see |
| `src/db.ts` | SQLite (`node:sqlite`). Links, pending links, admin lists, settings |
| `scripts/deploy-mod.mjs` | Uploads the mod and confirms it hot-reloaded |
| `test/*.test.mjs` | Plain Node scripts, no framework. Run against `dist/` |
| `docs/NOTES.md` | Engine behaviour, mostly things that fail silently |
| `docs/DEPLOY.md` | Putting the bot on a host that keeps it running |

The database is **not** the source of truth for stored dinosaurs — those live in
the mod's own files on the game server. SQLite holds only Discord↔Steam links
and administration.

---

## Commands

| Command | Who | Notes |
| --- | --- | --- |
| `/link <steamid>` | anyone | Issues a code; the player types `!link CODE` **in game** to prove they own the account. The original ephemeral reply is edited into a confirmation |
| `/unlink` | anyone | Stored dinosaurs survive and return if they link again |
| `/storage` | linked | Embed with buttons: store, restore, rename, delete. Auto-refreshes every 20 s for 13 min |
| `/slay` | linked | Own dinosaur only — the Steam ID comes from the link table, never from user input |
| `/population` | anyone | Species, adults, gender split, prime. Names nobody |
| `/points balance\|top` | linked / anyone | Points earned by playing, and the leaderboard |
| `/kills top\|me` | anyone / linked | Kill leaderboard, and your own record |
| `/admin killfeed channel\|off` | staff | Post each kill to a channel |
| `/admin points give\|take\|set\|rate` | staff | Adjust balances and the earning rate |
| `/admin game add\|remove\|list` | staff | In-game admins, via Game.ini |
| `/admin bot add\|remove\|list` | staff | Who may use `/admin` |
| `/admin give dino` | staff | Put a dinosaur into someone's archive |
| `/admin species cap\|clear\|list\|channel` | staff | Per-species population caps and lock notices |
| `/admin panel channel` | staff | The main player panel — buttons, no commands to learn |
| `/admin slay cooldown` | staff | Minutes between slays (0 disables) |
| `/admin population channel\|off` | staff | The self-updating population panel |
| `/admin guide channel` | staff | Post the storage guide in a channel |
| `/admin commands channel` | staff | Post the command reference in a channel |
| `/admin status channel\|off` | staff | The live server status panel |
| `/admin restarts on\|off\|every\|announce\|status` | staff | Scheduled restarts and their warnings |

Staff means **Manage Server**, or an entry on the bot admin list. Manage Server
is the bootstrap, so the owner can never lock themselves out.

In game: **`!link CODE`** and **`!discord`**.

### Storage rules

Set at the top of `main.lua`: **3 slots**, **100 % growth required**
(`MIN_GROWTH = 0.999`). Storing shrinks the dinosaur to 5 % before killing it,
so nobody gets a free carcass to eat.

### Why linking works "backwards"

The code is shown in **Discord** and typed in **game**, not the other way round.
RCON `directmessage` renders as a notification that vanishes in about a second —
unusable for something that has to be read and retyped. Typing it in game is
also what actually proves account ownership.

`!discord` has the opposite shape: the mod detects it but **cannot reply in
chat**, so the bot sends the invite over RCON. That message is transient by
nature, which is why the invite should be short.

### The player panel

`/admin panel channel #x` posts a hub with category buttons — Archive, In-game
actions, Stats, Verify — each opening a private reply. Nobody has to know a
command name to use the bot.

**Its buttons carry no state**, so the message keeps working indefinitely,
including across restarts and redeploys. A pinned panel that quietly stops
responding after a restart is worse than no panel, and stateful custom IDs are
the usual way that happens.

Verify opens a modal for the Steam64 ID and then runs the same code path as
`/link` — one flow, so the two cannot drift apart. Same for the panel's Slay
button and `/slay`.

### Channel panels

Three embeds can be parked in channels, each placed by a command. All of them
remember their message id, so re-running the command edits what is already there
instead of leaving a trail of stale copies — see [`src/pinned.ts`](src/pinned.ts).

The **storage guide** and **command reference** are static, so nothing polls
them; re-run the command to refresh or move one. The **population panel** is
live, and is described below.

`test/guides.test.mjs` guards the thing that actually goes wrong with help
text: it fails if the bot registers a command the reference does not document,
or documents one that no longer exists. A help panel people have stopped being
able to trust is worse than none.

### The live population panel

`/admin population channel #x` pins a population embed to a channel and edits it
in place every minute. Posting a new message each time would bury the channel,
so the message id is kept in the database and reused across restarts. If someone
deletes it, the next update posts a fresh one.

It **always renders**: an empty server and an unreachable server each get their
own embed, because a panel that vanishes reads as broken.

The species table is a fixed-width code block rather than Discord's inline
fields, which reflow unpredictably between desktop and phone. Names are
truncated to keep the columns aligned. The "updated" timestamp sits in the
description because Discord only renders `<t:…>` there, never in a footer.

The bot's own status shows connected players against the slot count —
*Watching 3/100 players*, or *Watching the server restart* when RCON does not
answer. It comes from the once-a-minute poll in `startServerPoll`, which also
drives the admin reconciler: one RCON call serves both, and a minute sits
comfortably inside Discord's presence rate limit. Changes are logged, so the log
shows when the server dropped out.

The slot count is `MaxPlayerCount` under `[/script/theisle.tigamesession]` —
**not** `MaxPlayers`, and **not** under `Engine.GameSession`, which is what most
guides say. It is picked up whenever the reconciler reads Game.ini, so it costs
no extra request, and the status falls back to a bare count if the file has not
been read yet.

Note the status counts **connected players** while the panel counts **dinosaurs
playing**. They differ legitimately — somebody sitting on the spawn screen is
connected but is not a dinosaur — so the two figures are deliberately not
conflated.

---

## Gifting

`/admin give dino @player Tyrannosaurus` writes a dinosaur straight into their
archive, with optional growth and up to four mutations.

It works because **restore compares only the species string** — the stored
`classPath` is never read back. So the snapshot can be synthesised rather than
captured, and the recipient does not need to be online. They collect it by
spawning that species and pressing Release.

Vitals are written empty on purpose: `SetGrowth` recomputes and refills every
max vital during restore, so a gifted dinosaur arrives healthy instead of
carrying a stranger's hunger.

Gender is recorded for display only — Evrima has no `SetIsFemale`.

---

## Species caps

`/admin species cap Tyrannosaurus 10` caps how many of a species may be online.
When the count reaches the cap the species is announced as **locked**, in
Discord and in game; when it drops back it is announced as **open**.

**It announces, it does not enforce.** Nothing in Evrima lets a server refuse a
spawn from Lua, so a locked species is a rule staff and players act on. The
command says this when you set a cap, rather than implying a wall that is not
there.

Announcements fire **only on the change**, and the state is stored — so a bot
restart does not re-announce a lock that was already reported, and a species
sitting on its cap does not flap.

The population panel marks locked species with 🔒, shows `online / cap` on
capped cards, and lists what is locked at the top.

Species names must match what the game reports; `/population` shows the
spellings in use.

---

## Kills

**Evrima fires no death event a server can hook.** `OnDeath`, `OnPawnDeath`,
`SetHealth` and `SetIsAlive` all either never fire or fire unreliably on a
natural death, so detection and attribution have to be split:

| Piece | Mechanism |
| --- | --- |
| Who hit whom | Hook `/Script/TheIsle.TICharacterBase:ApplyDamage`, cache attacker per victim |
| That someone died | Poll pawn health every 1.5 s for a `>0 → 0` edge |
| Joining them | Credit the cached attacker if the death lands within 20 s |

`ApplyDamage` fires on **direct player attacks only**. Bleeding out, starving,
drowning, falls and AI produce a real death with **no attacker**, so kills and
deaths will never reconcile.

That gap is surfaced rather than hidden: unattributed deaths appear in the feed
as deaths, and the leaderboard footer says how many of the total had an
attacker. Someone will add the columns up, and it should agree with them.

Catching every damage type needs the C++ path — `PostGameplayEffectExecute` on
`UAttributeSet` at the vtable level. Not attempted here.

---

## Skins

`/admin skin set @player Body "Rust"` recolours one of the ten colour fields on
`FCustomizerDataBase`. `/admin skin palette` lists the presets; any hex works.

Three things from upstream that this depends on:

- **`SetCustomizerData()` is silently broken** since 0.21.720. The colour is
  written to the live replicated property and followed by `ForceNetUpdate()`.
- **`PatternIndex` is never touched.** It is validated per species, and an
  out-of-range value makes the client abort the entire skin rebuild — dropping
  every colour in the same apply. Only colours are writable here.
- **`SkinCode` is never written**; it is the engine's own persistence field.

Hex is sRGB and the engine wants linear, so the conversion is applied on the
way in. Skipping it is the classic mistake: mid grey is `0.5` in sRGB but
`0.214` linear, so a naive write lands about twice as bright as the picker
showed.

### Making colours stick

The engine does **not** persist them — upstream is explicit that direct-write
colours are runtime state. What it also says is that a mod is expected to store
them and reapply, which is what [`src/skinsync.ts`](src/skinsync.ts) does. The
database is the record; the pawn is just where they get painted.

Colours are saved **per player per species**, not per player. Keyed by player
alone, someone's Rex colours got repainted onto their Dryosaurus the moment they
switched — which is not what anyone means by "their skin". Each species keeps
its own look, and switching species repaints from that species' record.

Repainting happens on the events that replace a pawn: appearing online after
being away, switching species, dying, and the bot starting up. Deliberately
**not** every poll — that would be a write per player per minute forever to fix
something that only breaks on those.

Two of those events are invisible to a poll, and both were bugs:

- **A server restart.** The poll fails while the server is down, so the bot
  never observes anyone leaving; by the time it recovers they are already back,
  and it concludes they are still painted. It now forgets everything after any
  unreachable period.
- **A relog inside one poll window.** Never seen absent either. A sweep every
  five minutes forgets everything as cheap insurance.

Setting a colour therefore needs the player **spawned**, since otherwise there
is no species to attach it to.

`/admin skin reset` stops keeping someone's colours.

## Join role

`/admin joinrole set @role` gives every new member a role.

This needs the **Server Members Intent**, which is privileged and off by
default in the Discord developer portal. Asking for it without the toggle makes
login fail outright, so the bot catches that and starts without it, logging why
— everything except the join role works regardless.

Two things silently stop it working, and Discord reports both as the same
generic "Missing Permissions": the bot needs **Manage Roles**, and its own
highest role must sit **above** the role being handed out. `/admin joinrole set`
checks both when you set it and says which is wrong.

---

## Tiers

Species are graded 1–4. **Evrima has no concept of tiers** — this is server
policy, so every assignment and multiplier is overridable with `/admin tier`,
and a species the game adds later falls to tier 1 rather than breaking anything.

Tier 4 is Tyrannosaurus, Deinosuchus and Triceratops. Multipliers default to
×1, ×1.5, ×2 and ×3.

Tier drives both halves of the economy:

- **Playing** something higher earns proportionally more per minute.
- **A kill** pays on the **victim's** tier, plus 50% for each tier you punched
  up. A Dryosaurus that brings down a Rex has done something a Rex killing a
  Dryosaurus has not, and the payout says so.

## The shop

`/shop browse` and `/shop buy`. It sells one thing: a **fully grown** dinosaur,
delivered into storage, with optional mutations chosen at purchase.

Restore is same-species and transform-in-place, so buying a Tyrannosaurus does
**not** let anyone play one — they still spawn a juvenile and release the adult
over it. What is being sold is skipping the grow, and the wording says so
everywhere rather than letting someone buy the wrong thing.

**The delivery is written before the points are taken.** Reversed, a failed
delivery would leave someone charged with nothing; this way the worst case is a
free dinosaur, which is the right direction to fail in. The balance is re-read
at the moment of purchase, since points can be spent between the offer and the
click.

An offer can only be taken **once** — that is also the double-click guard, since
a second press finds it already spent rather than buying twice. Offers expire
after two minutes.

Prices default from tier (300 / 600 / 1,000 / 1,800) and are overridable per
tier or per species, with mutations adding 200 each. They start high
deliberately: cutting a price later reads as a gift, raising one reads as a
nerf.

Purchases eat one of the three storage vaults, are recorded permanently in the
`purchases` table, and can be mirrored to a channel with `/admin shop log`.
There are no refunds — buy-store-refund loops are where economies get
exploited, and it is easy to add later and awkward to remove.

## Points

Earned by playing, at a base rate set with `/admin points rate` (default 60 an
hour), scaled by tier. Nothing spends them yet — deliberately, so the earning
side can run long enough to be seen as fair before anything depends on it.

Points come from the **mod's** player list rather than RCON's, because the
payout depends on the species. Someone sitting on the spawn screen earns
nothing, which is the intended reading of "earned by playing".

Two decisions worth keeping:

- **Keyed by Steam ID, not Discord.** Someone who has never touched Discord
  still accrues, and finds a balance waiting when they link.
- **Awarded from the minute poll, and capped** at five minutes per award. Paying
  for wall-clock time would mean a bot that was down overnight paying everyone
  online for the whole outage on its first tick. Players are only paid for time
  they were actually observed online.

Balances are stored as `REAL` so a rate below one point per minute does not
round away, and displayed floored so nobody argues about a missing point.

---

## Scheduled restarts

**Evrima's RCON cannot restart the server.** It can announce, DM, kick, ban,
list players and save — that is the whole protocol. So the restart itself comes
from the host's Pterodactyl panel ([`src/pterodactyl.ts`](src/pterodactyl.ts)),
using a client API key. With no panel configured the bot still warns and saves;
the host's own scheduler then has to do the restart at the same times.

Restarts land on **fixed clock times anchored to midnight UTC**, not "six hours
after the bot started". Players can learn them, and they survive a bot restart.
Six-hourly means 00:00, 06:00, 12:00 and 18:00.

Warnings go out at **60, 30, 15, 5 and 1** minutes in game. Discord gets the 60,
15 and 5 minute ones, and the role is mentioned **only on the first** — the
later notices still post, they just do not buzz everybody again. Pinging a role
repeatedly through an evening is how that role ends up muted.

At zero the bot **saves first, always**, and saves even if the panel call then
fails: a late restart is a nuisance, a lost world is not.

An interval that does not divide 24 (5, 7, …) leaves a short gap before
midnight, because slots are anchored there. The command says so rather than
letting you find out.

`test/restarts.test.mjs` covers the boundaries that break schedulers: exactly on
the hour — which must move *forward*, or the bot would sit on a restart it has
already done — plus midnight and month rollover.

---

## In-game admins: the one real gotcha

Admins live in `Game.ini` as repeated `AdminsSteamIDs=` lines under
`[/script/theisle.tigamestatebase]`, read **only at startup**.

**The server rewrites that file when it shuts down.** So editing it while the
server runs is not merely ineffective — it is silently discarded.

The design that survives this:

- The **database is the desired state**; Game.ini is caught up to it.
- On first run the bot **adopts whoever is already in the file**, so the first
  write cannot remove admins nobody asked to remove.
- A reconciler runs every 60 s and writes the file **only while the server is
  down** (detected by RCON failing) — the one window where the change survives
  to the next start.
- `/admin game list` marks each entry 🟢 live or 🟡 waiting for a restart.

The operator workflow is therefore just: run the command, restart when
convenient.

Use the **`WindowsServer/Game.ini`** path even on a Linux host — the Windows
build runs under Proton, and `LinuxServer/Game.ini` is a stale decoy. Confirm by
timestamp: the live one is rewritten at server start.

Rewrites preserve every other byte of the file. `test/admins.test.mjs` exists to
keep it that way.

---

## Setup

Node **22.5+** (for `node:sqlite`). Copy `.env.example` to `.env` and fill in:

- Discord token and guild id
- RCON host, port, password
- SFTP credentials
- `MOD_DIR` — the mod's `Saved` folder, e.g.
  `TheIsle/Binaries/Win64/ue4ss/Mods/DinoStorage/Saved`
- `DISCORD_INVITE` — the link `!discord` sends. Blank disables the command
- `GAME_INI_PATH` — defaults to the WindowsServer path above

The game server needs **UE4SS** — the *experimental* build; stable 3.0.1 does
not load — with `dwmapi.dll` beside `TheIsleServer-Win64-Shipping.exe`, and the
mod in `TheIsle/Binaries/Win64/ue4ss/Mods/DinoStorage`.

```bash
pnpm install && pnpm verify
```

```bash
pnpm deploy:reload && pnpm commands && pnpm start
```

| Script | Does |
| --- | --- |
| `pnpm verify` | typecheck + build + tests. Must pass before a change is done |
| `pnpm deploy:reload` | Upload the mod and **confirm** it hot-reloaded |
| `pnpm commands` | Register slash commands to the guild |
| `pnpm start` | Run the bot |
| `pnpm log` | Tail the mod's log from the game server |

Tests import from `dist/`, so **build before testing**. None of them need a game
server: the RCON client is tested against a fake server speaking the binary
protocol, the bridge against a fake mod over a real in-process SFTP server.

---

## Rules for changing this

- **Never** add save-file decryption or key extraction. Live pawns only.
- **Deploy the mod after changing `main.lua`.** Forgetting produces
  `unknown verb: …`, which looks like a bot bug and is not.
- **Never write `main.lua` with a UTF-8 BOM.** Lua fails on line 1, which kills
  the tick loop — which is the thing that performs hot reloads, so recovery then
  needs a full server restart. The deploy script refuses BOMs; do not work
  around it.
- **A setter that raises no error proves nothing.** Read the value back.
- **Anything triggered by game chat must be idempotent.** The chat hook has been
  seen firing twice for one message, 9 seconds apart.
- Restore stages run 500 ms apart **in a required order** — `SetGrowth` refills
  every max vital, so it must come first. See `docs/NOTES.md`.
- TypeScript is strict, including `noUncheckedIndexedAccess`. No `any`.
- `guild` in code; **"server" in every user-facing string.**

## Not built yet

A shop/economy, breeding, playtime tracking, a heatmap.

For putting this somewhere it keeps running, see [docs/DEPLOY.md](docs/DEPLOY.md)
— note the **Node 22.5+** requirement, which is the usual reason a first deploy
fails.

**Untested:** store→restore of a dinosaur with mutations or `elderStacks > 0`.
Those code paths exist and follow the documented ordering, but no live run has
confirmed them.
