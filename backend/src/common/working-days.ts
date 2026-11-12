import { personalDaysOff } from './weekly-offs';
import { isRestDay, RestDayRosterEntry } from './rest-day';

/**
 * Working days between two dates, inclusive, for one person.
 *
 * Weekly offs go through the same rule attendance and the roster use, so
 * "6:even" means only the 2nd and 4th Saturdays — not every Saturday, which
 * is how a leave on a working 1st Saturday came out as zero days. Days are
 * walked by calendar date in UTC, the way leave dates and holidays are
 * stored, so the server's own timezone cannot shift a day.
 *
 * Shared by leave approval (what a request costs) and comp-off history (what
 * the approved requests have actually consumed), so the two cannot disagree.
 */
export function countWorkingDays(
  start: Date,
  end: Date,
  employee: {
    weeklyOffs?: string | null;
    shift?: { workingDays?: string | null } | null;
    branch?: { weeklyOffs?: string | null } | null;
  },
  isHalfDay: boolean,
  roster: Map<string, RestDayRosterEntry>,
  holidayDates?: Set<string>,
): number {
  const dayOf = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const current = dayOf(start);
  const last = dayOf(end);

  // The person's own weekly off wins over shift and branch (21 Oct 2026).
  const own = personalDaysOff(employee as any);

  let count = 0;
  while (current <= last) {
    const dateStr = current.toISOString().split('T')[0];
    const rest = isRestDay(
      current,
      roster.get(dateStr),
      own.shiftWorkingDays,
      own.weeklyOffs || '0',
    );
    if (!rest && !(holidayDates && holidayDates.has(dateStr))) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return isHalfDay ? (count > 0 ? 0.5 : 0) : count;
}
