import { ProjectsService } from './projects.service';

/**
 * §22: approved time is what project cost is measured from — "where
 * applicable", which is the company setting.
 *
 * The rollup is one raw query, so what these pin down is the predicate it
 * builds. That is the whole of the rule: which rows the SUM is allowed to see.
 * Getting it wrong is silent — the number still renders, it is just not the
 * number anybody agreed to.
 */
function makeService(timesheetApprovalRequired: boolean) {
  const captured: string[] = [];

  const prisma: any = {
    systemSetting: {
      findUnique: jest.fn().mockResolvedValue({ timesheetApprovalRequired }),
    },
    // Prisma hands a raw query in as a template-strings array plus values; the
    // joined text is the SQL that will run.
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: any[]) => {
      captured.push(
        strings.raw
          .map((s, i) => s + (values[i]?.strings ? values[i].strings.join('') : ''))
          .join(''),
      );
      return Promise.resolve([]);
    }),
  };

  const service = new ProjectsService(prisma, {} as any);
  return { service, prisma, sql: () => captured.join('\n') };
}

/** getCostRollupByProject is private; the rule is what matters, not the access. */
const rollup = (service: ProjectsService, ids = [1, 2]) =>
  (service as any).getCostRollupByProject(ids, 1);

describe('which hours reach project cost', () => {
  it('reads the company setting rather than assuming', async () => {
    const { service, prisma } = makeService(false);
    await rollup(service);
    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 1 } }),
    );
  });

  /**
   * Off by default, and the default has to keep counting unapproved time.
   * Every hour logged before approvals existed has no TimesheetDay row; if a
   * missing row read as refused, project cost across the entire history would
   * drop to zero the moment this shipped.
   */
  it('counts days nobody has judged when approval is not required', async () => {
    const { service, sql } = makeService(false);
    await rollup(service);

    expect(sql()).toContain('IS NULL');
    expect(sql()).toContain("<> 'REJECTED'");
    expect(sql()).not.toContain("= 'APPROVED'");
  });

  // Rejection is the one judgement that excludes. Before this, rejecting a day
  // changed a status and nothing else — the hours were costed regardless.
  it('excludes rejected days even when approval is not required', async () => {
    const { service, sql } = makeService(false);
    await rollup(service);
    expect(sql()).toMatch(/<>\s*'REJECTED'/);
  });

  it('counts only approved days once the setting is on', async () => {
    const { service, sql } = makeService(true);
    await rollup(service);

    expect(sql()).toContain("= 'APPROVED'");
    expect(sql()).not.toContain("<> 'REJECTED'");
  });

  // LEFT, not INNER: an inner join would drop every unjudged day silently,
  // which is the same catastrophe as treating a missing row as a rejection.
  it('joins the timesheet day loosely, so an unjudged day survives the join', async () => {
    const { service, sql } = makeService(false);
    await rollup(service);
    expect(sql()).toMatch(/LEFT JOIN\s+"TimesheetDay"/);
  });

  it('asks nothing of the database when there are no projects', async () => {
    const { service, prisma } = makeService(false);
    const out = await rollup(service, []);
    expect(out.size).toBe(0);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });
});
