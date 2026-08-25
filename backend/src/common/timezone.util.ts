/**
 * Fixed India Standard Time math — deliberately independent of the server's
 * OS/process timezone (`Date.getHours`, `Date.setHours`, `new Date(Date.UTC(...))`
 * with local getters all follow whatever timezone the machine happens to be
 * configured with). India has no DST, so a constant UTC+5:30 offset is exact
 * forever, and using it directly means attendance timing stays correct no
 * matter where this backend is hosted or how its OS clock is configured.
 */
const IST_OFFSET_MINUTES = 330; // UTC+5:30
const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** The real UTC instant `date` represents, viewed through IST's calendar/clock fields. */
function toISTFields(date: Date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/**
 * Midnight IST on the IST calendar day containing `date`, returned as the
 * real UTC instant that represents. Use this for "which day does this
 * attendance record belong to" bucketing instead of local Date getters.
 */
export function istDateKey(date: Date): Date {
  const { year, month, day } = toISTFields(date);
  return new Date(Date.UTC(year, month, day) - IST_OFFSET_MS);
}

/**
 * The real UTC instant corresponding to `"HH:mm"` IST on the same IST
 * calendar day as `reference`. Use this to build a shift's expected
 * start/end instant instead of `new Date(now).setHours(...)`, which
 * interprets the hour as the server's local time, not IST.
 */
export function istTimeInstant(reference: Date, hhmm: string): Date {
  const [hh, mm] = hhmm.split(':').map((n) => parseInt(n, 10));
  const { year, month, day } = toISTFields(reference);
  return new Date(Date.UTC(year, month, day, hh, mm, 0, 0) - IST_OFFSET_MS);
}
