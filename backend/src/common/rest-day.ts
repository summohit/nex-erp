import { isBranchWeeklyOff } from './weekly-offs';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The roster row for a person and day, where one exists. */
export interface RestDayRosterEntry {
  isDayOff: boolean;
  onsiteApprovalStatus?: string | null;
}

/**
 * Whether a calendar day is a rest day for one person: what payroll and
 * comp-off ask.
 *
 * 1. A roster row for the day decides: someone rostered Sat–Sun with Monday
 *    off works Sunday and rests Monday.
 * 2. Without one, the shift's working days decide, but only when the shift
 *    actually leaves a day out. Most shifts list all seven days, which says
 *    nothing about rest days, so those fall through.
 * 3. Otherwise the branch weekly offs (Sunday when unset).
 *
 * Deliberately separate from ShiftRosterService.resolveEffectiveShift, which
 * governs clocking in: there an all-week shift must keep allowing work every
 * day. Decided 15 Oct 2026, after payroll counted rostered Mondays off as
 * absences.
 */
export function isRestDay(
  date: Date,
  entry: RestDayRosterEntry | null | undefined,
  shiftWorkingDays: string | null | undefined,
  branchWeeklyOffs: string | null | undefined,
): boolean {
  // An unapproved on-site request is only a request; it decides nothing.
  if (entry && (entry.isDayOff || entry.onsiteApprovalStatus !== 'PENDING')) return entry.isDayOff;

  const days = (shiftWorkingDays ?? '').split(',').map((d) => d.trim()).filter(Boolean);
  if (days.length && days.length < 7) return !days.includes(DAY_NAMES[date.getUTCDay()]);

  return isBranchWeeklyOff(date, branchWeeklyOffs);
}
