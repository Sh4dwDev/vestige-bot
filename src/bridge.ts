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
  | 'store' | 'restore' | 'list' | 'delete' | 'slay' | 'players'
  | 'give' | 'teleport' | 'where' | 'skinget' | 'skinmany' | 'pattern'
  | 'notify' | 'heal' | 'prime' | 'nest' | 'look' | 'skinfields'
  | 'transfer' | 'slotinfo';

export interface StoredSlot {
  slot: string;
  species: string;
  storedAt: number;
}

/**
 * Storage slots per player.
 *
 * The **mod** is the authority — it enforces this and refuses a write past it.
 * This copy only lets the bot say so in words first, so the two must be changed
 * together. It lives here because this is where the mod's contract lives.
 */
export const MAX_SLOTS = 3;

/** What the mod reports for one player's prime progress. */
export interface PrimeState {
  eligible: boolean;
  /** Keyed "1" to "10". Absent keys are conditions the pawn did not expose. */
  conditions: Record<string, boolean>;
  growth: number;
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  hunger: number;
  maxHunger: number;
  thirst: number;
  maxThirst: number;
  /** How many Elder stacks the pawn carries; this alone decides Elder tier. */
  elderStacks: number;
  /** Per-nutrient values, plus `bMalnutrition`. Empty if the pawn withheld them. */
  nutrients?: Record<string, number | boolean>;
}

export interface PlayerRow {
  /** Present from mod v3.2.0 on; older payloads omit it. */
  steam?: string;
  species: string;
  growth: number;
  female: boolean;
  prime: boolean;
  /**
   * Where they are, from mod v3.24.0 on. Optional because a pawn that will not
   * give a location still counts as playing - it just cannot be plotted.
   */
  x?: number;
  y?: number;
}

