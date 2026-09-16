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
      preSalesRequest: {
        findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => ({ id: 11, status: 'APPROVED', items: [] })),
        create: jest.fn(async ({ data }: any) => ({ id: 11, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 11, ...data })),
      },
      preSalesRequestItem: {
        findMany: jest.fn(async () => []),
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 51, ...data })),
        update: jest.fn(async ({ data }: any) => ({ id: 61, ...data })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      preSalesTask: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: any) => ({ id: 21, ...data, assignedTo: { firstName: 'Rahul', lastName: 'Sharma' } })), update: jest.fn(async ({ data }: any) => ({ id: 21, ...data, assignedTo: { firstName: 'Rahul', lastName: 'Sharma' }, assignedById: CREATOR.employeeId, title: 'T' })), findUnique: jest.fn(async ({ include }: any) => ({ id: 21, assignedTo: { firstName: 'Rahul', lastName: 'Sharma' }, attachments: include?.attachments ? [{ id: 71, fileName: 'brief.pdf', fileUrl: 'https://ik/b.pdf' }] : [] })) },
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
    const body = {
      items: [{ employeeId: 4, technology: 'Network security', engagementType: 'ONSITE', hours: 16 }],
      reason: 'Client requires network security expertise.',
    };

    it('is how the lead creator adds someone', async () => {
      const req: any = await service.createPreSalesRequest(COMPANY, LEAD, CREATOR, body);
      expect(req.status).toBe('PENDING');
      expect(prisma.preSalesTeamMember.upsert).not.toHaveBeenCalled();
      expect(notifications.notifyApprovers).toHaveBeenCalled();
    });

    it('requires a reason', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, { ...body, reason: '  ' }))
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
      prisma.preSalesRequestItem.findMany.mockResolvedValueOnce([{ employeeId: 4 }]);
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, body))
        .rejects.toThrow(/already awaiting approval/);
    });

    it('refuses someone already on the team', async () => {
      prisma.preSalesTeamMember.findMany.mockResolvedValueOnce([{ employeeId: 4 }]);
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, body))
        .rejects.toThrow(/already on this deal/);
    });

    // The whole point of the redesign: one request, several specialists.
    it('carries each person\'s technology, engagement type and hours', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([
        { id: 4, firstName: 'Neha', lastName: 'Singh' },
        { id: 8, firstName: 'Amit', lastName: 'Kumar' },
      ]);
      const req: any = await service.createPreSalesRequest(COMPANY, LEAD, CREATOR, {
        reason: 'Two specialists needed',
        items: [
          { employeeId: 4, technology: 'Network security', engagementType: 'ONSITE', hours: 16 },
          { employeeId: 8, technology: 'Cloud architecture', engagementType: 'VIRTUAL', hours: 8 },
        ],
      });
      const created = prisma.preSalesRequest.create.mock.calls[0][0].data.items.create;
      expect(created).toHaveLength(2);
      expect(created[0]).toEqual(expect.objectContaining({
        employeeId: 4, technology: 'Network security', engagementType: 'ONSITE', hours: 16, status: 'REQUESTED',
      }));
      expect(created[1].engagementType).toBe('VIRTUAL');
    });

    it('rejects an engagement type outside onsite and virtual', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, {
        reason: 'x', items: [{ employeeId: 4, technology: 'SDWAN', engagementType: 'HYBRID', hours: 4 }],
      })).rejects.toThrow(/ONSITE or VIRTUAL/);
    });

    it('rejects hours that are not a positive number', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, {
        reason: 'x', items: [{ employeeId: 4, technology: 'SDWAN', hours: 'eight' }],
      })).rejects.toThrow(/greater than zero/);
    });

    it('rejects the same person twice on one request', async () => {
      const line = { technology: 'SDWAN', engagementType: 'ONSITE', hours: 4 };
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, {
        reason: 'x', items: [{ employeeId: 4, ...line }, { employeeId: 4, ...line }],
      })).rejects.toThrow(/appears twice/);
    });

    // Hours become a budget the moment the person joins, so asking without
    // them is asking for an open-ended commitment.
    it('requires the technology for each person', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, {
        reason: 'x', items: [{ employeeId: 4, hours: 4 }],
      })).rejects.toThrow(/what technology/i);
    });

    it('requires the hours for each person', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, {
        reason: 'x', items: [{ employeeId: 4, technology: 'SDWAN' }],
      })).rejects.toThrow(/hours needed/i);
    });

    it('requires at least one person', async () => {
      await expect(service.createPreSalesRequest(COMPANY, LEAD, CREATOR, { reason: 'x', items: [] }))
        .rejects.toThrow(/at least one person/);
    });
  });

  describe('approval', () => {
    const pending = {
      id: 11, leadId: LEAD, requestedById: CREATOR.employeeId, status: 'PENDING',
      reason: 'Security expertise',
      items: [{
        id: 51, employeeId: 4, technology: 'Network security', engagementType: 'ONSITE', hours: 16,
        status: 'REQUESTED', employee: { id: 4, firstName: 'Neha', lastName: 'Singh' },
      }],
      lead: { id: LEAD, title: 'ABC Corporation', companyName: 'ABC Corp', addedById: CREATOR.employeeId },
    };

    beforeEach(() => { prisma.preSalesRequest.findFirst = jest.fn(async () => pending); });

    it('adds the employee and notifies both sides', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([{ id: 4, firstName: 'Neha', lastName: 'Singh' }]);
      await service.approvePreSalesRequest(COMPANY, 11, ADMIN);
      expect(prisma.preSalesTeamMember.upsert).toHaveBeenCalled();
      const messages = notifications.notifyEmployees.mock.calls.map((c: any) => c[1].message);
      expect(messages.some((m: string) => m.includes('was approved for'))).toBe(true);
      expect(messages.some((m: string) => m.includes('added as a Pre-Sales member'))).toBe(true);
    });

    // The terms travel with the person onto the team.
    it('carries the technology, engagement type and hours onto the assignment', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([{ id: 4, firstName: 'Neha', lastName: 'Singh' }]);
      await service.approvePreSalesRequest(COMPANY, 11, ADMIN);
      const created = prisma.preSalesTeamMember.upsert.mock.calls[0][0].create;
      expect(created).toEqual(expect.objectContaining({
        employeeId: 4, technology: 'Network security', engagementType: 'ONSITE', hours: 16,
      }));
    });

    // An admin may approve a different set than was asked for.
    it('lets the admin drop someone and substitute another', async () => {
      prisma.employee.findMany.mockResolvedValueOnce([{ id: 9, firstName: 'Bhanu', lastName: 'Singh' }]);
      await service.approvePreSalesRequest(COMPANY, 11, ADMIN, {
        items: [{ employeeId: 9, technology: 'Firewalls', engagementType: 'VIRTUAL', hours: 4 }],
      });

      // The substitute joins...
      expect(prisma.preSalesTeamMember.upsert.mock.calls[0][0].create.employeeId).toBe(9);
      // ...recorded as never having been asked for...
      expect(prisma.preSalesRequestItem.create.mock.calls[0][0].data.status).toBe('ADDED');
      // ...and the person who was asked for is kept, marked as not granted.
      expect(prisma.preSalesRequestItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REMOVED' } }),
      );
    });

    it('refuses to approve an empty set', async () => {
      await expect(service.approvePreSalesRequest(COMPANY, 11, ADMIN, { items: [] }))
        .resolves.toBeDefined();  // empty falls back to the request as submitted
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

    it('marks every line as not granted when the request is rejected', async () => {
      await service.rejectPreSalesRequest(COMPANY, 11, ADMIN, {});
      expect(prisma.preSalesRequestItem.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REMOVED' } }),
      );
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
      await service.createPreSalesTask(COMPANY, LEAD, ADMIN, task);
      const entry = prisma.preSalesTaskStatusHistory.create.mock.calls[0][0].data;
      expect(entry.taskId).toBe(21);
      expect(entry.newStatus).toBe('NEW');
      expect(entry.previousStatus).toBeNull();
    });

    it('pins creation attachments to the opening history entry', async () => {
      await service.createPreSalesTask(COMPANY, LEAD, ADMIN, {
        ...task,
        attachments: [{ fileName: 'brief.pdf', fileUrl: 'https://ik/b.pdf' }],
      });
      expect(prisma.preSalesTaskAttachment.createMany).toHaveBeenCalled();
      const data = prisma.preSalesTaskAttachment.createMany.mock.calls[0][0].data[0];
      expect(data.historyId).toBe(31);
      expect(data.fileUrl).toBe('https://ik/b.pdf');
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

  // ── the hours budget ──────────────────────────────────────────────────────
  //
  // A member is engaged for a number of hours; the tasks raised for them are
  // measured against it. A member with no allocation is UNCAPPED rather than
  // capped at zero — members who predate the budget must stay assignable.
  describe('hours budget', () => {
    const task = {
      assignedToId: PRESALES.employeeId, title: 'Client Meeting',
      durationHours: 4, durationMinutes: 0,
    };

    const withAllocation = (hours: number | null, plannedMinutes: number[] = []) => {
      prisma.preSalesTeamMember.findFirst = jest.fn(async () => ({
        id: 5, employeeId: PRESALES.employeeId, status: 'ACTIVE',
        assignedById: CREATOR.employeeId, hours,
      }));
      prisma.preSalesTask.findMany = jest.fn(async () =>
        plannedMinutes.map((m, i) => ({ id: i + 1, estimatedMinutes: m })));
    };

    it('allows a task inside the allocation', async () => {
      withAllocation(8, [60]);
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task)).resolves.toBeDefined();
    });

    it('refuses a task that exceeds what is left', async () => {
      withAllocation(4, [120]);   // 4h allocated, 2h planned, asking for 4h
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task))
        .rejects.toThrow(/more time than is left/);
    });

    it('says how much is allocated, planned and remaining', async () => {
      withAllocation(4, [120]);
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task))
        .rejects.toThrow(/4h allocated, 2h already planned, 2h remaining/);
    });

    it('points at the way out rather than just refusing', async () => {
      withAllocation(4, [120]);
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task))
        .rejects.toThrow(/Request more hours/);
    });

    // The regression this guards: 7 of 11 existing members have no allocation.
    it('leaves a member with no allocation uncapped', async () => {
      withAllocation(null, [6000]);
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task)).resolves.toBeDefined();
    });

    it('counts only the tasks already planned, not the one being raised', async () => {
      withAllocation(4, []);      // exactly 4h free, asking for exactly 4h
      await expect(service.createPreSalesTask(COMPANY, LEAD, ADMIN, task)).resolves.toBeDefined();
    });
  });

  describe('requesting more hours', () => {
    beforeEach(() => {
      prisma.preSalesTeamMember.findFirst = jest.fn(async () => ({
        id: 5, employeeId: PRESALES.employeeId, status: 'ACTIVE', hours: 4,
        technology: 'SDWAN', engagementType: 'ONSITE',
        employee: { firstName: 'Rahul', lastName: 'Sharma' },
      }));
      prisma.preSalesRequestItem.findFirst = jest.fn(async () => null);
    });

    const body = { employeeId: PRESALES.employeeId, hours: 5, reason: 'The client added a second site.' };

    it('is a request when a non-admin asks', async () => {
      const out: any = await service.createPreSalesHoursRequest(COMPANY, LEAD, CREATOR, body);
      expect(out.type).toBe('ADDITIONAL_HOURS');
      expect(out.status).toBe('PENDING');
      expect(notifications.notifyApprovers).toHaveBeenCalled();
    });

    // There is nobody above an admin to ask.
    it('is applied immediately when an admin asks', async () => {
      await service.createPreSalesHoursRequest(COMPANY, LEAD, ADMIN, body);
      expect(prisma.preSalesTeamMember.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { hours: 9 } }),
      );
    });

    it('requires a reason', async () => {
      await expect(service.createPreSalesHoursRequest(COMPANY, LEAD, CREATOR, { ...body, reason: ' ' }))
        .rejects.toThrow(/why the extra time/i);
    });

    it('requires a positive number of hours', async () => {
      await expect(service.createPreSalesHoursRequest(COMPANY, LEAD, CREATOR, { ...body, hours: 0 }))
        .rejects.toThrow(/how many additional hours/i);
    });

    it('refuses for someone not on the team', async () => {
      prisma.preSalesTeamMember.findFirst = jest.fn(async () => null);
      await expect(service.createPreSalesHoursRequest(COMPANY, LEAD, CREATOR, body))
        .rejects.toThrow(/not on this deal/);
    });

    it('refuses a second pending top-up for the same person', async () => {
      prisma.preSalesRequestItem.findFirst = jest.fn(async () => ({ id: 9 }));
      await expect(service.createPreSalesHoursRequest(COMPANY, LEAD, CREATOR, body))
        .rejects.toThrow(/already awaiting approval/);
    });

    it('adds the granted hours on approval, not the requested ones', async () => {
      prisma.preSalesRequest.findFirst = jest.fn(async () => ({
        id: 12, leadId: LEAD, type: 'ADDITIONAL_HOURS', status: 'PENDING',
        requestedById: CREATOR.employeeId,
        items: [{ id: 61, employeeId: PRESALES.employeeId, hours: 8, employee: { firstName: 'Rahul', lastName: 'Sharma' } }],
        lead: { id: LEAD, title: 'ABC', companyName: 'ABC Corp', addedById: CREATOR.employeeId },
      }));
      prisma.preSalesRequest.findUnique = jest.fn(async () => ({ id: 12, status: 'APPROVED', items: [] }));

      // Asked for 8, admin grants 4.
      await service.approvePreSalesRequest(COMPANY, 12, ADMIN, { items: [{ employeeId: PRESALES.employeeId, hours: 4 }] });
      expect(prisma.preSalesTeamMember.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { hours: 8 } }),   // 4 existing + 4 granted
      );
    });
  });

  /**
   * Waiting first, newest within each group.
   *
   * This cannot be an orderBy: sorting the status string puts APPROVED first
   * ascending and REJECTED first descending, and neither is the priority.
   */
  describe('the admin queue ordering', () => {
    const row = (id: number, status: string, day: number) => ({
      id, status, createdAt: new Date(`2026-09-${String(day).padStart(2, '0')}`),
      items: [], lead: { id: 1 },
    });

    it('puts pending above decided, newest first inside each', async () => {
      // Returned newest-first by the query, mixed statuses.
      prisma.preSalesRequest.findMany = jest.fn(async () => [
        row(5, 'REJECTED', 14),
        row(4, 'PENDING', 13),
        row(3, 'APPROVED', 12),
        row(2, 'PENDING', 11),
        row(1, 'APPROVED', 10),
      ]);

      const out: any[] = await service.listPreSalesRequests(COMPANY, ADMIN);
      expect(out.map((r) => r.id)).toEqual([4, 2, 5, 3, 1]);
    });

    it('does not let a rejected request outrank a pending one', async () => {
      prisma.preSalesRequest.findMany = jest.fn(async () => [
        row(2, 'REJECTED', 14),
        row(1, 'PENDING', 10),
      ]);
      const out: any[] = await service.listPreSalesRequests(COMPANY, ADMIN);
      expect(out[0].status).toBe('PENDING');
    });

    it('is still admin-only', async () => {
      await expect(service.listPreSalesRequests(COMPANY, CREATOR)).rejects.toThrow(ForbiddenException);
    });
  });
});
