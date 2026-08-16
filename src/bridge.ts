import crypto from 'node:crypto';

import SftpClient from 'ssh2-sftp-client';

import { SERVER } from './brand.js';

import type { Config } from './config.js';

/**
 * Talks to the DinoStorage mod.
 *
 * The mod runs inside the game server and has no sockets, so its interface is
 * NDJSON files in its own Saved directory, reached over SFTP:
 *
 *   inbox.ndjson     commands in
 *   results.ndjson   results out, append-only
 */

export type Verb =
  | 'store' | 'restore' | 'list' | 'delete' | 'slay' | 'players' | 'give' | 'teleport' | 'skin';

export interface StoredSlot {
  slot: string;
  species: string;
  storedAt: number;
}

export interface PlayerRow {
  species: string;
  growth: number;
  female: boolean;
  prime: boolean;
}

export interface Result {
  id: string;
  verb: string;
  steam: string;
  ok: boolean;
  msg: string;
  /** Shape depends on the verb: slots for `list`, players for `players`. */
  data?: StoredSlot[] | PlayerRow[];
}

/** store and restore run multi-stage pipelines; list and delete are immediate. */
const TIMEOUT_MS: Partial<Record<Verb, number>> = {
  store: 30_000,
  restore: 45_000,
  list: 15_000,
  delete: 15_000,
  slay: 20_000,
  players: 15_000,
};

/**
 * A verb with no entry above waited `NaN` milliseconds, which is never greater
 * than anything — so it gave up instantly and reported a timeout of "NaNs".
 */
const DEFAULT_TIMEOUT_MS = 15_000;

const timeoutFor = (verb: Verb): number => TIMEOUT_MS[verb] ?? DEFAULT_TIMEOUT_MS;

export class ModBridge {
  #client: SftpClient | null = null;
  #connecting: Promise<SftpClient> | null = null;
  /** Serialises inbox read-append-write so two commands cannot clobber. */
  #lock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly sftp: Config['sftp'],
    private readonly log: (message: string) => void = () => {},
  ) {}

  get modDir(): string {
    return `/${this.sftp.modDir.replace(/^\/+|\/+$/g, '')}`;
  }

  async #connect(): Promise<SftpClient> {
    if (this.#client) return this.#client;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const client = new SftpClient();
      await client.connect({
        host: this.sftp.host,
        port: this.sftp.port,
        username: this.sftp.username,
        password: this.sftp.password,
        readyTimeout: 15_000,
        // Managed panels drop idle SFTP sessions aggressively.
        keepaliveInterval: 10_000,
      });
      client.on('close', () => { this.#client = null; });
      client.on('error', () => { this.#client = null; });
      this.#client = client;
      this.log(`SFTP connected to ${this.sftp.host}:${this.sftp.port}`);
      return client;
    })().finally(() => { this.#connecting = null; });

    return this.#connecting;
  }

  /** Reconnects once: a dropped session is the normal failure here. */
  async #withClient<T>(fn: (client: SftpClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const client = await this.#connect();
      try {
        return await fn(client);
      } catch (err) {
        this.#client = null;
        await client.end().catch(() => undefined);
        if (attempt === 1) throw err;
        this.log(`SFTP retry: ${(err as Error).message}`);
      }
    }
    throw new Error('unreachable');
  }

  async check(): Promise<void> {
    await this.#withClient(async (client) => {
      if (!(await client.exists(this.modDir))) {
        throw new Error(
          `MOD_DIR not found on the server: ${this.modDir}. It should be the mod's Saved folder.`,
        );
      }
    });
  }

  /**
   * Uploads atomically. A plain put creates the file and fills it afterwards,
   * and the mod polls every 3s — so it can read an empty file in between and
   * silently swallow the command.
   */
  async #putAtomic(remote: string, body: Buffer): Promise<void> {
    await this.#withClient(async (client) => {
      const tmp = `${remote}.uploading`;
      await client.put(body, tmp);
      if (await client.exists(remote)) await client.delete(remote).catch(() => undefined);
      await client.rename(tmp, remote);
    });
  }

  async #readResults(): Promise<Result[]> {
    const raw = await this.#withClient((client) =>
      client.get(`${this.modDir}/results.ndjson`).catch(() => null),
    );
    if (raw === null || !Buffer.isBuffer(raw)) return [];

    const out: Result[] = [];
    for (const line of raw.toString('utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Result);
      } catch {
        // A torn final line is expected while the mod is appending.
      }
    }
    return out;
  }

  /**
   * Sends a command and waits for the matching reply.
   *
   * `quiet` suppresses the log lines. Background refreshes use it — an open
   * panel polls every 20 seconds, and logging all of that buries the commands a
   * person actually issued.
   */
  async run(
    verb: Verb,
    steamId: string,
    args: Record<string, unknown> = {},
    { quiet = false }: { quiet?: boolean } = {},
  ): Promise<Result> {
    const id = `bot-${crypto.randomBytes(6).toString('hex')}`;
    const line = JSON.stringify({ id, ts: Math.floor(Date.now() / 1000), verb, steam: steamId, args });

    await (this.#lock = this.#lock.then(async () => {
      const inbox = `${this.modDir}/inbox.ndjson`;
      // The mod renames the inbox away while processing, so a missing file is
      // normal rather than an error.
      const existing = await this.#withClient((client) => client.get(inbox).catch(() => null));
      const prefix = existing && Buffer.isBuffer(existing) ? existing.toString('utf8') : '';
      await this.#putAtomic(inbox, Buffer.from(prefix + line + '\n', 'utf8'));
    }, () => undefined));

    if (!quiet) this.log(`-> ${verb} ${steamId} ${JSON.stringify(args)}`);

    const deadline = Date.now() + timeoutFor(verb);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));
      const match = (await this.#readResults()).find((entry) => entry.id === id);
      if (match) {
        if (!quiet) this.log(`<- ${verb} ok=${match.ok} ${match.msg}`);
        return match;
      }
    }

    throw new Error(
      `${SERVER} did not answer within ${timeoutFor(verb) / 1000}s — it may be restarting`,
    );
  }

  /**
   * Things players typed in game chat — link codes and `!discord`. The mod
   * appends these to the results file as they happen, so the bot polls rather
   * than being pushed to. One read serves both, since the watcher wakes often.
   */
  async chatEvents(): Promise<
    Array<{ id: string; verb: string; steam: string; text: string; data?: unknown }>
  > {
    const wanted = new Set(['linkcode', 'discordreq', 'kill', 'tpaccept']);
    return (await this.#readResults())
      .filter((entry) => entry.ok && wanted.has(entry.verb))
      .map((entry) => ({
        id: entry.id,
        verb: entry.verb,
        steam: entry.steam,
        text: entry.msg.trim(),
        data: entry.data,
      }));
  }

  /** Who is playing what, right now. */
  async players(): Promise<PlayerRow[]> {
    const result = await this.run('players', '0');
    if (!result.ok) throw new Error(result.msg);
    return (result.data ?? []) as PlayerRow[];
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    if (client) await client.end().catch(() => undefined);
  }
}
