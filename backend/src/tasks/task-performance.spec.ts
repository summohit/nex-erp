import { rankTaskPerformers, MIN_COMPLETED_TO_RANK } from './task-performance';

const person = (over: Partial<Parameters<typeof rankTaskPerformers>[0][0]> = {}) => ({
  employeeId: 1, name: 'A', completed: 10, onTime: 9, withDueDate: 10, ...over,
});

describe('who qualifies at all', () => {
  /**
   * The guard that keeps the board believable: one task finished on time is
   * 100%, and would otherwise outrank somebody who delivered thirty at 95%.
   */
  it('ignores anybody below the minimum', () => {
    const out = rankTaskPerformers([
      person({ employeeId: 1, completed: MIN_COMPLETED_TO_RANK - 1, onTime: 4, withDueDate: 4 }),
    ]);
    expect(out).toEqual([]);
  });

  it('includes somebody exactly at the minimum', () => {
    const out = rankTaskPerformers([
      person({ employeeId: 1, completed: MIN_COMPLETED_TO_RANK, onTime: 5, withDueDate: 5 }),
    ]);
    expect(out).toHaveLength(1);
  });

  it('returns nothing when nobody has delivered enough', () => {
    expect(rankTaskPerformers([person({ completed: 1, onTime: 1, withDueDate: 1 })])).toEqual([]);
  });
});

describe('what the blend rewards', () => {
  it('puts reliable delivery above raw volume', () => {
    const out = rankTaskPerformers([
      person({ employeeId: 1, name: 'Reliable', completed: 18, onTime: 18, withDueDate: 18 }),
      person({ employeeId: 2, name: 'Prolific', completed: 20, onTime: 8, withDueDate: 20 }),
    ]);
    expect(out[0].name).toBe('Reliable');
  });

  it('still rewards volume when reliability matches', () => {
    const out = rankTaskPerformers([
      person({ employeeId: 1, name: 'Fewer', completed: 6, onTime: 6, withDueDate: 6 }),
      person({ employeeId: 2, name: 'More', completed: 20, onTime: 20, withDueDate: 20 }),
    ]);
    expect(out[0].name).toBe('More');
  });

  /**
   * Somebody whose tasks never carry a due date cannot be measured for
   * timeliness, so they are scored on throughput alone rather than handed a
   * free 100% — which would make "set no dates" the winning strategy.
   */
  it('does not reward having no due dates', () => {
    const out = rankTaskPerformers([
      person({ employeeId: 1, name: 'Undated', completed: 20, onTime: 0, withDueDate: 0 }),
      person({ employeeId: 2, name: 'Dated', completed: 20, onTime: 18, withDueDate: 20 }),
    ]);
    expect(out[0].name).toBe('Dated');
    expect(out.find((p) => p.name === 'Undated')!.onTimeRate).toBe(0);
  });
});

describe('the shape of the answer', () => {
  it('returns at most the limit, best first', () => {
    const out = rankTaskPerformers([
      person({ employeeId: 1, name: 'A', completed: 10, onTime: 5, withDueDate: 10 }),
      person({ employeeId: 2, name: 'B', completed: 10, onTime: 10, withDueDate: 10 }),
      person({ employeeId: 3, name: 'C', completed: 10, onTime: 8, withDueDate: 10 }),
      person({ employeeId: 4, name: 'D', completed: 10, onTime: 7, withDueDate: 10 }),
    ], 3);
    expect(out.map((p) => p.name)).toEqual(['B', 'C', 'D']);
  });

  it('breaks an exact tie stably rather than shuffling', () => {
    const rows = [
      person({ employeeId: 7, name: 'Later' }),
      person({ employeeId: 2, name: 'Earlier' }),
    ];
    expect(rankTaskPerformers(rows)[0].name).toBe('Earlier');
    expect(rankTaskPerformers([...rows].reverse())[0].name).toBe('Earlier');
  });

  it('scores a perfect month at 100', () => {
    const out = rankTaskPerformers([person({ completed: 10, onTime: 10, withDueDate: 10 })]);
    expect(out[0].score).toBe(100);
  });
});
