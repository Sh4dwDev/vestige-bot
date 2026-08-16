# Deploying Vesta

The bot is one Node process. It needs almost nothing in the way of resources —
but it does need two things, and both have caught people out.

## The two hard requirements

**Node 22.5 or newer.** The database uses `node:sqlite`, which does not exist
before 22.5. On Node 18 or 20 the bot dies at boot with:

```
Error: No such built-in module: node:sqlite
```

`pnpm start` already passes `--experimental-sqlite`, which is required on
22.5–23.3 and harmless on 24+, so any version from 22.5 up works as-is. If the
host cannot offer 22.5, `node:sqlite` has to be swapped for `better-sqlite3` —
that is a code change, not a config one.

**A persistent disk.** `data/storage.sqlite` holds every Discord↔Steam link. A
platform with an ephemeral filesystem loses it on each deploy and everyone has
to run `/link` again. Anything with a real volume — a VPS, PebbleHost,
Pterodactyl — is fine.

Also worth checking on a locked-down host: the bot makes **outbound** SFTP
(port 2022) and RCON (port 27346) connections. Both must be allowed.

## PebbleHost, or any Pterodactyl panel

The loader on these panels pulls the repo, runs `npm install`, then runs
**`npm start`** — it does not run an arbitrary startup command. So the build has
to hang off `npm start` itself, which is what the `prestart` script in
`package.json` is for. Delete it and the host boots with no `dist/` and dies
with `Cannot find module '/home/container/dist/index.js'`.

These loaders also install **production dependencies only**. That is why
`typescript` and the `@types/*` packages sit in `dependencies` rather than
`devDependencies` — with them in the usual place the build dies at:

```
sh: 1: tsc: not found
```

Moving them is deliberate. The alternative, committing `dist/`, means the host
can silently run stale JavaScript whenever someone edits source and forgets to
rebuild; building on the host fails loudly instead, and there is only ever one
source of truth.

Only `ssh2` — used by the test suite's fake SFTP server — stays a
devDependency, because the host never runs tests.

1. **Startup → Node version:** set 22.5+ (see above).
2. **Git:** point the panel's git integration at the repo, branch `main`.
   Never let `.env` reach git.
3. **File Manager → create `.env`** and paste in the real values, using
   [`.env.example`](../.env.example) as the template. This is the only place
   secrets live. Without it the bot starts and then stops at
   `Missing required environment variable DISCORD_TOKEN`.
4. Start it. The log should read:

   ```
   SFTP connected to …
   mod directory OK: …
   RCON connected to …
   logged in as Vesta#…
   status: N online
   ```

   Any of those missing is the thing to investigate — they come in that order.

## On a VPS instead

Same requirements, plus a service so it survives a reboot.
`/etc/systemd/system/vesta.service`:

```ini
[Unit]
Description=Vesta, Keeper of Vestige
After=network-online.target

[Service]
WorkingDirectory=/root/vestige-bot
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now vesta && journalctl -u vesta -f
```

## Never run two copies

Two instances both poll `results.ndjson` and both answer every command, so
players get duplicated replies and duplicated in-game effects. Stop the old one
before starting the new one — including any copy running on a developer machine.

## Updating

On a panel, a restart pulls and rebuilds by itself. By hand:

```bash
git pull && npm install
```

then restart — `npm start` rebuilds. Run `pnpm commands` **only** when a slash command's name,
description or options changed — not for ordinary code edits.

If `main.lua` changed, the game server needs it too, which is a separate step
from deploying the bot:

```bash
pnpm deploy:reload
```
