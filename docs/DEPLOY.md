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

1. **Startup → Node version:** set 22.5+ (see above).
2. **Startup command:**

   ```
   npm install && npm run build && npm start
   ```

   The build step is not optional: `dist/` is gitignored, so the host compiles
   from source. `npm install` must include devDependencies — TypeScript lives
   there — so do not set `NODE_ENV=production`.
3. **Pull the code.** Either point the panel's git integration at the repo, or
   upload the files by SFTP. Never upload `.env` through git.
4. **File Manager → create `.env`** and paste in the real values, using
   [`.env.example`](../.env.example) as the template. This is the only place
   secrets live.
5. Start it. The log should read:

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

```bash
git pull && npm install && npm run build
```

then restart. Run `pnpm commands` as well **only** when a slash command's name,
description or options changed — not for ordinary code edits.

If `main.lua` changed, the game server needs it too, which is a separate step
from deploying the bot:

```bash
pnpm deploy:reload
```
