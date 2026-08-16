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
| `/admin game add\|remove\|list` | staff | In-game admins, via Game.ini |
| `/admin bot add\|remove\|list` | staff | Who may use `/admin` |
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

## Scheduled restarts

**Evrima's RCON cannot restart the server.** It can announce, DM, kick, ban,
list players and save — that is the whole protocol. So the restart itself comes
from the host's Pterodactyl panel ([`src/pterodactyl.ts`](src/pterodactyl.ts)),
using a client API key. With no panel configured the bot still warns and saves;
the host's own scheduler then has to do the restart at the same times.

Restarts land on **fixed clock times anchored to midnight UTC**, not "six hours
after the bot started". Players can learn them, and they survive a bot restart.
Six-hourly means 00:00, 06:00, 12:00 and 18:00.

Warnings go out at 60, 30, 15, 10, 5, 3 and 1 minutes in game; Discord gets the
60, 15 and 5 minute ones, optionally pinging a role — pinging seven times an
evening is how a role gets muted.

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
