import net from 'node:net';

/**
 * Evrima's RCON is a bespoke binary protocol — not Valve/Source RCON, so
 * mcrcon and friends cannot talk to it.
 *
 *   auth     0x01 <password> 0x00
 *   command  0x02 <opcode> <args> 0x00
 *   response plain text, usually 0x00 terminated
 *
 * Arguments inside a command are COMMA separated, not space separated.
 *
 * Only what storage needs: who is online, and sending a player a message.
 */

const OPCODES = {
  announce: 0x10,
  directmessage: 0x11,
  getplayables: 0x14,
  playerlist: 0x40,
  save: 0x50,
} as const;

export type RconCommand = keyof typeof OPCODES;

export interface OnlinePlayer {
  steamId: string;
  name: string;
}

export interface RconOptions {
  host: string;
  port: number;
  password: string;
  timeoutMs?: number;
  idleMs?: number;
  onLog?: (message: string) => void;
}

export class EvrimaRcon {
  #socket: net.Socket | null = null;
  #connecting: Promise<void> | null = null;
  #pending: {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
    chunks: Buffer[];
    idle: NodeJS.Timeout | null;
    hard: NodeJS.Timeout;
  } | null = null;
  #queue: Array<() => void> = [];
  #busy = false;

  constructor(private readonly opts: RconOptions) {}

  get connected(): boolean {
    return this.#socket !== null && !this.#socket.destroyed;
  }

  #log(message: string): void {
    this.opts.onLog?.(message);
  }

  async #connect(): Promise<void> {
    if (this.connected) return;
    if (this.#connecting) return this.#connecting;

    this.#connecting = (async () => {
      const socket = await new Promise<net.Socket>((resolve, reject) => {
        const s = net.createConnection({ host: this.opts.host, port: this.opts.port });
        const timer = setTimeout(() => {
          s.destroy();
          reject(new Error(`RCON connect to ${this.opts.host}:${this.opts.port} timed out`));
        }, 6000);
        s.once('connect', () => { clearTimeout(timer); resolve(s); });
        s.once('error', (err) => { clearTimeout(timer); reject(err); });
      });

      socket.setKeepAlive(true, 15_000);
      socket.setNoDelay(true);
      socket.on('data', (chunk) => this.#onData(chunk));
      socket.on('error', (err) => this.#drop(err));
      socket.on('close', () => this.#drop(new Error('RCON socket closed')));
      this.#socket = socket;

      const reply = await this.#exchange(
        Buffer.concat([Buffer.from([0x01]), Buffer.from(this.opts.password, 'utf8'), Buffer.from([0x00])]),
        this.opts.timeoutMs ?? 8000,
      );

      // Wording has changed between builds, so accept anything that is not an
      // explicit rejection rather than matching one success string.
      if (/wrong|incorrect|invalid|denied|fail/i.test(reply)) {
        this.close();
        throw new Error(`RCON authentication rejected: ${reply.trim() || '(empty reply)'}`);
      }
      this.#log(`RCON connected to ${this.opts.host}:${this.opts.port}`);
    })().finally(() => { this.#connecting = null; });

    return this.#connecting;
  }

  #drop(err: Error): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket) { socket.removeAllListeners(); socket.destroy(); }

    const pending = this.#pending;
    if (pending) {
      this.#pending = null;
      if (pending.idle) clearTimeout(pending.idle);
      clearTimeout(pending.hard);
      pending.reject(err);
    }
  }

  #onData(chunk: Buffer): void {
    const pending = this.#pending;
    if (!pending) return; // unsolicited server chatter

    pending.chunks.push(chunk);
    if (chunk.includes(0x00)) { this.#settle(); return; }

    if (pending.idle) clearTimeout(pending.idle);
    pending.idle = setTimeout(() => this.#settle(), this.opts.idleMs ?? 350);
  }

  #settle(): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    if (pending.idle) clearTimeout(pending.idle);
    clearTimeout(pending.hard);
    pending.resolve(decodeResponse(Buffer.concat(pending.chunks)));
  }

  #exchange(payload: Buffer, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = this.#socket;
      if (!socket || socket.destroyed) { reject(new Error('RCON not connected')); return; }

      const hard = setTimeout(() => {
        const pending = this.#pending;
        if (!pending) return;
        this.#pending = null;
        if (pending.idle) clearTimeout(pending.idle);
        // Silence is normal for fire-and-forget opcodes such as announce, so
        // a timeout yields whatever arrived rather than throwing.
        pending.resolve(decodeResponse(Buffer.concat(pending.chunks)));
      }, timeoutMs);

      this.#pending = { resolve, reject, chunks: [], idle: null, hard };
      socket.write(payload, (err) => {
        if (!err) return;
        const pending = this.#pending;
        if (pending) {
          this.#pending = null;
          if (pending.idle) clearTimeout(pending.idle);
          clearTimeout(pending.hard);
        }
        reject(err);
      });
    });
  }

  /** The socket has no request IDs, so commands go one at a time. */
  async #locked<T>(fn: () => Promise<T>): Promise<T> {
    if (this.#busy) await new Promise<void>((resolve) => this.#queue.push(resolve));
    this.#busy = true;
    try {
      return await fn();
    } finally {
      const next = this.#queue.shift();
      if (next) next();
      else this.#busy = false;
    }
  }

  /** Reconnects and retries once: Evrima drops idle RCON sockets silently. */
  async send(command: RconCommand, args: string[] = []): Promise<string> {
    return this.#locked(async () => {
      const payload = Buffer.concat([
        Buffer.from([0x02, OPCODES[command]]),
        Buffer.from(args.join(','), 'utf8'),
        Buffer.from([0x00]),
      ]);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await this.#connect();
          return await this.#exchange(payload, this.opts.timeoutMs ?? 8000);
        } catch (err) {
          if (attempt === 1) throw err;
          this.#log(`RCON ${command} failed, reconnecting: ${(err as Error).message}`);
          this.close();
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      throw new Error('unreachable');
    });
  }

  async players(): Promise<OnlinePlayer[]> {
    return parsePlayerList(await this.send('playerlist'));
  }

  async directMessage(steamId: string, message: string): Promise<void> {
    await this.send('directmessage', [steamId, message]);
  }

  /** Server-wide notice. Renders as a transient banner, so keep it short. */
  async announce(message: string): Promise<void> {
    await this.send('announce', [message]);
  }

  /** Writes the world to disk. Always do this before a restart. */
  async save(): Promise<void> {
    await this.send('save', []);
  }

  /** Raw playable list, exactly as the server names them. */
  async playables(): Promise<string> {
    return this.send('getplayables', []);
  }

  close(): void {
    const socket = this.#socket;
    this.#socket = null;
    if (socket) { socket.removeAllListeners(); socket.destroy(); }
  }
}

