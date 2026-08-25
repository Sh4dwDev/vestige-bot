/**
 * The shapes the website API sends.
 *
 * These interfaces are the contract between the bot and whatever front end
 * talks to it. They are deliberately plain JSON with no classes, no dates and
 * no undefined, so they can be copied into a React project as-is and stay
 * honest there.
 *
 * **Adding a field is safe. Renaming or removing one is not.** A front end is
 * deployed separately and will be running against an older idea of this file
 * for as long as somebody's tab stays open.
 *
 * Everything here is pure. The bot's own state is read in `web.ts` and passed
 * in, so the shaping can be tested without a database or a game server.
 */

/** Sent instead of a payload whenever a request cannot be answered. */
export interface ApiError {
  ok: false;
  /** Stable, machine-readable. Switch on this, not on `reason`. */
  code:
    | 'signed_out'
    | 'not_linked'
    | 'server_unreachable'
    | 'not_found'
    | 'bad_request'
    | 'rate_limited'
    | 'server_error';
  /** Written for a player to read. Safe to show verbatim. */
  reason: string;
}

export const apiError = (code: ApiError['code'], reason: string): ApiError =>
  ({ ok: false, code, reason });

/** One animal in storage. */
export interface VaultSlot {
  /** The player's own name for the slot, unique per player. */
  slot: string;
  species: string;
  /** 0 to 1. Anything stored is normally 1. */
  growth: number;
  female: boolean;
  /** Whether it met the prime conditions when it went in. */
  prime: boolean;
  elderStacks: number;
  mutations: string[];
}

export interface VaultResponse {
  ok: true;
  /** The mod enforces this; it is here so a front end can render slot counts. */
  maxSlots: number;
  slots: VaultSlot[];
  /**
   * When the underlying read happened, as epoch milliseconds.
   *
   * Slot reads are cached for a minute or so because each one is a slow round
   * trip to the game server. This says how stale the answer is, so a front end
   * can say "as of a minute ago" rather than implying it is live.
   */
  readAt: number;
}

export interface SkinRow {
  preset: string;
  /** ISO 8601, UTC. */
  grantedAt: string;
}

/** Everything about the signed-in player that comes out of the database. */
export interface MeResponse {
  ok: true;
  discordId: string;
  steamId: string;
  /** Their most recent name in game, or null if the bot has never seen them. */
  name: string | null;
  points: number;
  /** Total minutes played, as counted by the points tick. */
  minutes: number;
  kills: number;
  deaths: number;
  skins: SkinRow[];
}

/** Public, and the only endpoint that answers without a session. */
export interface StatusResponse {
  ok: true;
  serverName: string;
  /** Null when the bot cannot reach the game server right now. */
  online: number | null;
}

/**
 * Points are stored as a float because they accrue per minute. Every number a
 * player sees should be whole, and rounding in one place stops the site and the
 * bot disagreeing by a point.
 */
export const displayPoints = (balance: number): number => Math.floor(balance);

/**
 * Trims a slot read down to what the API promises.
 *
 * The mod's reply is broader and looser than this, and passing it through
 * whole would leak fields the contract does not cover and cannot keep.
 */
export function toVaultSlot(raw: {
  slot: string;
  species: string;
  growth: number;
  female: boolean;
  prime: boolean;
  elderStacks: number;
  mutations: string[];
}): VaultSlot {
  return {
    slot: raw.slot,
    species: raw.species,
    // The mod has been seen to report growth slightly over 1 on a fully grown
    // adult, which would render as 101%.
    growth: Math.max(0, Math.min(1, raw.growth)),
    female: raw.female === true,
    prime: raw.prime === true,
    elderStacks: Math.max(0, Math.floor(raw.elderStacks)),
    mutations: raw.mutations.filter((m) => typeof m === 'string' && m.length > 0),
  };
}

/**
 * Whether an `Origin` header may use a session cookie.
 *
 * Exact string match against the configured list, never a prefix or a suffix
 * test. `https://vestige.example.com.attacker.test` ends with the real origin
 * and is a different site.
 */
export function originAllowed(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) return false;
  return allowed.includes(origin);
}
