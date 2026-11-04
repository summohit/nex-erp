/**
 * Probation policy (decided 4 Nov 2026). Set by HR / Super Admin in Settings;
 * these are the defaults until somebody saves their own.
 */
export interface ProbationPolicy {
  /** Months of probation by employment category (PERMANENT, TRAINEE, CONTRACT). 0 = no probation. */
  monthsByCategory: Record<string, number>;
  /** Used for a category not listed above. */
  defaultMonths: number;
  /** How many times probation may be extended, and by how many months at most each time. */
  maxExtensions: number;
  maxExtensionMonths: number;
  /** Days before the end date when HR and the manager are reminded. */
  reminderDays: number[];
  /** Leave credited on confirmation for the rest of the year: DOWN = always round down to the half day. */
  proRataRounding: 'DOWN' | 'NEAREST';
}

export const DEFAULT_PROBATION_POLICY: ProbationPolicy = {
  monthsByCategory: { PERMANENT: 6, TRAINEE: 6, CONTRACT: 0 },
  defaultMonths: 6,
  maxExtensions: 2,
  maxExtensionMonths: 3,
  reminderDays: [30, 7],
  proRataRounding: 'DOWN',
};

/** A saved policy merged over the defaults, with bad values thrown out. */
export function normalisePolicy(raw: any): ProbationPolicy {
  const p = { ...DEFAULT_PROBATION_POLICY, ...(raw && typeof raw === 'object' ? raw : {}) };
  const months = (n: any, d: number) => (Number.isInteger(Number(n)) && Number(n) >= 0 && Number(n) <= 24 ? Number(n) : d);
  const byCat: Record<string, number> = { ...DEFAULT_PROBATION_POLICY.monthsByCategory };
  for (const [k, v] of Object.entries(p.monthsByCategory || {})) byCat[String(k).toUpperCase()] = months(v, byCat[String(k).toUpperCase()] ?? 6);
  return {
    monthsByCategory: byCat,
    defaultMonths: months(p.defaultMonths, 6),
    maxExtensions: months(p.maxExtensions, 2),
    maxExtensionMonths: Math.max(1, months(p.maxExtensionMonths, 3)),
    reminderDays: (Array.isArray(p.reminderDays) ? p.reminderDays : [30, 7])
      .map(Number).filter((n: number) => Number.isInteger(n) && n > 0 && n <= 90).sort((a: number, b: number) => b - a),
    proRataRounding: p.proRataRounding === 'NEAREST' ? 'NEAREST' : 'DOWN',
  };
}

export function probationMonthsFor(policy: ProbationPolicy, category?: string | null): number {
  const c = String(category || '').toUpperCase();
  return c in policy.monthsByCategory ? policy.monthsByCategory[c] : policy.defaultMonths;
}

/** Joining + N months, the day before the same date (23 Mar + 6 months → 22 Sep). */
export function probationEndFrom(joining: Date, months: number): Date {
  return new Date(Date.UTC(joining.getUTCFullYear(), joining.getUTCMonth() + months, joining.getUTCDate() - 1));
}

/**
 * Leave for the rest of the year from a confirmation date: yearly days ×
 * months left ÷ 12 (months counted to the day), rounded to the half day.
 */
export function proRataDays(yearlyDays: number, confirmedOn: Date, rounding: 'DOWN' | 'NEAREST' = 'DOWN'): number {
  const y = confirmedOn.getUTCFullYear();
  const yearEnd = Date.UTC(y, 11, 31);
  const daysLeft = Math.max(0, Math.round((yearEnd - Date.UTC(y, confirmedOn.getUTCMonth(), confirmedOn.getUTCDate())) / 86400000) + 1);
  const daysInYear = (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) / 86400000;
  const exact = (yearlyDays * daysLeft) / daysInYear;
  const halves = rounding === 'DOWN' ? Math.floor(exact * 2 + 1e-9) : Math.round(exact * 2);
  return Math.min(yearlyDays, halves / 2);
}

/** On probation today: has an end date, not confirmed. */
export function isOnProbation(e: { probationEndDate?: Date | null; probationConfirmedAt?: Date | null }): boolean {
  return !!e.probationEndDate && !e.probationConfirmedAt;
}
