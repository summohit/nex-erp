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

/**
 * Turns a date/time entered in an India-only form into the corresponding UTC
 * instant. `datetime-local` deliberately has no zone, so `new Date(value)`
 * would otherwise depend on the server's configured timezone.
 *
 * Values which already carry an offset are retained as explicit instants for
 * backwards-compatible API callers; values without one are always IST.
 */
export function parseIstDateTime(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const explicit = new Date(text);
    return Number.isNaN(explicit.getTime()) ? null : explicit;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '0', milliseconds = '0'] = match;
  const utcWallClock = new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute),
    Number(second), Number(milliseconds.padEnd(3, '0')),
  ));
  // Reject values JavaScript would otherwise roll into the following month.
  if (
    utcWallClock.getUTCFullYear() !== Number(year)
    || utcWallClock.getUTCMonth() !== Number(month) - 1
    || utcWallClock.getUTCDate() !== Number(day)
    || utcWallClock.getUTCHours() !== Number(hour)
    || utcWallClock.getUTCMinutes() !== Number(minute)
    || utcWallClock.getUTCSeconds() !== Number(second)
  ) return null;

  return new Date(utcWallClock.getTime() - IST_OFFSET_MS);
}
