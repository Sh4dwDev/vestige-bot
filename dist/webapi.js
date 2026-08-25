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
export const apiError = (code, reason) => ({ ok: false, code, reason });
/**
 * Points are stored as a float because they accrue per minute. Every number a
 * player sees should be whole, and rounding in one place stops the site and the
 * bot disagreeing by a point.
 */
export const displayPoints = (balance) => Math.floor(balance);
/**
 * Trims a slot read down to what the API promises.
 *
 * The mod's reply is broader and looser than this, and passing it through
 * whole would leak fields the contract does not cover and cannot keep.
 */
export function toVaultSlot(raw) {
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
export function originAllowed(origin, allowed) {
    if (!origin)
        return false;
    return allowed.includes(origin);
}
//# sourceMappingURL=webapi.js.map