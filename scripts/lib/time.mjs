// All calendar logic is in UTC.
export const FIRST_DAY = 1;
export const LAST_DAY = 24;
/** Hours after day D ends during which D can still be filled with news. */
export const GRACE_HOURS = 12;

export const dayStart = (year, day) => new Date(Date.UTC(year, 11, day));
export const dayEnd = (year, day) => new Date(Date.UTC(year, 11, day + 1));
export const dayCutoff = (year, day) =>
  new Date(dayEnd(year, day).getTime() + GRACE_HOURS * 3600_000);

export const pad2 = (n) => String(n).padStart(2, "0");
export const isoDate = (year, day) => `${year}-12-${pad2(day)}`;

/**
 * Phase of day D at instant `now`:
 *  - "locked": D hasn't started yet
 *  - "live":   D is running (only very notable incidents are frozen)
 *  - "grace":  D is over, but the cutoff hasn't passed (the best real incident is frozen)
 *  - "closed": the cutoff has passed (last news attempt, otherwise a joke)
 */
export function phase(year, day, now) {
  if (now < dayStart(year, day)) return "locked";
  if (now < dayEnd(year, day)) return "live";
  if (now < dayCutoff(year, day)) return "grace";
  return "closed";
}

export function isOnDay(date, year, day) {
  return date >= dayStart(year, day) && date < dayEnd(year, day);
}
