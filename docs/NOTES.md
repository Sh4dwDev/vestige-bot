# Engine notes

Verified against a live EVRIMA **0.21.720** server, UE4SS **experimental**,
Lua 5.4. Grounded in
[diplomatic-tendencies/evrima-dev-knowledge](https://github.com/diplomatic-tendencies/evrima-dev-knowledge),
with corrections from things that actually happened here.

Almost everything below fails **silently**. That is why it is written down.

## Architecture is forced, not chosen

`RequestRespawn` **always crashes from Lua** — UE4SS cannot marshal the
by-value `FCustomizerDataBase` parameter. So a dinosaur cannot be removed from
the world cleanly, and restore is *transform-in-place*:

1. Capture the live pawn
2. `SetHealth(0)`
3. The player respawns naturally as a juvenile of the same species
4. The mod mutates that new pawn back into what they had

That is why storing kills you, and why restore is same-species only.

## Restore ordering is mandatory

`SetGrowth` **recomputes and refills every max vital**, so anything written
before it is discarded. The engine also rejects mutation writes that land in the
same tick as bulk state writes. Stages run 500 ms apart:

1. growth → maxes → currents → prime
2. active mutation slots 1–4
3. the 12 inherited Parent/Elder slots
4. nutrients
5. **vitals again** — mutation staging disturbs GAS attributes
6. `SetElderReplicationStacks` last

## Corrections to the upstream docs

| Documented | Actually |
| --- | --- |
| `tostring(fname)` gives the value | Gives a **pointer** (`FString: 0000…`), different each read. Use `:ToString()` first |
| `GetIsEligiblePrimeEligible()` | Does not exist. Use `GetEligiblePrimeElderData()` |
| `ServerSetPrimeEligible(true)` | Writes a cached bool the engine recomputes away within a frame. Write the struct |
| Every vital has a `Set*` | `SetFoodValue` and `SetMaxFoodValue` do **not** exist. Fall back to `pawn.FoodValue = …` |
| UE4SS 3.0.1 stable | Does not load. Mod root is `Binaries/Win64/ue4ss/Mods`, not `Binaries/Win64/Mods` |

`EVRIMA_Patch_0.21.720_Migration.md`, referenced by the upstream README, does
not exist.

## Things that crash

- `FindAllOf("TIPlayerController")` returns stale post-disconnect controllers.
  Track Steam IDs and re-derive controllers each tick.
- `FindFirstOf` on a class with **no live instances** raises a native access
  violation ~1.7 s later. Never call it at boot.
- **Indexing a UObject with a property name that does not exist.** Probing
  `ctrl["ClientShowNotification"]` to discover whether a function exists does
  not return nil — it takes the tick loop down, and `pcall` does not catch it.
  Observed 2026-08-16: a read-only reflection probe killed the loop, which
  stopped the mod consuming its inbox while leaving it looking healthy in the
  log (it had already printed `ready` and detected the game mode). Because hot
  reload lives in that same loop, recovery needed a full server restart.
  **Never enumerate engine functions by guessing names.** Get them from a UE4SS
  object dump offline instead.
- `K2_GetPawn()` returns a **non-nil wrapper around a null pointer** during
  spawn-select and respawn. Gate on `GetAddress() ~= 0`.
- Caching a UObject pointer or struct userdata across ticks is a stale-pointer
  crash about a second later.
- A `return` that is not the last statement in its block fails the script load
  **silently**.

Native crashes are not catchable by `pcall`; they surface as access violations
up to 30 s after the offending call.

**A dead tick loop is close to invisible.** The mod keeps its boot lines, its
chat hook keeps firing (native hooks are independent of the loop), and nothing
is logged. The tell is on disk: `inbox.ndjson` stops shrinking while
`results.ndjson` stops growing. Check those two before suspecting the bot.

## Things that fail silently

- **`ElderReplicationStacks` alone decides mutation tier.** Slot type does not.
  Skip it and a restored Life 3 dino behaves as Life 1 with correct-looking
  slots.
- **`SetSlotNEquippedMutation`** rejects calls in the same tick as bulk writes,
  only commits the last of a rapid batch, and fails validation on freshly
  restored Life 2+ dinos. Write `ReplicatedMutationsData` fields directly and
  force replication.
- **A setter that raises no error proves nothing.** Read the value back.
- **`MutationsRequirementsData.UnlockRequiredMutations` is pawn-local** and lost
  on respawn, because respawn rehydrates from stale `TIPlayerData`. Capture it
  before the pawn dies.
- **A UTF-8 BOM** makes Lua fail on line 1. Because the reload watcher lives
  inside the script, hot reload can then never recover it — only a server
  restart. Observed once; the deploy script now refuses BOMs and verifies the
  reload happened.
- **Non-atomic writes to polled files.** SFTP creates a file then fills it; the
  mod polls every 3 s and can read the empty version, silently swallowing the
  command. Upload to a temp name and rename.
- **`%b{}` over a whole JSON file** matches the outermost braces first and
  yields one entry however many exist. That silently dropped every stored slot
  on the next write. Isolate the array first.

## Chat hook

`RegisterHook("/Script/TheIsle.TIPlayerController:GetChatMessage", …)` fires and
works. Verified live:

```
chat hook: steam="76561198398925364" text="!link KWMTNY"
```

The parameter layout is undocumented, so the handler tries each argument as both
the controller and the text rather than assuming an order, and takes whichever
yields a valid Steam ID and a non-ID string. That survives a signature change.

**It can fire more than once for one message** — observed twice, **9 seconds
apart**, which is well outside the 3-second dedupe window the upstream docs
suggest. Anything triggered from chat must therefore be idempotent on the
consuming side; the bot dedupes by event id and clears the pending link on first
use, so a repeat is inert.

This is why linking works the way it does: the bot shows the code in Discord and
the player types it in game. The reverse — RCON `directmessage` — renders as a
notification that vanishes in about a second, which is unusable for something
that has to be read and retyped.

The mod can **read** chat but not **write** it — `UpdateChat` is unreachable from
Lua. So `!discord` is answered by the bot over RCON, not by the mod. Any future
chat command works the same way: the mod raises an event, the bot replies.

## Config files are rewritten on shutdown

`Game.ini` is read **only at startup**, and the server **rewrites it when it
stops**. An edit made while the server is running therefore disappears without
any error — the most convincing silent failure in the project, because the file
visibly contains the change right up until the shutdown that discards it.

The only durable window is while the server is down. `src/admins.ts` treats the
database as the desired state and reconciles into the file then.

Two copies exist. **`WindowsServer/Game.ini` is the live one**, even on a Linux
host, because the Windows build runs under Proton; `LinuxServer/Game.ini` sat
stale with an empty `AdminsSteamIDs`. Tell them apart by timestamp — the live one
is rewritten at server start.

## Environment limits

Lua here has **no mkdir and no directory listing**. So:

- slot files are flat (`stored/<steam>__<slot>.json`), because a per-player
  folder cannot be created for someone never seen before;
- `storage.json` is authoritative rather than a cache that could be rebuilt by
  scanning.

`os.rename` will not clobber an existing file on Windows/Wine — remove the
target first.

## Host notes

- UE4SS **works under Proton**. Game Host Bros runs the Windows build on Linux;
  it loaded with no `WINEDLLOVERRIDES`. The panel's "Windows" toggle selects the
  game build, not the host OS.
- Some hosts **block `.dll` uploads entirely** (LOW.MS does), which makes UE4SS
  impossible there. Test with a junk `.dll` before committing to a host.