export function decodeResponse(buffer: Buffer): string {
  let start = 0;
  while (start < buffer.length && buffer[start]! <= 0x03) start += 1;
  const end = buffer.indexOf(0x00, start);
  return buffer.subarray(start, end === -1 ? buffer.length : end).toString('utf8').replace(/\r/g, '').trim();
}

const STEAM_ID_GLOBAL = /7656119\d{10}/g;

/**
 * playerlist has shipped in several shapes across patches. Try each and fall
 * back to IDs only, which every caller can still work with.
 */
export function parsePlayerList(raw: string): OnlinePlayer[] {
  const text = raw.trim();
  if (!text) return [];

  const lines = text.split('\n').map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^playerlist$/i.test(l));

  // "Name, 76561198000000000" per line.
  const paired: OnlinePlayer[] = [];
  for (const line of lines) {
    const match = /^(.*?),\s*(7656119\d{10})\s*$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      paired.push({ name: match[1].trim(), steamId: match[2] });
    }
  }
  const total = (text.match(STEAM_ID_GLOBAL) ?? []).length;
  if (paired.length > 0 && paired.length === total) return paired;

  // A line of names, then a line of IDs.
  const idLine = lines.find((l) => /^7656119\d{10}/.test(l.split(',')[0]?.trim() ?? ''));
  const nameLine = lines.find((l) => l !== idLine && l.includes(','));
  if (idLine && nameLine) {
    const names = nameLine.split(',').map((s) => s.trim()).filter(Boolean);
    const ids = idLine.split(',').map((s) => s.trim()).filter((s) => /^7656119\d{10}$/.test(s));
    if (ids.length > 0 && ids.length === names.length) {
      return ids.map((steamId, i) => ({ steamId, name: names[i] ?? '' }));
    }
  }

  return [...new Set(text.match(STEAM_ID_GLOBAL) ?? [])].map((steamId) => ({ steamId, name: '' }));
}
