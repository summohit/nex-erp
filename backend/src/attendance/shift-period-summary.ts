/**
 * §Att7: attendance grouped by shift, over a week or a month.
 *
 * The period maths lives here rather than in the service so it can be tested
 * without a database — the boundaries are the part that goes wrong, and they
 * go wrong silently: an off-by-one on the week start moves somebody's Monday
 * into the previous week and nobody notices until the totals are queried.
 */

export type ShiftPeriod = 'week' | 'month';

export interface PeriodRange {
  /** Inclusive, local midnight. */
  from: Date;
  /** Inclusive, local midnight — the last day IN the period, not the next one. */
  to: Date;
  label: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * The week or month containing `anchor`.
 *
 * Weeks run Monday to Sunday: the working week as this company rosters it, and
 * the same convention the shift roster grid already draws. A Sunday anchor
 * therefore belongs to the week that started six days earlier, which is the
 * case a naive `getDay()` subtraction gets wrong.
 */
export function resolvePeriod(period: ShiftPeriod, anchor: Date): PeriodRange {
  const base = new Date(anchor);
  base.setHours(0, 0, 0, 0);

  if (period === 'month') {
    const from = new Date(base.getFullYear(), base.getMonth(), 1);
    // Day 0 of the next month is the last day of this one — avoids having to
    // know which months have 30, 31 or 28 days, and gets February right in a
    // leap year without a special case.
    const to = new Date(base.getFullYear(), base.getMonth() + 1, 0);
    return { from, to, label: `${MONTHS[base.getMonth()]} ${base.getFullYear()}` };
  }

  // getDay() is 0 for Sunday. Monday-start means Sunday is 6 days into the
  // week, not 0 days before it.
  const dayOfWeek = base.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  const from = new Date(base);
  from.setDate(from.getDate() - daysSinceMonday);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);

  const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  return { from, to, label: `${fmt(from)} – ${fmt(to)} ${to.getFullYear()}` };
}

/** Every date in the range, inclusive, as yyyy-mm-dd. */
export function datesInRange(range: PeriodRange): string[] {
  const out: string[] = [];
  const cursor = new Date(range.from);
  while (cursor <= range.to) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, '0');
    const d = String(cursor.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
