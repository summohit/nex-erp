import {
  canViewProjectFinancials,
  applyFinancialVisibility,
  applyFinancialVisibilityAll,
} from './project-visibility';

const project = (over: Partial<any> = {}) => ({
  id: 1,
  name: 'Gurgaon rollout',
  leadId: 50,
  members: [
    { employeeId: 60, role: 'PROJECT_MANAGER' },
    { employeeId: 70, role: 'MEMBER' },
  ],
  budgetAmount: 1000000,
  budgetUsed: 650000,
  budgetRemaining: 350000,
  currency: 'INR',
  estimatedHours: 2000,
  loggedHours: 1450,
  ...over,
});

describe('canViewProjectFinancials', () => {
  it.each(['SUPERADMIN', 'ADMIN', 'FINANCE'])('lets %s see any project', (role) => {
    expect(canViewProjectFinancials({ role, employeeId: 999 }, project())).toBe(true);
  });

  it('lets the project manager see their own project', () => {
    expect(canViewProjectFinancials({ role: 'EMPLOYEE', employeeId: 60 }, project())).toBe(true);
  });

  it('lets the project lead see their own project', () => {
    expect(canViewProjectFinancials({ role: 'EMPLOYEE', employeeId: 50 }, project())).toBe(true);
  });

  // Rule 1. The case the module exists to prevent.
  it('does not let an ordinary member see the budget', () => {
    expect(canViewProjectFinancials({ role: 'EMPLOYEE', employeeId: 70 }, project())).toBe(false);
  });

  it('does not let a manager of one project see another', () => {
    const other = project({ leadId: 51, members: [{ employeeId: 80, role: 'PROJECT_MANAGER' }] });
    expect(canViewProjectFinancials({ role: 'EMPLOYEE', employeeId: 60 }, other)).toBe(false);
  });

  it('refuses a viewer with no employee record', () => {
    expect(canViewProjectFinancials({ role: 'EMPLOYEE', employeeId: null }, project())).toBe(false);
  });

  // A PM membership on a project is not a claim about the viewer generally:
  // an employeeId that matches nothing must not fall through to allowed.
  it('refuses a viewer who is on the project under no role at all', () => {
    expect(canViewProjectFinancials({ role: 'EMPLOYEE', employeeId: 4242 }, project())).toBe(false);
  });
});

describe('applyFinancialVisibility', () => {
  it('strips every commercial field for an ordinary employee', () => {
    const result = applyFinancialVisibility(project(), { role: 'EMPLOYEE', employeeId: 70 });

    expect(result.canViewFinancials).toBe(false);
    for (const field of ['budgetAmount', 'budgetUsed', 'budgetRemaining', 'currency']) {
      expect(result).not.toHaveProperty(field);
    }
  });

  // Hours are work, not money: the estimated-vs-actual picture is the whole
  // point of the module and every role needs it.
  it('leaves hours and identity alone', () => {
    const result = applyFinancialVisibility(project(), { role: 'EMPLOYEE', employeeId: 70 });

    expect(result.estimatedHours).toBe(2000);
    expect(result.loggedHours).toBe(1450);
    expect(result.name).toBe('Gurgaon rollout');
  });

  it('keeps everything for finance and flags it', () => {
    const result = applyFinancialVisibility(project(), { role: 'FINANCE', employeeId: null });

    expect(result.canViewFinancials).toBe(true);
    expect(result.budgetAmount).toBe(1000000);
  });

  it('does not mutate the row it was given', () => {
    const row = project();
    applyFinancialVisibility(row, { role: 'EMPLOYEE', employeeId: 70 });
    expect(row.budgetAmount).toBe(1000000);
  });
});

describe('applyFinancialVisibilityAll', () => {
  // A project manager's access is per project, so one list can legitimately
  // carry both answers — which is why the flag is stamped per row.
  it('decides each project separately for a project manager', () => {
    const mine = project({ id: 1 });
    const theirs = project({ id: 2, leadId: 51, members: [{ employeeId: 80, role: 'PROJECT_MANAGER' }] });

    const [a, b] = applyFinancialVisibilityAll([mine, theirs], { role: 'EMPLOYEE', employeeId: 60 });

    expect(a.canViewFinancials).toBe(true);
    expect(a.budgetAmount).toBe(1000000);
    expect(b.canViewFinancials).toBe(false);
    expect(b).not.toHaveProperty('budgetAmount');
  });
});
