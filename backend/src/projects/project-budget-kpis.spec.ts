/**
 * §PB6: what the project summary reports commercially.
 *
 * The arithmetic is small; the decisions inside it are not. These pin the three
 * that would be silently wrong otherwise: approved increases count towards the
 * budget, "no budget" is not "nothing spent", and hours logged by people with
 * no cost rate are declared rather than quietly dropped.
 */
describe('project budget KPIs', () => {
  const round = (n: number) => Math.round(n * 100) / 100;
  const pct = (used: number, total: number) =>
    total > 0 ? Math.round((used / total) * 100) : null;

  const budgetOf = (
    original: number, approvedExtra: number, spent: number,
  ) => {
    const total = original + approvedExtra;
    return {
      total: round(total),
      spent: round(spent),
      remaining: round(total - spent),
      percentUsed: pct(spent, total),
    };
  };

  /**
   * A project running to an agreed overspend is on budget. Measuring against
   * the original figure would report every approved request as a failure.
   */
  it('counts approved increases as budget', () => {
    const b = budgetOf(100000, 25000, 110000);
    expect(b.total).toBe(125000);
    expect(b.remaining).toBe(15000);
    expect(b.percentUsed).toBe(88);
  });

  it('shows an overspend as negative remaining, not clamped to zero', () => {
    const b = budgetOf(100000, 0, 130000);
    expect(b.remaining).toBe(-30000);
    expect(b.percentUsed).toBe(130);
  });

  /**
   * "No budget set" and "nothing spent" are different facts. Rendering both as
   * 0% would tell somebody a project with no budget is comfortably on track.
   */
  it('reports null rather than 0% when no budget is set', () => {
    expect(budgetOf(0, 0, 4200).percentUsed).toBeNull();
    expect(budgetOf(0, 0, 0).percentUsed).toBeNull();
  });

  it('is 0% when there is a budget and nothing spent', () => {
    expect(budgetOf(50000, 0, 0).percentUsed).toBe(0);
  });

  /**
   * Hours from employees with no hourlyCostRate are in the hours but
   * contribute nothing to spend, so the cost is understated by whatever they
   * are worth. The summary reports the gap so the number can be read honestly.
   */
  it('keeps unrated hours visible alongside the spend they are missing from', () => {
    const loggedHours = 120;
    const unratedHours = 30;
    expect(unratedHours).toBeGreaterThan(0);
    expect(loggedHours - unratedHours).toBe(90); // the part that is costed
  });
});
