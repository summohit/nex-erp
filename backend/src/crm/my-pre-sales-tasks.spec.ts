import { CrmService } from './crm.service';

/**
 * Pre-sales tasks as they appear in one person's task list.
 *
 * The reason this has its own spec is the masking rule. A pre-sales member is
 * deliberately not shown a deal's commercial figures — maskLeadsForPreSales
 * strips them on the way out of this service. But masking is subtractive: it
 * removes fields from a lead that was already fully loaded. The My Tasks feed
 * solves the same problem the other way round, by never selecting those columns
 * at all, and the test below is what keeps it that way. A future
 * `include: { lead: true }` here would reintroduce the leak silently.
 */
describe('CrmService.getMyPreSalesTasks', () => {
  const COMPANY = 1;
  const ME = 42;

  let prisma: any;
  let service: CrmService;
  let rows: any[];

  const task = (o: Partial<any> = {}) => ({
    id: 5,
    title: 'Prepare the demo',
    taskType: 'Demo',
    status: 'NEW',
    scheduledAt: new Date('2026-10-02T09:00:00Z'),
    estimatedMinutes: 90,
    lead: { id: 77, companyName: 'Acme Ltd', contactName: 'Jo' },
    assignedTo: { id: ME, firstName: 'Ada', lastName: 'L', avatarUrl: null },
    ...o,
  });

  beforeEach(() => {
    rows = [task()];
    prisma = { preSalesTask: { findMany: jest.fn(async () => rows) } };
    // Only prisma is exercised by this method; the rest are constructor ballast.
    service = new CrmService(prisma as any, {} as any, {} as any);
  });

  // The test that matters. If the select ever widens, this fails.
  it('never selects a commercial field from the lead', async () => {
    await service.getMyPreSalesTasks(COMPANY, ME);
    const select = prisma.preSalesTask.findMany.mock.calls[0][0].select;

    expect(select.lead.select).toEqual({
      id: true,
      title: true,
      leadCode: true,
      companyName: true,
      contactName: true,
      flow: true,
    });
    for (const forbidden of ['value', 'currency', 'expectedClosure', 'budget', 'dealValue']) {
      expect(select.lead.select[forbidden]).toBeUndefined();
    }
    // A blanket include would defeat the whole approach.
    expect(select.lead.include).toBeUndefined();
  });

  it('returns nothing resembling deal money in the payload', async () => {
    const out = await service.getMyPreSalesTasks(COMPANY, ME);
    const json = JSON.stringify(out);
    for (const forbidden of ['value', 'currency', 'expectedClosure', 'budget']) {
      expect(json).not.toContain(`"${forbidden}"`);
    }
  });

  it('only ever returns this person’s own tasks', async () => {
    await service.getMyPreSalesTasks(COMPANY, ME);
    expect(prisma.preSalesTask.findMany.mock.calls[0][0].where).toMatchObject({
      companyId: COMPANY,
      assignedToId: ME,
    });
  });

  // An administrator with nothing assigned to them was shown an empty list
  // while the company had open work everywhere. `everyone` is that view.
  it('drops the ownership filter for the company-wide view', async () => {
    await service.getMyPreSalesTasks(COMPANY, ME, { everyone: true });
    const where = prisma.preSalesTask.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe(COMPANY);
    expect(where.assignedToId).toBeUndefined();
  });

  describe('the flags the row’s buttons read', () => {
    const CREATOR = 7;
    const SOMEONE_ELSE = 99;
    const withOwners = () => [task({ assignedToId: ME, assignedById: CREATOR })];

    it('lets the assignee move the status but not edit or delete', async () => {
      rows = withOwners();
      const [out] = await service.getMyPreSalesTasks(COMPANY, ME);
      expect(out.preSales.canChangeStatus).toBe(true);
      expect(out.preSales.canManage).toBe(false);
    });

    it('lets whoever raised it do both', async () => {
      rows = withOwners();
      const [out] = await service.getMyPreSalesTasks(COMPANY, CREATOR, { everyone: true });
      expect(out.preSales.canChangeStatus).toBe(true);
      expect(out.preSales.canManage).toBe(true);
    });

    it('lets an administrator do both on a task that is neither theirs', async () => {
      rows = withOwners();
      const [out] = await service.getMyPreSalesTasks(COMPANY, SOMEONE_ELSE, { everyone: true, isAdmin: true });
      expect(out.preSales.canChangeStatus).toBe(true);
      expect(out.preSales.canManage).toBe(true);
    });

    it('gives a bystander neither', async () => {
      rows = withOwners();
      const [out] = await service.getMyPreSalesTasks(COMPANY, SOMEONE_ELSE, { everyone: true });
      expect(out.preSales.canChangeStatus).toBe(false);
      expect(out.preSales.canManage).toBe(false);
    });

    // The edit form reopens from the row alone, so the raw values have to be
    // on it — estimatedHours is lossy for anything that is not a whole hour.
    it('carries the raw schedule and duration for the edit form', async () => {
      rows = withOwners();
      const [out] = await service.getMyPreSalesTasks(COMPANY, ME);
      expect(out.preSales.leadId).toBe(77);
      expect(out.preSales.estimatedMinutes).toBe(90);
      expect(out.preSales.scheduledAt).toEqual(new Date('2026-10-02T09:00:00Z'));
    });
  });

  it('maps the pre-sales ladder onto the shared one, keeping the original word', async () => {
    const cases: [string, string][] = [
      ['NEW', 'TODO'], ['WORKING', 'IN_PROGRESS'], ['ON_HOLD', 'BLOCKED'], ['COMPLETED', 'DONE'],
    ];
    for (const [raw, normalised] of cases) {
      rows = [task({ status: raw })];
      const [out] = await service.getMyPreSalesTasks(COMPANY, ME, { includeDone: true });
      expect(out.status).toBe(normalised);
      // "On Hold" must still read as On Hold in the badge, not as Blocked.
      expect(out.rawStatus).toBe(raw);
    }
  });

  it('converts the minutes budget into hours', async () => {
    const [out] = await service.getMyPreSalesTasks(COMPANY, ME);
    expect(out.estimatedHours).toBe(1.5);
  });

  // Inventing a priority would sort a guess against real ones.
  it('leaves priority null rather than defaulting it', async () => {
    const [out] = await service.getMyPreSalesTasks(COMPANY, ME);
    expect(out.priority).toBeNull();
  });

  // The deal page no longer carries the task table, so a row must come back
  // here rather than to a screen where the task is not rendered at all.
  it('links back to My Tasks, not to the deal page', async () => {
    const [out] = await service.getMyPreSalesTasks(COMPANY, ME);
    expect(out.link).toEqual({ route: '/projects', queryParams: { tab: 'my-tasks', psTask: '5' } });
  });

  it('hides completed work unless asked', async () => {
    await service.getMyPreSalesTasks(COMPANY, ME);
    expect(prisma.preSalesTask.findMany.mock.calls[0][0].where.status).toEqual({ not: 'COMPLETED' });

    await service.getMyPreSalesTasks(COMPANY, ME, { includeDone: true });
    expect(prisma.preSalesTask.findMany.mock.calls[1][0].where.status).toBeUndefined();
  });

  it('falls back to the contact when the deal has no company name', async () => {
    rows = [task({ lead: { id: 77, companyName: null, contactName: 'Jo' } })];
    const [out] = await service.getMyPreSalesTasks(COMPANY, ME);
    expect(out.parent).toMatchObject({ kind: 'LEAD', name: 'Jo' });
  });
});
