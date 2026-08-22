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
- **A *fixed* temp name is its own race.** Two writers both staging to
  `inbox.ndjson.uploading` means the loser's rename fails with `no such file`,
  because the winner already moved it. Observed with a maintenance script run
  alongside the live bot. The temp name now carries random bytes, and a failed
  rename deletes its own temp file rather than leaving something that looks
  like a real one.
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

The mod can **read** chat but not **write** it — `UpdateChat` takes the server
down from Lua on FText marshalling and is C++ only. So `!discord` is answered by
the bot over RCON. Any future chat command works the same way: the mod raises an
event, the bot replies.

## On-screen notifications — the FText is the whole trick

`ClientShowNotification` is the persistent on-screen notice the game uses for
prime conditions. It is the only in-game text that stays put; an RCON
`directmessage` draws over the ANNOUNCEMENT label and is gone in about a second.

**It crashed this server on 2026-08-17** — called from the inbox tick on a
freshly-resolved controller, with a plain Lua string as the message:

```
Unhandled Exception: EXCEPTION_ACCESS_VIOLATION reading address 0x70
[Callstack] UE4SS.dll  (deeply recursive)
```

That note used to end "do not re-add a notify verb without a way to construct a
real FText, which Lua has no obvious route to." **There is a route**, and the
crash was the argument, not the function:

```lua
local function makeText(message)
    if FText == nil then return nil end
    local ok, ft = pcall(function() return FText(message) end)
    if ok and ft ~= nil then return ft end
    return nil
end
```

UE4SS marshals a bare Lua string into an FText whose internal shared reference
is not what the serializer expects; it dereferences during replication and
faults. Constructing a real `FText` first is the fix.

Three rules, all enforced in `handleNotify`:

- **Build the FText, or refuse.** If `FText` is unavailable, do not fall back to
  the raw string — that is precisely the call that took the server down, and
  `pcall` does not catch a native fault.
- **Call it from a tick**, never inside a native hook. The inbox poll is one.
- **Resolve the controller fresh** with `gm:GetControllerBySteamId(steam)`. A
  controller cached from a hook parameter is a stale pointer.

It is a **Client RPC on one controller**, so it reaches one player. There is no
broadcast form — a server-wide notice means looping the online list.

## AI wildlife

There is no config or RCON route to *add* AI. `0x90 ToggleAI` only switches what
the game spawns for itself. Adding any means spawning a pawn and its matching
controller from Lua, which upstream documents in `EVRIMA_AI_Spawn_Pairs.md`.

The pairs are **not interchangeable**, and several species have no brain of
their own — Triceratops, Stegosaurus and Pachycephalosaurus all borrow the
Diabloceratops controller; Allosaurus borrows the Rex one. The verified table
lives in `AI_PAIRS` in the mod, mirrored by name in
[../src/wildlife.ts](../src/wildlife.ts); a test fails if the two drift.

Order matters: `Possess` first (the brain boots on possession, there is no
separate start call), then `SetGrowth`, then refill vitals — growth resets them.

Two rules that have each cost a server elsewhere:

- **Never `K2_DestroyActor` a spawned AI.** If gameplay already removed the
  pawn, the destroy call is an uncatchable native crash. Cleanup is a restart or
  RCON ToggleAI.
- **Never set `bAlwaysRelevant`.** It crashes clients during join bursts. Leave
  relevance distance-based.

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

## Kills and deaths

Per upstream `EVRIMA_KillFeed_Design.md`, confirmed against its own testing:

**There is no server-side UFunction death event.** Polling health is mandatory.
These all look right and never fire, or fire unreliably on a natural death:
`OnDeath`, `OnPawnDeath`, `UpdateCharacterCooldownOnDeath`, `SetHealth`,
`SetIsAlive`, `ToggleServerRagdoll`, `WaitAndDestroyCorpse`.

What does work is attribution, not detection:

| Piece | How |
| --- | --- |
| Who hit whom | Hook `/Script/TheIsle.TICharacterBase:ApplyDamage` and cache attacker + timestamp per victim |
| That someone died | Poll pawn health for a `>0 → 0` transition |
| Joining the two | Credit the cached attacker if the death lands within ~20 s |

**Storing and slaying are not deaths either.** Both work by setting health to
zero, which is indistinguishable from being eaten to a health poll — so putting
a dinosaur away posted "died" to the kill feed and counted against the player.
The mod skips the death check while it is mid-operation on that player, which
`busyUntil` already tracked.

**A vanishing pawn is not a death.** Spectator camera unpossesses the pawn
exactly as dying does, so "pawn gone while last seen alive" reports healthy
players as dead — observed live on 2026-08-16, a player entering spec cam
produced a death in the feed. A vanish only counts when something damaged them
within the attribution window; otherwise it is spectating, disconnecting or
spawn-select.

`ApplyDamage` fires on **direct player attacks only** — not damage over time, not
environmental, not AI. Those deaths are real but unattributed, so a kill count
and a death count will never reconcile. Say so in the UI rather than letting
people conclude the numbers are broken.

Catching every damage type needs the C++ path: hooking
`PostGameplayEffectExecute` on `UAttributeSet` at the vtable level, with the
instigator from `data.EffectSpec.GetContext()`.

## AI cannot be cleared from Lua

Per upstream `EVRIMA_AI_Spawn_Pairs.md`:

> DON'T try to clean up AI from Lua via `K2_DestroyActor`. If gameplay already
> destroyed the pawn, your destroy call crashes the server.

