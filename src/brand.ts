/**
 * Every name and turn of phrase the players see.
 *
 * Kept in one place so a rename is one edit rather than a hunt through every
 * embed — and so the voice stays consistent, which is the whole point of having
 * one.
 */

export const BOT = 'Vesta';
export const SERVER = 'Vestige';
export const SUBTITLE = `Keeper of ${SERVER}`;

/** The archive is the metaphor for storage: things are kept there, not "saved". */
export const ARCHIVE = `the ${SERVER} archive`;

/** Same phrase, for the start of a sentence. */
export const ARCHIVE_CAP = `The ${SERVER} archive`;

/** The line a player gets when a dinosaur goes in. */
export const SECURED = `Your dinosaur has been secured in ${ARCHIVE}.`;

/** Shown under the panels, so the bot signs its own work. */
export const SIGNATURE = `${BOT} · ${SUBTITLE}`;
