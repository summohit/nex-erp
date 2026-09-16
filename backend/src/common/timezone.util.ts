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
 * The IST calendar day containing `date`, as UTC midnight of that day.
 *
 * This feeds `Attendance.date`, which is a Postgres `date` column: Postgres
 * keeps only the UTC date part, so the value must be UTC midnight of the
 * intended day. Returning IST midnight as a UTC instant (i.e. subtracting the
 * offset) lands on 18:30 the *previous* day and gets truncated to that day —
 * which filed every clock-in one day early.
 */
export function istDateKey(date: Date): Date {
  const { year, month, day } = toISTFields(date);
  return new Date(Date.UTC(year, month, day));
}

/** The hour (0-23) on IST's clock for `date`, independent of the server's timezone. */
export function istHour(date: Date): number {
  return toISTFields(date).hours;
}

/** Minutes since IST midnight (0-1439) for `date`, server timezone irrelevant. */
export function istMinutesOfDay(date: Date): number {
  const { hours, minutes } = toISTFields(date);
  return hours * 60 + minutes;
}

/** `"HH:mm"` as minutes since midnight, or null if it is not a time. */
export function hhmmToMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * The IST calendar day `days` before or after the one containing `date`.
 *
 * Built from the date key rather than by subtracting 24 hours, so it stays a
 * clean UTC-midnight value of the kind `Attendance.date` requires.
 */
export function istDateKeyShift(date: Date, days: number): Date {
  const key = istDateKey(date);
  return new Date(key.getTime() + days * 86_400_000);
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
