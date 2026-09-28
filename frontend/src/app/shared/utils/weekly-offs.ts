/**
 * Whose days off are whose.
 *
 * `Branch.weeklyOffs` is a comma-separated list of `day` or `day:condition`,
 * where day is 0 (Sunday) to 6 (Saturday) and condition is `all`, `even` or
 * `odd` — the last two meaning alternate occurrences within the month, so
 * "6:even" is every second Saturday.
 *
 * This mirrors `isWeeklyOff` in the payroll service deliberately. The attendance
 * grid used to hardcode Saturday and Sunday, which disagreed with payroll for
 * every branch in the database: with weeklyOffs of "0" — Sunday only — every
 * Saturday somebody failed to turn up was drawn as a day off rather than an
 * absence, and every Saturday they worked landed in the "present" tally without
 * ever entering the "working days" denominator. That is where totals like
 * "23/20" came from.
 */

/** An empty or missing rule means Sunday, matching the server's default. */
export function parseWeeklyOffs(weeklyOffs?: string | null): string[] {
  const raw = (weeklyOffs ?? '').trim();
  if (!raw) return ['0'];
  return raw.split(',').map((r) => r.trim()).filter(Boolean);
}

export function isWeeklyOff(date: Date, weeklyOffs?: string | null): boolean {
  const day = date.getDay();
  // Which occurrence of this weekday it is within the month: the 1st Saturday,
  // the 2nd, and so on. What `even` and `odd` are counting.
  const occurrence = Math.ceil(date.getDate() / 7);

  for (const rule of parseWeeklyOffs(weeklyOffs)) {
    const [dayPart, conditionPart] = rule.split(':');
    const ruleDay = parseInt(dayPart, 10);
    if (Number.isNaN(ruleDay) || day !== ruleDay) continue;

    const condition = conditionPart || 'all';
    if (condition === 'all') return true;
    if (condition === 'even' && occurrence % 2 === 0) return true;
    if (condition === 'odd' && occurrence % 2 === 1) return true;
  }
  return false;
}
