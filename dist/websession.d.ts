/**
 * Cookies and session tokens for the website.
 *
 * Everything here is pure apart from `newSecret`, so the security-critical
 * parts can be tested without a server: a forged token, an expired one and a
 * token signed with a different secret must all be rejected, and that is worth
 * proving rather than assuming.
 *
 * **The token carries a Discord ID and nothing else.** The Steam ID is looked
 * up from the `links` table on every request. A cookie that named the Steam ID
 * would be a cookie that could be edited to name somebody else's, and the whole
 * site is a view onto exactly that identifier.
 */
/** The session cookie. */
export declare const SESSION_COOKIE = "vestige_session";
/** Holds the OAuth `state` between the redirect out and the redirect back. */
export declare const STATE_COOKIE = "vestige_state";
/** Long enough not to be a nuisance, short enough that a stolen laptop expires. */
export declare const SESSION_TTL_MS: number;
/** The OAuth round trip is a few seconds; this is generous. */
export declare const STATE_TTL_MS: number;
export declare const newSecret: () => string;
/** A fresh, unguessable OAuth `state`. */
export declare const newState: () => string;
/**
 * Parses a `Cookie` header.
 *
 * Unknown, malformed and duplicate entries are all survivable: browsers send
 * whatever they are holding, and one bad cookie from another app on the same
 * host must not lock somebody out of the site.
 */
export declare function parseCookies(header: string | undefined): Record<string, string>;
export interface CookieOptions {
    maxAgeMs?: number;
    /** Off only when the site is served over plain HTTP, which means localhost. */
    secure: boolean;
    /**
     * `Lax` when the front end is served from this same origin, which is the
     * arrangement to prefer. `None` is what a React app on its own origin needs,
     * and browsers only accept it alongside `Secure`, so it forces HTTPS.
     */
    sameSite?: 'Lax' | 'None';
}
export declare function serializeCookie(name: string, value: string, options: CookieOptions): string;
export declare const clearCookie: (name: string, secure: boolean, sameSite?: "Lax" | "None") => string;
/**
 * `v1.<discordId>.<expiresAt>.<signature>`
 *
 * Stateless on purpose. A session table would have to be pruned, and the only
 * thing a session needs to say is which Discord account is holding it.
 */
export declare function signSession(discordId: string, expiresAt: number, secret: string): string;
/**
 * The Discord ID a token vouches for, or null.
 *
 * Null covers every failure deliberately: wrong shape, wrong signature, wrong
 * secret, and expired. The caller has nothing useful to do differently for any
 * of them, and telling them apart in a response would say more than it should.
 */
export declare function readSession(token: string | undefined, secret: string, now?: number): string | null;
/**
 * Where to send somebody after signing in.
 *
 * Only a path on this site is ever accepted. Taking the caller's word would
 * turn the login into an open redirect, which is how a phishing page borrows
 * somebody else's domain for the address bar.
 */
export declare function safeReturnPath(raw: string | null | undefined): string;
