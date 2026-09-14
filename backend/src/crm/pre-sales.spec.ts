import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { CrmService } from './crm.service';

/**
 * Pre-sales. Two of these rules are security rather than presentation, and are
 * the reason this file exists:
 *
 *   1. Membership is what lets an employee see a deal at all.
 *   2. A pre-sales employee sees the deal WITHOUT its money — enforced before
 *      the row leaves the service, so devtools cannot recover it.
 */
describe('CrmService — pre-sales', () => {
  const COMPANY = 1;
  const LEAD = 7;
  const ADMIN = { role: 'ADMIN' as const, employeeId: 1, sub: 10 };
  const CREATOR = { role: 'SALES' as const, employeeId: 2, sub: 20 };
  const PRESALES = { role: 'EMPLOYEE' as const, employeeId: 3, sub: 30 };
  const STRANGER = { role: 'EMPLOYEE' as const, employeeId: 99, sub: 99 };

  let prisma: any;
  let notifications: any;
  let service: CrmService;

  const lead = (over: any = {}) => ({
    id: LEAD, companyId: COMPANY, title: 'ABC Corporation', companyName: 'ABC Corp',
    contactName: 'Neha', status: 'NEW', value: 500000, currency: 'INR',
    addedById: CREATOR.employeeId, assignedToId: null,
    preSalesMembers: [
      { id: 5, employeeId: PRESALES.employeeId, status: 'ACTIVE', assignedById: CREATOR.employeeId,
        employee: { id: 3, firstName: 'Rahul', lastName: 'Sharma' } },
    ],
    ...over,
  });

  beforeEach(() => {
    notifications = {
      notifyEmployees: jest.fn(async () => 1),
      notifyApprovers: jest.fn(async () => 1),
    };
    prisma = {
      lead: { findFirst: jest.fn(async () => lead()) },
      employee: { findMany: jest.fn(async () => [{ id: 4, firstName: 'Amit', lastName: 'Kumar' }]), findFirst: jest.fn(async () => ({ id: 4, firstName: 'Amit', lastName: 'Kumar' })) },
      preSalesTeamMember: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        upsert: jest.fn(async ({ create }: any) => ({ id: 6, ...create })),
        update: jest.fn(async () => ({})),
      },
      preSalesRequest: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 11, ...data })), update: jest.fn(async ({ data }: any) => ({ id: 11, ...data })) },
      preSalesTask: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 21, ...data, assignedTo: { firstName: 'Rahul', lastName: 'Sharma' } })), update: jest.fn(async ({ data }: any) => ({ id: 21, ...data, assignedTo: { firstName: 'Rahul', lastName: 'Sharma' }, assignedById: CREATOR.employeeId, title: 'T' })) },
      preSalesTaskStatusHistory: { create: jest.fn(async ({ data }: any) => ({ id: 31, ...data })), findMany: jest.fn(async () => []) },
      preSalesTaskAttachment: { createMany: jest.fn(async () => ({ count: 1 })) },
      leadActivity: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg)),
    };
    service = new CrmService(prisma, { hasPermission: jest.fn(async () => false) } as any, notifications);
  });

  // ── who sees the money ────────────────────────────────────────────────────
  describe('financial masking', () => {
    it('hides the deal value from a pre-sales-only viewer', async () => {
      const info = await service.getPreSalesInfo(COMPANY, LEAD, PRESALES);
      expect(info.lead).not.toHaveProperty('value');
      expect(info.lead).not.toHaveProperty('currency');
      expect(info.permissions.financialsHidden).toBe(true);
    });

    it.each([
      ['an admin', () => ADMIN],
      ['the deal creator', () => CREATOR],
    ])('shows it to %s', async (_label, who) => {
      const info = await service.getPreSalesInfo(COMPANY, LEAD, who());
      expect(info.lead).toHaveProperty('value', 500000);
      expect(info.permissions.financialsHidden).toBe(false);
    });

    // A quotation carries subtotal, tax and total, so leaving the relation in
    // place would hand back the deal value by another route.
    it('strips the quotations relation as well', () => {
      const masked = (service as any).maskLeadFinancials({ id: 1, value: 5, quotations: [{ total: 99 }] });
      expect(masked).not.toHaveProperty('quotations');
      expect(masked).not.toHaveProperty('value');
      expect(masked.financialsHidden).toBe(true);
    });

    it('hides the request queue from a pre-sales member', async () => {
      prisma.preSalesRequest.findMany.mockResolvedValueOnce([{ id: 1, reason: 'sensitive' }]);
      const info = await service.getPreSalesInfo(COMPANY, LEAD, PRESALES);
      expect(info.requests).toEqual([]);
    });
  });

  // ── membership is access ──────────────────────────────────────────────────
  describe('access', () => {
    it('lets a pre-sales member reach the deal', async () => {
      await expect(service.getPreSalesInfo(COMPANY, LEAD, PRESALES)).resolves.toBeDefined();
    });

    it('reports the deal as missing to an unrelated employee', async () => {
      await expect(service.getPreSalesInfo(COMPANY, LEAD, STRANGER)).rejects.toThrow(NotFoundException);
    });
  });

  // ── only an admin adds directly ───────────────────────────────────────────
  describe('adding members', () => {
    it('lets an admin add several at once', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([
        { id: 4, firstName: 'Amit', lastName: 'Kumar' },
        { id: 8, firstName: 'Neha', lastName: 'Singh' },
      ]);
      await service.addPreSalesMembers(COMPANY, LEAD, ADMIN, { employeeIds: [4, 8], remark: 'Technical analysis' });
      expect(prisma.preSalesTeamMember.upsert).toHaveBeenCalledTimes(2);
      expect(prisma.preSalesTeamMember.upsert.mock.calls[0][0].create.remark).toBe('Technical analysis');
      expect(prisma.preSalesTeamMember.upsert.mock.calls[0][0].create.assignedById).toBe(ADMIN.employeeId);
    });

    it('refuses the lead creator, who must request instead', async () => {
      await expect(service.addPreSalesMembers(COMPANY, LEAD, CREATOR, { employeeIds: [4] }))
        .rejects.toThrow(/administrator/i);
    });

    it('refuses a pre-sales member outright', async () => {
      await expect(service.addPreSalesMembers(COMPANY, LEAD, PRESALES, { employeeIds: [4] }))
        .rejects.toThrow(ForbiddenException);
    });

    // upsert on the unique (leadId, employeeId) is what prevents a duplicate
    // active assignment — a findFirst-then-create check could be raced.
    it('reactivates rather than duplicating an existing row', async () => {
      await service.addPreSalesMembers(COMPANY, LEAD, ADMIN, { employeeIds: [4] });
      const call = prisma.preSalesTeamMember.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ leadId_employeeId: { leadId: LEAD, employeeId: 4 } });
      expect(call.update.status).toBe('ACTIVE');
      expect(call.update.removedAt).toBeNull();
    });

    it('notifies the people it added', async () => {
      await service.addPreSalesMembers(COMPANY, LEAD, ADMIN, { employeeIds: [4] });
      expect(notifications.notifyEmployees).toHaveBeenCalledWith([4], expect.objectContaining({
        message: expect.stringContaining('added as a Pre-Sales member'),
      }));
    });

    it('rejects an employee from another company', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([]);
      await expect(service.addPreSalesMembers(COMPANY, LEAD, ADMIN, { employeeIds: [4] }))
        .rejects.toThrow(/do not belong to this company/);
    });
  });

  // ── requests ──────────────────────────────────────────────────────────────
  describe('requests', () => {
    const body = { employeeId: 4, reason: 'Client requires network security expertise.' };

    it('is how the lead creator adds someone', async () => {
      const req: any = await service.createPreSalesRequest(COMPANY, LEAD, CREATOR, body);
      expect(req.status).toBe('PENDING');
      expect(prisma.preSalesTeamMember.upsert).not.toHaveBeenCalled();
      expect(notifications.notifyApprovers).toHaveBeenCalled();
    });

    it('requires a reason', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, { employeeId: 4, reason: '  ' }))
        .rejects.toThrow(/reason/i);
    });

    it('tells an admin to just add the person', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, ADMIN, body))
        .rejects.toThrow(/no request is needed/);
    });

    it('refuses someone with no stake in the deal', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, PRESALES, body))
        .rejects.toThrow(ForbiddenException);
    });

    it('refuses a duplicate pending request', async () => {
      prisma.preSalesRequest.findFirst.mockResolvedValueOnce({ id: 2, status: 'PENDING' });
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, body))
        .rejects.toThrow(/already awaiting approval/);
    });

    it('refuses someone already on the team', async () => {
      prisma.preSalesTeamMember.findFirst.mockResolvedValueOnce({ id: 5, status: 'ACTIVE' });
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, body))
        .rejects.toThrow(/already on this deal/);
    });
  });

  describe('approval', () => {
    const pending = {
      id: 11, leadId: LEAD, employeeId: 4, requestedById: CREATOR.employeeId, status: 'PENDING',
      reason: 'Security expertise', employee: { id: 4, firstName: 'Neha', lastName: 'Singh' },
      lead: { id: LEAD, title: 'ABC Corporation', companyName: 'ABC Corp', addedById: CREATOR.employeeId },
    };

    beforeEach(() => { prisma.preSalesRequest.findFirst = jest.fn(async () => pending); });

    it('adds the employee and notifies both sides', async () => {
      await service.approvePreSalesRequest(COMPANY, 11, ADMIN);
      expect(prisma.preSalesTeamMember.upsert).toHaveBeenCalled();
      const messages = notifications.notifyEmployees.mock.calls.map((c: any) => c[1].message);
      expect(messages.some((m: string) => m.includes('has been approved'))).toBe(true);
      expect(messages.some((m: string) => m.includes('added as a Pre-Sales member'))).toBe(true);
    });

    it('refuses a non-admin', async () => {
      await expect(service.approvePreSalesRequest(COMPANY, 11, CREATOR)).rejects.toThrow(ForbiddenException);
    });

    // An admin who raised the request still cannot wave it through.
    it('refuses to let the requester approve their own request', async () => {
      await expect(service.approvePreSalesRequest(COMPANY, 11, { role: 'ADMIN', employeeId: CREATOR.employeeId }))
        .rejects.toThrow(/your own/i);
    });

    it('refuses a request that is already decided', async () => {
      prisma.preSalesRequest.findFirst = jest.fn(async () => ({ ...pending, status: 'APPROVED' }));
      await expect(service.approvePreSalesRequest(COMPANY, 11, ADMIN)).rejects.toThrow(/already been approved/);
    });

    it('rejects without adding, and keeps the admin remark', async () => {
      const out: any = await service.rejectPreSalesRequest(COMPANY, 11, ADMIN, { adminRemark: 'Existing team can cover this.' });
      expect(prisma.preSalesTeamMember.upsert).not.toHaveBeenCalled();
      expect(out.status).toBe('REJECTED');
      expect(out.adminRemark).toBe('Existing team can cover this.');
      expect(notifications.notifyEmployees.mock.calls[0][1].message).toContain('Existing team can cover this.');
    });
  });

  // ── tasks ─────────────────────────────────────────────────────────────────
  describe('tasks', () => {
    const task = { assignedToId: PRESALES.employeeId, title: 'Client Meeting', scheduledDate: '2026-09-18', scheduledTime: '15:00', durationHours: 2, durationMinutes: 30 };

    beforeEach(() => {
      prisma.preSalesTeamMember.findFirst = jest.fn(async () => ({
        id: 5, employeeId: PRESALES.employeeId, status: 'ACTIVE', assignedById: CREATOR.employeeId,
      }));
    });

    it('is created by whoever added the member', async () => {
      const out: any = await service.createPreSalesTask(COMPANY, LEAD, CREATOR, task);
      expect(out.status).toBe('NEW');
      expect(out.assignedToId).toBe(PRESALES.employeeId);
    });

    it('is created by an admin too', async () => {
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task)).resolves.toBeDefined();
    });

    // The business rule: pre-sales employees execute tasks, they never raise them.
    it('cannot be created by the pre-sales employee themselves', async () => {
      await expect(service.createPreSalesTask(COMPANY, LEAD, PRESALES, task))
        .rejects.toThrow(/administrator, or the person who added/);
    });

    it('cannot target someone who is not on the team', async () => {
      prisma.preSalesTeamMember.findFirst = jest.fn(async () => null);
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task))
        .rejects.toThrow(/not on this deal/);
    });

    it('stores the duration in minutes, not as text', async () => {
      const out: any = await service.createPreSalesTask(COMPANY, LEAD, ADMIN, task);
      expect(out.estimatedMinutes).toBe(150);
    });

    it('combines the date and time into one instant', async () => {
      const out: any = await service.createPreSalesTask(COMPANY, LEAD, ADMIN, task);
      expect(out.scheduledAt).toEqual(new Date('2026-09-18T15:00:00'));
    });

    it('opens its own history with the creation entry', async () => {
      const out: any = await service.createPreSalesTask(COMPANY, LEAD, ADMIN, task);
      expect(out.history.create.newStatus).toBe('NEW');
      expect(out.history.create.previousStatus).toBeNull();
    });

    it('notifies the assignee', async () => {
      await service.createPreSalesTask(COMPANY, LEAD, ADMIN, task);
      expect(notifications.notifyEmployees).toHaveBeenCalledWith(
        [PRESALES.employeeId],
        expect.objectContaining({ message: expect.stringContaining('New task assigned') }),
      );
    });
  });

  describe('task status', () => {
    beforeEach(() => {
      prisma.preSalesTask.findFirst = jest.fn(async () => ({
        id: 21, companyId: COMPANY, leadId: LEAD, status: 'NEW',
        assignedToId: PRESALES.employeeId, assignedById: CREATOR.employeeId, title: 'Client Meeting',
      }));
    });

    const move = (user: any, data: any) => service.changePreSalesTaskStatus(COMPANY, LEAD, 21, user, data);

    it('is moved by the assignee', async () => {
      await expect(move(PRESALES, { status: 'WORKING' })).resolves.toBeDefined();
    });

    it('is not moved by an unrelated employee', async () => {
      await expect(move(STRANGER, { status: 'WORKING' })).rejects.toThrow(NotFoundException);
    });

    it('rejects a status outside the workflow', async () => {
      await expect(move(PRESALES, { status: 'CANCELLED' })).rejects.toThrow(/must be one of/);
    });

    it('rejects a move to the status it is already in', async () => {
      await expect(move(PRESALES, { status: 'NEW' })).rejects.toThrow(/already new/i);
    });

    // Going on hold or completing is a handover; the trail is the point.
    it('requires a reason to go on hold', async () => {
      await expect(move(PRESALES, { status: 'ON_HOLD' })).rejects.toThrow(/why the task is on hold/);
    });

    it('requires a remark to complete', async () => {
      await expect(move(PRESALES, { status: 'COMPLETED' })).rejects.toThrow(/completion remark/);
    });

    it('appends to the history rather than overwriting it', async () => {
      await move(PRESALES, { status: 'WORKING', remark: 'Started' });
      const entry = prisma.preSalesTaskStatusHistory.create.mock.calls[0][0].data;
      expect(entry.previousStatus).toBe('NEW');
      expect(entry.newStatus).toBe('WORKING');
      expect(entry.changedById).toBe(PRESALES.employeeId);
    });

    it('pins attachments to the status change they arrived with', async () => {
      await move(PRESALES, { status: 'WORKING', remark: 'Started', attachments: [{ fileName: 'notes.pdf', fileUrl: 'https://ik/n.pdf' }] });
      expect(prisma.preSalesTaskAttachment.createMany.mock.calls[0][0].data[0].historyId).toBe(31);
    });

    it('stamps completedAt and notifies the deal', async () => {
      const out: any = await move(PRESALES, { status: 'COMPLETED', remark: 'Done' });
      expect(out.completedAt).toBeInstanceOf(Date);
      const messages = notifications.notifyEmployees.mock.calls.map((c: any) => c[1].message);
      expect(messages.some((m: string) => m.includes('has been completed'))).toBe(true);
      expect(notifications.notifyApprovers).toHaveBeenCalled();
    });
  });
});
