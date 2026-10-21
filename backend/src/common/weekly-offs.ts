/**
 * Branch weekly offs on the server, for the roster and the clock.
 *
 * `Branch.weeklyOffs` is a comma-separated list of `day` or `day:condition`,
 * day 0 (Sunday) to 6 (Saturday), condition `all`, `even` or `odd` — the last
 * two counting occurrences within the month, so "6:even" is the 2nd and 4th
 * Saturday off and the 1st, 3rd and 5th working. Same rule as payroll and the
 * attendance grid (frontend shared/utils/weekly-offs.ts).
 *
 * Attendance and roster dates are calendar days stored at UTC midnight, so the
 * weekday and day-of-month are read in UTC.
 */
export function isBranchWeeklyOff(date: Date, weeklyOffs?: string | null): boolean {
  const raw = (weeklyOffs ?? '').trim();
  const rules = raw ? raw.split(',').map((r) => r.trim()).filter(Boolean) : ['0'];
  const day = date.getUTCDay();
  const occurrence = Math.ceil(date.getUTCDate() / 7);

  for (const rule of rules) {
    const [dayPart, condition = 'all'] = rule.split(':');
    if (parseInt(dayPart, 10) !== day) continue;
    if (condition === 'all') return true;
    if (condition === 'even' && occurrence % 2 === 0) return true;
    if (condition === 'odd' && occurrence % 2 === 1) return true;
  }
  return false;
}

/**
 * The days-off rule that applies to one person (21 Oct 2026). Their own
 * weekly off, when set, replaces both the shift's working days and the branch
 * weekly off; otherwise those apply as before. Returns the values to hand to
 * isRestDay / resolveEffectiveShift unchanged, so every caller keeps its shape.
 */
export function personalDaysOff<S extends { workingDays?: string | null }>(emp: {
  weeklyOffs?: string | null;
  shift?: S | null;
  branch?: { weeklyOffs?: string | null } | null;
}): { shift: S | null; shiftWorkingDays: string | null; weeklyOffs: string | null } {
  const own = (emp?.weeklyOffs ?? '').trim();
  if (own) {
    return {
      shift: emp.shift ? ({ ...emp.shift, workingDays: null } as S) : null,
      shiftWorkingDays: null,
      weeklyOffs: own,
    };
  }
  return {
    shift: emp?.shift ?? null,
    shiftWorkingDays: emp?.shift?.workingDays ?? null,
    weeklyOffs: emp?.branch ? emp.branch.weeklyOffs ?? '' : null,
  };
}
