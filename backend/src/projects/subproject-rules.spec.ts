import { normaliseSubCode, subprojectKey, rollUpBudget, normaliseBudgetMode } from './subproject-rules';

describe('subproject rules', () => {
  it('builds the code from the parent', () => {
    expect(subprojectKey('ABC', normaliseSubCode(' a '))).toBe('ABC-A');
    expect(subprojectKey('CES/1026/02', normaliseSubCode('north1'))).toBe('CES/1026/02-NORTH1');
  });

  it('refuses a sub code that could be read as a task number', () => {
    expect(() => normaliseSubCode('1')).toThrow(/starts with a letter/);
    expect(() => normaliseSubCode('A-B')).toThrow();
    expect(() => normaliseSubCode('')).toThrow(/Enter a sub code/);
  });

  it('accepts only the two budget modes', () => {
    expect(normaliseBudgetMode('shared')).toBe('SHARED');
    expect(() => normaliseBudgetMode('POOL')).toThrow();
  });

  const parent = { total: 100000, spent: 20000, loggedHours: 40 };
  const children = [
    { total: 50000, spent: 10000, loggedHours: 20 },
    { total: 0, spent: 5000, loggedHours: 10 },
  ];

  it('shared: one pool, everyone spends from it', () => {
    expect(rollUpBudget('SHARED', parent, children)).toEqual({
      mode: 'SHARED', total: 100000, spent: 35000, remaining: 65000, loggedHours: 70, percentUsed: 35,
    });
  });

  it('separate: budgets and spend both add up', () => {
    expect(rollUpBudget('SEPARATE', parent, children)).toEqual({
      mode: 'SEPARATE', total: 150000, spent: 35000, remaining: 115000, loggedHours: 70, percentUsed: 23,
    });
  });
});
