export interface Link {
    discordId: string;
    steamId: string;
}
export interface DutyRow {
    sessionId: string;
    discordUserId: string;
    steamId: string;
    staffRank: string;
    startedAtUtc: string;
    endedAtUtc: string | null;
    durationSeconds: number | null;
    startMethod: 'panel' | 'command' | 'override';
    endReason: string | null;
    status: 'active' | 'ended';
    actionCount: number;
    blockedCount: number;
    logChannelId: string | null;
    logMessageId: string | null;
}
export interface Listing {
    id: number;
    sellerSteam: string;
    slot: string;
    species: string;
    growth: number;
    female: boolean;
    prime: boolean;
    mutations: string[];
    price: number;
    status: 'open' | 'pending' | 'sold' | 'cancelled';
    buyerSteam: string | null;
    messageId: string | null;
    listedAt: string;
}
export interface Referral {
    inviteeDiscord: string;
    inviterDiscord: string;
    joinedAt: string;
    inviteeSteam: string | null;
    paidAt: string | null;
    reward: number;
}
export interface Pending {
    steamId: string;
    code: string;
    expiresAt: number;
    attempts: number;
}
export declare class Database {
    #private;
    /** Absolute path, and whether the file already existed. Logged at boot. */
    readonly file: string;
    readonly existed: boolean;
    constructor(file: string);
    /**
     * Boot diagnostics. A link count of zero on a server that had links is the
     * signature of the database being wiped, which otherwise looks exactly like
     * the bot "forgetting" people.
     */
    stats(): {
        links: number;
        pending: number;
    };
    /**
     * Remembers what each account is calling itself in game.
     *
     * Written on every poll, so a rename is picked up within a minute. The name
     * outlives the session on purpose: a death is reported for somebody who may
     * already be gone, and `\`4f2a1c\`` tells nobody anything.
     */
    rememberNames(players: Array<{
        steamId: string;
        name: string;
    }>): void;
    /**
     * When this account was first seen in game, or null when it predates the
     * column and has not been seen since.
     */
    firstSeen(steamId: string): string | null;
    /** Referrals that never got a Steam account attached, oldest first. */
    unattachedReferrals(): Array<{
        inviteeDiscord: string;
        inviterDiscord: string;
        joinedAt: string;
    }>;
    gameName(steamId: string): string | null;
    recordCount(online: number): void;
    /** The busiest single reading since a moment, and when it happened. */
    peakSince(since: Date): {
        online: number;
        at: string;
    } | null;
    /** Every reading since a moment, oldest first, for bucketing into a chart. */
    countsSince(since: Date): Array<{
        at: string;
        online: number;
    }>;
    /** Keeps the table from growing forever; nothing asks beyond a month. */
    pruneCounts(before: Date): number;
    /** First invite wins. Someone who leaves and rejoins keeps their original. */
    recordReferral(inviteeDiscord: string, inviterDiscord: string): void;
    referralFor(inviteeDiscord: string): Referral | null;
    /**
     * Ties a Steam account to a referral when the invitee links.
     *
     * Returns false when that Steam account has already been referred — the
     * unique index rejects it, which is the point: the account, not the Discord
     * user, is what a reward is owed against.
     */
    attachReferralSteam(inviteeDiscord: string, steamId: string): boolean;
    /** Linked, played, not yet paid — the queue the payout check walks. */
    pendingReferrals(): Referral[];
    markReferralPaid(inviteeDiscord: string, reward: number): void;
    /** How many this inviter has been paid for since a moment, for the cap. */
    paidReferralsSince(inviterDiscord: string, since: Date): number;
    referralLeaderboard(limit: number): Array<{
        inviterDiscord: string;
        count: number;
    }>;
    referralCounts(): {
        total: number;
        paid: number;
        pending: number;
    };
    /** Only ever written once per dinosaur: a second paint must not overwrite it. */
    setBaseline(steamId: string, species: string, colours: Record<string, string>, pattern?: number, theme?: number, variation?: number): boolean;
    baselineFor(steamId: string, species: string): {
        colours: Record<string, string>;
        pattern?: number;
        theme?: number;
        variation?: number;
    } | null;
    clearBaseline(steamId: string, species?: string): number;
    /**
     * Opens a session, or returns null when one is already open.
     *
     * The unique index does the deciding, not a read beforehand: two clicks in
     * the same instant would both pass a check-then-insert.
     */
    startDuty(row: {
        sessionId: string;
        discordUserId: string;
        steamId: string;
        staffRank: string;
        startedAtUtc: string;
        startMethod: string;
    }): DutyRow | null;
    dutySession(sessionId: string): DutyRow | null;
    activeDuty(discordUserId: string): DutyRow | null;
    allActiveDuty(): DutyRow[];
    dutyHistory(discordUserId: string, limit?: number): DutyRow[];
    /** Sessions opened on a given `YYYYMMDD`, for numbering the next one. */
    dutySessionsOnDay(day: string): DutyRow[];
    /**
     * Closes a session. Returns false when it was already closed, so a repeated
     * completion event cannot log twice or overwrite a recorded duration.
     */
    endDuty(sessionId: string, endedAtUtc: string, durationSeconds: number, reason: string): boolean;
    /** Where the start log was posted, so the completion can edit it in place. */
    setDutyLogMessage(sessionId: string, channelId: string, messageId: string): void;
    createListing(row: {
        sellerSteam: string;
        slot: string;
        species: string;
        growth: number;
        female: boolean;
        prime: boolean;
        mutations: string[];
        price: number;
    }): number;
    listing(id: number): Listing | null;
    openListings(limit?: number): Listing[];
    listingsBySeller(sellerSteam: string): Listing[];
    /**
     * Takes an open listing off the market for one buyer, or returns false.
     *
     * The claim and the check are one statement on purpose: two people pressing
     * Buy in the same second would otherwise both pass a read, both be charged,
     * and only one get a dinosaur.
     */
    claimListing(id: number, buyerSteam: string): boolean;
    /** Puts a claim back, for when the transfer fails and nobody was charged. */
    releaseListing(id: number): void;
    closeListing(id: number, status: 'sold' | 'cancelled'): void;
    /**
     * Forgets where every open listing was posted.
     *
     * Used when the listings channel changes: the old messages are in a channel
     * the bot no longer draws in, so keeping the ids would mean editing messages
     * nobody is looking at and never posting the real ones.
     */
    clearListingMessages(): number;
    setListingMessage(id: number, messageId: string): void;
    /** Returns false when they already had it, so a grant can say so honestly. */
    grantSkin(steamId: string, preset: string, source: string): boolean;
    revokeSkin(steamId: string, preset: string): boolean;
    ownsSkin(steamId: string, preset: string): boolean;
    ownedSkins(steamId: string): Array<{
        preset: string;
        grantedAt: string;
        source: string;
    }>;
    /** Everyone holding one, for staff to see who has what. */
    skinOwners(preset: string): string[];
    /** Only ever adds. A species missing from the live menu is hidden, not gone. */
    rememberSpecies(names: string[], origin?: 'seen' | 'named'): number;
    /** Every name, for validating what somebody typed. */
    knownSpecies(): string[];
    /**
     * Only the ones this server has actually offered.
     *
     * The list to add from. Adding a species the server never listed asks the
     * game for something it may not have, which is what the original guard was
     * protecting against - it was right, it just looked in the wrong place.
     */
    offeredSpecies(): string[];
    close(): void;
    linkFor(discordId: string): Link | null;
    linkBySteam(steamId: string): Link | null;
    saveLink(discordId: string, steamId: string): void;
    removeLink(discordId: string): void;
    setPending(discordId: string, steamId: string, code: string, ttlMs: number): void;
    pendingFor(discordId: string): Pending | null;
    /** Looks up a pending link by its code, for the in-game chat confirmation. */
    pendingByCode(code: string): (Pending & {
        discordId: string;
    }) | null;
    bumpAttempts(discordId: string): number;
    clearPending(discordId: string): void;
    gameAdmins(): string[];
    addGameAdmin(steamId: string, addedBy: string): void;
    removeGameAdmin(steamId: string): boolean;
    botAdmins(): string[];
    isBotAdmin(discordId: string): boolean;
    addBotAdmin(discordId: string, addedBy: string): void;
    removeBotAdmin(discordId: string): boolean;
    recordPurchase(purchase: {
        discordId: string;
        steamId: string;
        species: string;
        mutations: string[];
        price: number;
        slot: string;
    }): void;
    recentPurchases(limit: number): Array<{
        discordId: string;
        species: string;
        mutations: string;
        price: number;
        at: string;
    }>;
    /** Merges: setting one part must not wipe the others already applied. */
    setSkin(steamId: string, species: string, colours: Record<string, string>): void;
    skinFor(steamId: string, species: string): Record<string, string> | null;
    /** Species omitted clears every look they have. */
    clearSkin(steamId: string, species?: string): number;
    /**
     * Marks a look as still in use, because it was just repainted onto a live
     * dinosaur. Expiry counts from here rather than from when it was set, so a
     * dinosaur somebody is actually playing never expires under them.
     */
    touchSkin(steamId: string, species: string): void;
    /**
     * Forgets looks nobody has worn for a while.
     *
     * A skin belongs to a dinosaur, and a dinosaur that has not been seen for
     * hours is gone — logged off, or died somewhere the death poll missed.
     * Without this, a colour set once was reapplied to the next animal of that
     * species days later, which is what players actually notice and complain
     * about. Clearing on death alone is not enough, because a death is only
     * cleared when it is *detected*.
     */
    expireSkins(olderThanMs: number): number;
    /** Null when they have never been given one, so the game's own is left alone. */
    setPattern(steamId: string, species: string, pattern: number | null): void;
    patternFor(steamId: string, species: string): number | null;
    skinSpecies(steamId: string): string[];
    savePreset(name: string, look: {
        colours: Record<string, string>;
        pattern?: number;
    }, madeBy: string): void;
    /**
     * Tolerates the original shape, which was a bare map of field to hex with no
     * pattern — presets saved before patterns existed still load.
     */
    preset(name: string): {
        colours: Record<string, string>;
        pattern?: number;
    } | null;
    presetNames(): string[];
    removePreset(name: string): boolean;
    speciesCaps(): Array<{
        species: string;
        cap: number;
        locked: boolean;
    }>;
    setSpeciesCap(species: string, cap: number): void;
    /**
     * Case-insensitive on purpose.
     *
     * The table is keyed by name and SQLite compares keys case-sensitively, so a
     * mis-typed `tyrannosaurus` sits alongside `Tyrannosaurus` as its own row and
     * never matches a live count. Clearing is how that gets fixed, and refusing
     * because the case is wrong is how it stays stuck.
     */
    removeSpeciesCap(species: string): boolean;
    setSpeciesLocked(species: string, locked: boolean): void;
    founderCount(): number;
    founderSkin(discordId: string): string | null;
    /**
     * Takes a slot, or returns false because they are gone.
     *
     * Counting and inserting have to be one statement. Two people pressing the
     * last button together would both read 49, both pass a separate check, and
     * both claim — so the limit is enforced inside the INSERT itself.
     */
    claimFounder(discordId: string, skin: string, limit: number): boolean;
    /**
     * Newest first: the interesting question is usually who just claimed.
     *
     * Tie-broken on rowid, because two people pressing the button together land
     * in the same millisecond and `claimed_at` alone leaves their order to
     * whatever SQLite feels like — which is not an ordering anybody can explain.
     */
    founders(limit?: number): Array<{
        discordId: string;
        skin: string;
        claimedAt: number;
    }>;
    /** Staff correction only: a claim is meant to be permanent. */
    releaseFounder(discordId: string): boolean;
    /**
     * Every table this database has.
     *
     * Read from the schema rather than listed anywhere, because a hand-written
     * list is what a future feature forgets to update - and a backup missing one
     * table is only discovered on the day it is needed.
     */
    tableNames(): string[];
    dumpTable(table: string): Array<Record<string, unknown>>;
    /**
     * Empties a table and refills it from a snapshot. Returns rows written.
     *
     * Columns come from the rows themselves and are checked against the live
     * schema, so a snapshot taken before a column existed still restores what it
     * does have rather than failing outright.
     */
    replaceTable(table: string, rows: Array<Record<string, unknown>>): number;
    /** Milliseconds remaining, or 0 when the action is available. */
    cooldownLeft(steamId: string, action: string, windowMs: number): number;
    startCooldown(steamId: string, action: string): void;
    recordKill(killerSteam: string, victimSteam: string, species: string, cause: string): void;
    /** Attributed kills only — an empty killer is a death nobody gets credit for. */
    topKillers(limit: number): Array<{
        steamId: string;
        kills: number;
    }>;
    killStats(steamId: string): {
        kills: number;
        deaths: number;
    };
    /** Totals for the footer, so the attribution gap is visible rather than puzzling. */
    killTotals(): {
        total: number;
        attributed: number;
    };
    pointsFor(steamId: string): {
        balance: number;
        minutes: number;
    };
    /** Adds to a balance, creating the row if this is their first minute. */
    addPoints(steamId: string, amount: number, minutes?: number): void;
    /** Awards every online player in one transaction, so a crash cannot half-pay. */
    awardOnline(steamIds: string[], amount: number, minutes: number): void;
    /** Never goes below zero — a negative balance would be a bug with a shop attached. */
    setPoints(steamId: string, balance: number): void;
    /**
     * Where somebody stands on the points table, and how many are on it.
     *
     * Counted in SQL rather than by walking `topPoints`: the leaderboard is only
     * ever fetched a page at a time, and a profile that had to pull every row to
     * say "5th" would get slower as the server got busier.
     *
     * Ties share the better rank, which is what anybody reading it expects.
     */
    pointsRank(steamId: string): {
        rank: number;
        of: number;
    };
    topPoints(limit: number): Array<{
        steamId: string;
        balance: number;
        minutes: number;
    }>;
    /**
     * Single Game.ini keys the bot keeps at a chosen value. Stored under a
     * prefix so the reconciler can find them without a second table.
     */
    managedGameSettings(): Array<{
        key: string;
        value: string;
    }>;
    setManagedGameSetting(key: string, value: string): void;
    getSetting(key: string): string | null;
    setSetting(key: string, value: string): void;
}