Track AI **read-only, never for destroy paths**. A wrapper can reference a pawn
gameplay already removed, and calling into it is a delayed native access
violation — uncatchable, and it takes the game server down mid-session rather
than just the mod.

**From RCON it is fine.** An earlier version of this note said there was no AI
opcode and that only a restart could clear them; that was wrong. `0x90 ToggleAI`
exists, and the *server* does the work — the same reason `WipeCorpses` is safe.
`clearAI()` in [../src/cleanup.ts](../src/cleanup.ts) flips it off and back on.

It is a **toggle, not a setter**, and the reply is the only readout:

```
> ToggleAI    reply: "AI spawns are now On"
> ToggleAI    reply: "AI spawns are now Off"
```

Whether that names the state it *entered* or the one it *left* could not be
settled over RCON — both readings fit. So the rule is: **always flip an even
number of times.** Then the server ends where it started regardless, and the
worst case is one brief cycle instead of a lasting change. `clearAI()` flips
once, reads the reply, and only completes the cycle when there was something to
clear. If the balancing flip fails the state is left inverted, which is why
that failure is logged loudly rather than swallowed.

## Species caps can be enforced, from RCON only

`0x1B RemovePlayable` / `0x1A AddPlayable` take a species out of and back into
the spawn menu; `0x15 UpdatePlayables` makes an open spawn menu re-read it.

Do **not** try this from Lua. Per upstream `EVRIMA_Cut_Dino_Enablement.md`, Lua
can grow the `AvailableClasses` array but assigning the entry's
`TSoftClassPtr Class` field is a native crash `pcall` cannot catch.

**`0x15 UpdatePlayables` DO NOT CALL.** The name reads as "push the list to
connected clients". It is not. It rebuilds the list from the base catalogue and
leaves it **empty** — every species unspawnable at once. Verified live on
2026-08-17 while probing the format: 22 playables went to 0, and the list had to
be rebuilt one `AddPlayable` at a time.

```
> UpdatePlayables
  reply: "Playables updated:"
  after: 0 playables
```

`AddPlayable` and `RemovePlayable` take effect on their own — no push is
needed. The server confirms each write by echoing the new list.

Two more rules, both encoded in [../src/enforce.ts](../src/enforce.ts):

- **Read the list back.** A name the server does not recognise is accepted in
  silence and does nothing, so a write is only believed once `getplayables`
  confirms it. The name format is whatever `getplayables` prints — bare, like
  `Tyrannosaurus`, not `BP_Tyrannosaurus_C`.
- **Reconcile, never remember.** Desired state is computed from the caps and
  diffed against the live list on every pass. If the bot is the only thing that
  knows a species was removed, a crash leaves it unspawnable forever.

## Schedulers fire on a window, not on zero

`nextRestart()` returns the next slot **strictly after** `now`, so a tick that
waits for `minutesUntil(...) <= 0` waits forever: the instant the clock reaches
the slot, the answer jumps a whole interval ahead. The restart scheduler had
this bug from the start and never once fired.

Use `isDue()`, which is true inside a window one tick wide. A slot missed
entirely — bot down across it — is deliberately **not** fired late; a surprise
restart on startup is worse than a skipped one.

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

## Mutations are captured on store but not written back

`MutationsRequirementsData.UnlockRequiredMutations` is read into
`state.unlockRequiredMutations` when a dinosaur is stored, and **nothing ever
writes it back**. The capture even carries a comment explaining that it is
pawn-local and lost on respawn, so the asymmetry looks like an unfinished
thought rather than a decision.

A gifted dinosaur is worse: the gift builder sets it to an empty array, because
no pawn exists at that point to read it from.

**The symptom**, reported live on a shop-bought fully grown dinosaur with four
mutations: the game keeps flashing "mutation available" while the picker offers
nothing selectable. That fits a pawn whose slots are filled but whose unlock
requirements are empty or stale.

**Not yet fixed, deliberately.** Writing it back needs the setter for that
struct, and the way to write a `TArray` on it from UE4SS Lua is not established
here. `ReplicatedMutationsData` has `SetReplicatedMutationsData`, so a matching
setter is plausible — but plausible is how invented API names get shipped, and
this file exists because that has cost hours before. Confirm against
`diplomatic-tendencies/evrima-dev-knowledge`, or read the struct off a naturally
grown dinosaur and compare, before touching the restore path.

## Fall damage never reaches ApplyDamage

Measured, not assumed. A probe on `TICharacterBase:ApplyDamage` logging its
first six calls was deployed, the server rebooted at 14:56:04, and a player died
to fall damage at 14:57:05 — **with no probe line in between**. Zero calls, so
no parameter of that hook carries a fall. The existing comment on the hook said
as much ("direct player attacks only — never damage over time, environmental or
AI damage") and it is right.

**Do not probe this hook again for environmental causes.** It cannot answer.
Naming a fall, a drowning or a bleed needs a different hook, which is not
identified here — check `diplomatic-tendencies/evrima-dev-knowledge` before
attempting it.

Two things the same exercise did establish:

- The hook **does** fire for real damage, so the AI-killer attribution built on
  it works. A death to wildlife is named; a death to a fall is not.
- UE4SS hands each parameter over as a **wrapper**, and passes a fixed fourteen
  regardless of the real signature. Calling a method straight on one returns
  nil; `unwrap()` (`:get()`) first. The first version of the probe logged
  fourteen nils for exactly this reason.