export interface Result {
  id: string;
  verb: string;
  steam: string;
  ok: boolean;
  msg: string;
  /** Shape depends on the verb: slots for `list`, players for `players`. */
  data?: StoredSlot[] | PlayerRow[] | PrimeState;
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

/**
 * How often the reply file is checked, and for how long at the quick rate.
 *
 * The mod polls its inbox every 500ms, so a normal reply lands inside a second.
 * Checking every 250ms for the first few seconds catches that; after which the
 * command is one of the slow ones and there is nothing to gain from asking
 * constantly.
 */
const QUICK_POLL_MS = 250;
const SLOW_POLL_MS = 750;
const QUICK_POLL_FOR_MS = 5_000;

/**
 * Notifications must be plain ASCII.
 *
 * Verified live on 2026-08-17: "Travelling in 45s - hold still" arrives, and the
 * same line with an em dash is swallowed — no error, no reply, nothing on
 * screen. Somewhere between the NDJSON bridge and the FText it does not
 * survive, and it fails silently, which is the worst way to fail.
 *
 * So the punctuation is folded here rather than asking every caller to
 * remember. Anything still non-ASCII after folding is dropped.
 */
export function toPlainAscii(message: string): string {
  return message
    .replace(/[\u2014\u2013]/g, '-')   // em and en dash
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes
    .replace(/\u2026/g, '...')        // ellipsis
    .replace(/\u00A0/g, ' ')          // non-breaking space
    // Anything left outside printable ASCII goes, rather than being sent and
    // silently swallowed at the far end.
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

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
      // Unique per write: a fixed temp name means two writers racing on the
      // same path, and the loser's rename fails with "no such file" because the
      // winner already moved it. Seen for real with a maintenance script
      // running alongside the live bot.
      const tmp = `${remote}.${crypto.randomBytes(4).toString('hex')}.uploading`;
      await client.put(body, tmp);

      try {
        if (await client.exists(remote)) await client.delete(remote).catch(() => undefined);
        await client.rename(tmp, remote);
      } catch (err) {
        // Never leave the temp file behind to be mistaken for a real one.
        await client.delete(tmp).catch(() => undefined);
        throw err;
      }
    });
  }

  /**
   * How often the reply file is checked while waiting.
   *
   * This used to be one second, and the loop slept *before* its first read, so
   * every command paid a second it did not need. Together with the mod's own
   * poll that was most of the three to four seconds a command took, and almost
   * none of it was work.
   */
  #resultsAt = 0;
  #resultsCache: Result[] = [];
  #resultsInFlight: Promise<Result[]> | null = null;

  /**
   * A read of the reply file that concurrent waiters share.
   *
   * Polling four times a second is fine for one command and rude for six: each
   * waiter would pull the same file over SFTP independently. This collapses
   * them into one read, so the load on the game host depends on how often we
   * poll and not on how many people are waiting.
   *
   * Safe because `#readResults` is a pure read with no offsets and no
   * consumption. A reply that arrives during the cached window is picked up by
   * the next pass a quarter of a second later.
   */
  async #sharedResults(maxAgeMs: number): Promise<Result[]> {
    if (Date.now() - this.#resultsAt < maxAgeMs) return this.#resultsCache;
    if (this.#resultsInFlight) return this.#resultsInFlight;

    this.#resultsInFlight = this.#readResults()
      .then((rows) => {
        this.#resultsCache = rows;
        this.#resultsAt = Date.now();
        return rows;
      })
      .finally(() => {
        this.#resultsInFlight = null;
      });

    return this.#resultsInFlight;
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
    const started = Date.now();

    while (Date.now() < deadline) {
      // Quick while an answer is plausibly imminent, slower afterwards. Store
      // and restore run for tens of seconds, and polling those four times a
      // second for the whole run would be pointless traffic.
      const gap = Date.now() - started < QUICK_POLL_FOR_MS ? QUICK_POLL_MS : SLOW_POLL_MS;
      await new Promise((r) => setTimeout(r, gap));

      // Half the gap: fresh enough that a shared read cannot cost a whole extra
      // pass, old enough that simultaneous waiters still share one.
      const match = (await this.#sharedResults(gap / 2)).find((entry) => entry.id === id);
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

  /**
   * A persistent on-screen notice, the same one the game uses for prime.
   *
   * Preferred over RCON `directmessage` for anything a player needs to read:
   * that renders over the game's own ANNOUNCEMENT label and is gone in about a
   * second, which is fine for a link code and useless for anything else.
   *
   * Never throws. A notice is always a nicety on top of a Discord reply that
   * already went out, so failing to show one must not fail the command.
   */
  async notify(steamId: string, message: string): Promise<boolean> {
    try {
      return (await this.run('notify', steamId, { message: toPlainAscii(message) },
        { quiet: true })).ok;
    } catch {
      return false;
    }
  }




  /**
   * Finds and reads a file in the mod directory, by listing rather than by
   * guessing names.
   *
   * Guessing meant four `get` calls per refresh for a file that is usually not
   * there, and a miss goes through the reconnect-and-retry path — so a server
   * with no map picture reconnected SFTP eight times every five minutes and
   * filled the log with it. One listing answers the whole question.
   *
   * The negative answer is cached too: "there is no map here" does not change
   * often enough to be worth asking every time.
   */
  async findFile(match: RegExp): Promise<Buffer | null> {
    const now = Date.now();
    if (this.#missAt && now - this.#missAt < 10 * 60_000) return null;

    let name: string | null = null;
    try {
      const listing = await this.#withClient((client) => client.list(this.modDir));
      name = listing.find((entry) => entry.type === '-' && match.test(entry.name))?.name ?? null;
    } catch {
      return null;
    }

    if (!name) {
      this.#missAt = now;
      return null;
    }

    this.#missAt = 0;
    try {
      const data = await this.#withClient((client) => client.get(`${this.modDir}/${name}`));
      return Buffer.isBuffer(data) ? data : null;
    } catch {
      return null;
    }
  }

  /** When the last listing found nothing, so it is not asked again immediately. */
  #missAt = 0;

  /** Who is playing what, right now. */
  async players(): Promise<PlayerRow[]> {
    const result = await this.run('players', '0');
    if (!result.ok) throw new Error(result.msg);
    return (result.data ?? []) as PlayerRow[];
  }

  /**
   * The ten prime condition flags for one player, with their vitals.
   *
   * Reported by number. What each condition actually means is not documented
   * anywhere, so the vitals ride along: the mapping is worked out by changing
   * one thing in game and seeing which flag moves.
   */
  async prime(steamId: string): Promise<PrimeState> {
    const result = await this.run('prime', steamId);
    if (!result.ok) throw new Error(result.msg);
    return result.data as PrimeState;
  }

  /**
   * Reads the part of a file that has appeared since `from`.
   *
   * For tailing the game's own log, which is megabytes by the end of a session
   * — fetching the whole thing every poll would move a gigabyte an hour to
   * read a handful of new lines. `start` on the read stream means only the new
   * bytes cross the wire.
   *
   * A file that has shrunk was rotated, which the server does on restart. That
   * is reported rather than guessed at, so the caller can start again from the
   * beginning instead of seeking past the end of a fresh file.
   */
  async tailFile(
    remotePath: string,
    from: number,
  ): Promise<{ text: string; at: number; rotated: boolean } | null> {
    try {
      return await this.#withClient(async (client) => {
        const stat = await client.stat(remotePath).catch(() => null);
        if (!stat) return null;

        const size = stat.size;
        if (size === from) return { text: '', at: size, rotated: false };

        const rotated = size < from;
        const start = rotated ? 0 : from;

        // createReadStream rather than get: ssh2 supports a byte range on the
        // stream, and the wrapper's own types do not expose one on get.
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          const stream = client.createReadStream(remotePath, {
            start, end: Math.max(start, size - 1),
          } as Parameters<typeof client.createReadStream>[1]);
          stream.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          stream.on('end', resolve);
          stream.on('error', reject);
        });

        return { text: Buffer.concat(chunks).toString('utf8'), at: size, rotated };
      });
    } catch {
      // Unreachable or gone. A log tail is never worth failing a poll over.
      return null;
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null;
    if (client) await client.end().catch(() => undefined);
  }
}
