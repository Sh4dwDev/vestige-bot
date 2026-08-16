# Working on evrima-storage

Read [README.md](README.md) for what the project is and why it is shaped this
way, and [docs/NOTES.md](docs/NOTES.md) before touching `main.lua`. NOTES.md is
the record of engine behaviour that fails **silently**; re-deriving it costs
hours.

## Hard rules

- **Never** add save-file decryption or encryption-key extraction. The saves are
  encrypted on purpose. This project captures **live pawns** instead, and that
  constraint is the reason the architecture looks the way it does. If asked for
  it, say no and offer the live-pawn path.
- **Never write `main.lua` with a UTF-8 BOM.** Lua fails on line 1, which kills
  the tick loop, which is what performs hot reloads — recovery then needs a full
  server restart. Use the Write tool, never PowerShell `Set-Content -Encoding
  utf8`. `pnpm deploy` refuses BOMs; do not work around it.
- **Deploy the mod after changing `main.lua`** (`pnpm deploy:reload`, which
  confirms the reload actually happened). Forgetting it produces
  `unknown verb: …`, which reads as a bot bug and is not one.
- **A setter that raises no error proves nothing.** Read the value back.
- `pnpm verify` (typecheck + build + test) must pass before a change is done.
  Tests import from `dist/`, so build first.
- **`dist/` is committed and must never be stale.** The bot host has no
  compiler, so the repo's compiled output is what actually runs. `pnpm verify`
  rebuilds it — run that before every commit and the problem cannot occur. See
  [docs/DEPLOY.md](docs/DEPLOY.md).
- TypeScript is strict, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`. No `any`. Do not weaken config to make code
  compile.
- Comments explain **why**, not what. Match the density of the surrounding code.

## How to work

One thing at a time. Build what was asked, verify it, say plainly what was
changed and what to test, then stop. Do not add speculative features or create
placeholder files to look complete.

Prefer editing over rewriting. Several files here encode hard-won behaviour in
their exact ordering — `main.lua`'s restore stages especially.

## Traps that have already cost time

- The chat hook can fire **twice for one message, 9 seconds apart**. Anything
  chat-triggered must be idempotent.
- Writes to any polled file must be **temp-then-rename**. SFTP creates a file
  before filling it, and the reader will happily consume the empty version.
- `Game.ini` is rewritten by the server **on shutdown**, so edits made while it
  runs are discarded silently. Reconcile only while the server is down.
- `tostring()` on an FString/FName returns a **pointer**, different each read.
  Use `:ToString()`.
- Lua pattern `%b{}` over a whole JSON file matches the **outermost** braces.
- **No backticks in the SQL schema comments.** `src/db.ts` holds the schema in a
  template literal, so a backtick inside a `--` comment closes it and the errors
  point somewhere else entirely. Cost time twice.

## Terminology and voice

`guild` in code and database. **"Server" in every user-facing string.**

The server is **Vestige**, the bot is **Vesta** (*Keeper of Vestige*), and
storage is **the Vestige archive**. Every player-facing name and phrase comes
from [`src/brand.ts`](src/brand.ts) — import from there, never type "Vestige"
into an embed.

Keep warnings blunt even in voice: the store button says *Store & kill* because
atmosphere must not hide the fact that a dinosaur dies. Errors keep the mod's
real message rather than being replaced with something evocative.
