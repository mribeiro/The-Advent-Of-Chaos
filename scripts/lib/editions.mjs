// Editions and box timing. All logic is in UTC.
//
// A yearly edition is Dec 1–24 of that year. Extra editions (such as the hidden trial run)
// are listed below. Box n of an edition covers the UTC day `start + (n-1)`.
export const DAY_MS = 86_400_000;
/** Hours after a box's day ends during which it can still be filled with news. */
export const GRACE_HOURS = 12;

/**
 * Extra editions. Hidden ones are not listed publicly. They are published only when the
 * env var named in `slugEnv` holds their secret URL slug.
 */
export const EXTRA_EDITIONS = [
  { id: "trial", start: "2026-11-18", boxes: 13, hidden: true, slugEnv: "TAOC_TRIAL_SLUG", title: "Trial run" },
];

export const yearEdition = (y) => ({ id: String(y), start: `${y}-12-01`, boxes: 24, hidden: false, title: String(y) });

/** Editions the updater looks after at instant `now`. */
export const editionsAt = (now) => [yearEdition(now.getUTCFullYear()), ...EXTRA_EDITIONS];

/** Data folder names: a year, or an extra edition id. */
export const EDITION_DIR_RE = /^(\d{4}|[a-z][a-z0-9-]*)$/;

const startMs = (ed) => Date.parse(`${ed.start}T00:00:00Z`);
export const boxStart = (ed, n) => new Date(startMs(ed) + (n - 1) * DAY_MS);
export const boxEnd = (ed, n) => boxStart(ed, n + 1);
export const boxCutoff = (ed, n) => new Date(boxEnd(ed, n).getTime() + GRACE_HOURS * 3600_000);
export const boxDate = (ed, n) => boxStart(ed, n).toISOString().slice(0, 10);
export const pad2 = (n) => String(n).padStart(2, "0");

/**
 * Phase of box n at instant `now`:
 *  - "locked": its day hasn't started yet
 *  - "live":   its day is running (only very notable incidents are frozen)
 *  - "grace":  its day is over, but the cutoff hasn't passed (the best real incident is frozen)
 *  - "closed": the cutoff has passed (last news attempt, otherwise a joke)
 */
export function phase(ed, n, now) {
  if (now < boxStart(ed, n)) return "locked";
  if (now < boxEnd(ed, n)) return "live";
  if (now < boxCutoff(ed, n)) return "grace";
  return "closed";
}

export const isOnBox = (date, ed, n) => date >= boxStart(ed, n) && date < boxEnd(ed, n);
