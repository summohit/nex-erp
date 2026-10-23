import { BadRequestException } from '@nestjs/common';

/**
 * Subprojects: one level under a parent project. ABC holds ABC-A, ABC-B and
 * ABC-C; each is a full project whose code is always the parent's code, a
 * dash, and its own sub code. The rules that need no database live here.
 */

export const BUDGET_MODES = ['SEPARATE', 'SHARED'] as const;
export type BudgetMode = (typeof BUDGET_MODES)[number];

/**
 * The subproject's own part of the code: "A" in "ABC-A". Starts with a letter
 * so it can never be mistaken for a task number — the parent's tasks are
 * ABC-1, ABC-2, and a sub code of "1" would make ABC-1 ambiguous.
 */
export function normaliseSubCode(raw: unknown): string {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!code) throw new BadRequestException('Enter a sub code, such as A');
  if (!/^[A-Z][A-Z0-9]{0,9}$/.test(code)) {
    throw new BadRequestException('A sub code starts with a letter and uses only letters and numbers, up to 10 characters');
  }
  return code;
}

/** "ABC" + "A" → "ABC-A". */
export function subprojectKey(parentKey: string, subCode: string): string {
  return `${parentKey}-${subCode}`;
}

export function normaliseBudgetMode(raw: unknown): BudgetMode {
  const mode = String(raw ?? '').toUpperCase();
  if (!(BUDGET_MODES as readonly string[]).includes(mode)) {
    throw new BadRequestException('Budget mode must be SEPARATE or SHARED');
  }
  return mode as BudgetMode;
}

export interface BudgetFigures {
  /** Agreed budget including approved increases. */
  total: number;
  spent: number;
  loggedHours: number;
}

export interface SubprojectBudgetRow extends BudgetFigures {
  id: number;
  key: string;
  name: string;
}

/**
 * The parent's budget picture once its subprojects are counted.
 *
 * SHARED: the parent's budget is one pool; the parent and every subproject
 * spend from it, so total stays the parent's and spent is everyone's.
 * SEPARATE: each subproject has its own budget; the combined figure adds the
 * parent's own budget and spend to all of theirs.
 */
export function rollUpBudget(mode: BudgetMode, parent: BudgetFigures, children: BudgetFigures[]) {
  const spent = parent.spent + children.reduce((s, c) => s + c.spent, 0);
  const loggedHours = parent.loggedHours + children.reduce((s, c) => s + c.loggedHours, 0);
  const total = mode === 'SHARED'
    ? parent.total
    : parent.total + children.reduce((s, c) => s + c.total, 0);
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    mode,
    total: round(total),
    spent: round(spent),
    remaining: round(total - spent),
    loggedHours: round(loggedHours),
    percentUsed: total > 0 ? Math.round((spent / total) * 100) : null,
  };
}
