import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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
export const SESSION_COOKIE = 'vestige_session';
/** Holds the OAuth `state` between the redirect out and the redirect back. */
export const STATE_COOKIE = 'vestige_state';
/** Long enough not to be a nuisance, short enough that a stolen laptop expires. */
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** The OAuth round trip is a few seconds; this is generous. */
export const STATE_TTL_MS = 10 * 60 * 1000;
export const newSecret = () => randomBytes(32).toString('hex');
/** A fresh, unguessable OAuth `state`. */
export const newState = () => randomBytes(16).toString('base64url');
/**
 * Parses a `Cookie` header.
 *
 * Unknown, malformed and duplicate entries are all survivable: browsers send
 * whatever they are holding, and one bad cookie from another app on the same
 * host must not lock somebody out of the site.
 */
export function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(';')) {
        const at = part.indexOf('=');
        if (at < 1)
            continue;
        const name = part.slice(0, at).trim();
        if (!name)
            continue;
        try {
            out[name] = decodeURIComponent(part.slice(at + 1).trim());
        }
        catch {
            // A cookie we did not write, holding a stray percent sign.
        }
    }
    return out;
}
export function serializeCookie(name, value, options) {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        // Lax rather than Strict even in the same-origin case: the OAuth callback
        // is a cross-site navigation back from Discord, and Strict would drop the
        // state cookie on arrival.
        `SameSite=${options.sameSite ?? 'Lax'}`,
    ];
    // A SameSite=None cookie without Secure is rejected outright by every current
    // browser, so it is set here rather than left to the caller to remember.
    if (options.secure || options.sameSite === 'None')
        parts.push('Secure');
    if (options.maxAgeMs !== undefined) {
        parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAgeMs / 1000))}`);
    }
    return parts.join('; ');
}
export const clearCookie = (name, secure, sameSite) => serializeCookie(name, '', sameSite
    ? { maxAgeMs: 0, secure, sameSite }
    : { maxAgeMs: 0, secure });
const sign = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url');
/** Compares without leaking, through timing, how much of the tag matched. */
function sameSignature(a, b) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length)
        return false;
    return timingSafeEqual(left, right);
}
/**
 * `v1.<discordId>.<expiresAt>.<signature>`
 *
 * Stateless on purpose. A session table would have to be pruned, and the only
 * thing a session needs to say is which Discord account is holding it.
 */
export function signSession(discordId, expiresAt, secret) {
    const body = `v1.${discordId}.${expiresAt}`;
    return `${body}.${sign(body, secret)}`;
}
/**
 * The Discord ID a token vouches for, or null.
 *
 * Null covers every failure deliberately: wrong shape, wrong signature, wrong
 * secret, and expired. The caller has nothing useful to do differently for any
 * of them, and telling them apart in a response would say more than it should.
 */
export function readSession(token, secret, now = Date.now()) {
    if (!token)
        return null;
    const parts = token.split('.');
    if (parts.length !== 4)
        return null;
    const [version, discordId, expiresRaw, signature] = parts;
    if (version !== 'v1' || !discordId || !expiresRaw || !signature)
        return null;
    if (!/^\d{5,25}$/.test(discordId))
        return null;
    const expiresAt = Number.parseInt(expiresRaw, 10);
    if (!Number.isFinite(expiresAt) || expiresAt <= now)
        return null;
    if (!sameSignature(sign(`v1.${discordId}.${expiresRaw}`, secret), signature))
        return null;
    return discordId;
}
/**
 * Where to send somebody after signing in.
 *
 * Only a path on this site is ever accepted. Taking the caller's word would
 * turn the login into an open redirect, which is how a phishing page borrows
 * somebody else's domain for the address bar.
 */
export function safeReturnPath(raw) {
    if (!raw)
        return '/';
    // A leading double slash is a protocol-relative URL: "//evil.example" is off
    // site even though it looks like a path.
    if (!raw.startsWith('/') || raw.startsWith('//'))
        return '/';
    if (raw.includes('\\') || raw.includes('\n') || raw.includes('\r'))
        return '/';
    return raw;
}
//# sourceMappingURL=websession.js.map