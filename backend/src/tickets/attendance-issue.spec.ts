import { BadRequestException, NotFoundException } from '@nestjs/common';

import { TicketsService } from './tickets.service';

/**
 * Attendance issues are the one ticket type that is not engineering's.
 *
 * Three things separate them from every other ticket, and all three are load
 * bearing: they route to HR, they cannot be raised without evidence, and they
 * are invisible to the development team — which otherwise sees every ticket in
 * the company.
 */
describe('TicketsService — attendance issues', () => {
  const COMPANY = 1;
  const REPORTER = 42;

  let prisma: any;
  let service: TicketsService;

  const evidence = [{ fileName: 'clock.png', fileUrl: 'https://ik/clock.png', fileSize: 100 }];
  const body = (over: any = {}) => ({
    title: 'Clock-out not recorded',
    type: 'ATTENDANCE_ISSUE',
    attendanceDate: '2026-09-10',
    attachments: evidence,
    ...over,
  });

  beforeEach(() => {
    prisma = {
      ticket: {
        count: jest.fn(async () => 0),
        create: jest.fn(async ({ data }: any) => ({ id: 1, ...data, activities: [], attachments: [] })),
        findFirst: jest.fn(),
      },
      systemSetting: { findUnique: jest.fn(async () => ({ attendanceTicketAssigneeId: 9 })) },
      employee: { findFirst: jest.fn(async () => ({ id: 9, departmentId: 4 })), findUnique: jest.fn(async () => null) },
      department: { findMany: jest.fn(async () => [{ id: 4, name: 'Human Resources' }, { id: 13, name: 'Software Development' }]) },
      ticketActivity: { create: jest.fn(async () => ({})) },
    };
    service = new TicketsService(
      prisma,
      { sendTicketAssignedEmail: jest.fn(async () => undefined) } as any,
      {
        notifyUser: jest.fn(async () => undefined),
        notifyApprovers: jest.fn(async () => undefined),
        notifyEmployees: jest.fn(async () => undefined),
      } as any,
    );
  });

  const createdData = () => prisma.ticket.create.mock.calls[0][0].data;

  describe('evidence is mandatory', () => {
    it('refuses a ticket with no attachments', async () => {
      await expect(service.create(COMPANY, REPORTER, body({ attachments: [] })))
        .rejects.toThrow(/Attach evidence/);
    });

    it('refuses a ticket whose attachments field is missing entirely', async () => {
      await expect(service.create(COMPANY, REPORTER, body({ attachments: undefined })))
        .rejects.toThrow(BadRequestException);
    });

    // An entry with no URL is a form artefact, not a file.
    it('refuses an attachment with no file behind it', async () => {
      await expect(service.create(COMPANY, REPORTER, body({ attachments: [{ fileName: 'ghost.png' }] })))
        .rejects.toThrow(/Attach evidence/);
    });

    it('does not impose the rule on ordinary tickets', async () => {
      await expect(service.create(COMPANY, REPORTER, { title: 'Bug', type: 'BUG', attachments: [] }))
        .resolves.toBeDefined();
    });
  });

  describe('the date it concerns', () => {
    it('is required', async () => {
      await expect(service.create(COMPANY, REPORTER, body({ attendanceDate: null })))
        .rejects.toThrow(/Select the date/);
    });

    it('rejects an unparseable date rather than storing Invalid Date', async () => {
      await expect(service.create(COMPANY, REPORTER, body({ attendanceDate: 'last tuesday' })))
        .rejects.toThrow(/Select the date/);
    });

    it('rejects a future date', async () => {
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
      await expect(service.create(COMPANY, REPORTER, body({ attendanceDate: tomorrow })))
        .rejects.toThrow(/cannot be in the future/);
    });

    it('is stored when valid', async () => {
      await service.create(COMPANY, REPORTER, body());
      expect(createdData().attendanceDate).toEqual(new Date('2026-09-10'));
    });

    it('stays null on every other type', async () => {
      await service.create(COMPANY, REPORTER, { title: 'Bug', type: 'BUG' });
      expect(createdData().attendanceDate).toBeNull();
    });
  });

  describe('routing', () => {
    it('goes to the configured HR handler and their department', async () => {
      await service.create(COMPANY, REPORTER, body());
      expect(createdData().assigneeId).toBe(9);
      expect(createdData().departmentId).toBe(4);
    });

    // A setting pointing at someone who has left must not silently assign to a
    // dangling id.
    it('falls back to an active HR user when the setting is stale', async () => {
      prisma.systemSetting.findUnique.mockResolvedValueOnce({ attendanceTicketAssigneeId: 999 });
      prisma.employee.findFirst
        .mockResolvedValueOnce(null)          // configured handler no longer exists
        .mockResolvedValueOnce({ id: 7 })     // an HR-role employee
        .mockResolvedValueOnce({ id: 7, departmentId: 4 });
      await service.create(COMPANY, REPORTER, body());
      expect(createdData().assigneeId).toBe(7);
    });

    it('still owns the ticket by the HR department when nobody can be assigned', async () => {
      prisma.systemSetting.findUnique.mockResolvedValueOnce({ attendanceTicketAssigneeId: null });
      prisma.employee.findFirst.mockResolvedValue(null);
      await service.create(COMPANY, REPORTER, body());
      expect(createdData().assigneeId).toBeNull();
      expect(createdData().departmentId).toBe(4);
    });

    it('leaves ordinary tickets on the development team', async () => {
      prisma.systemSetting.findUnique.mockResolvedValue({ defaultTicketAssigneeId: 3 });
      prisma.employee.findFirst.mockResolvedValue({ id: 3, departmentId: 13 });
      await service.create(COMPANY, REPORTER, { title: 'Bug', type: 'BUG' });
      expect(createdData().departmentId).toBe(13);
    });
  });

  describe('who can read one', () => {
    const attendanceTicket = {
      id: 5, companyId: COMPANY, type: 'ATTENDANCE_ISSUE', reporterId: REPORTER, assigneeId: 9,
      activities: [], attachments: [], comments: [], timeEntries: [],
    };

    beforeEach(() => {
      prisma.ticket.findFirst = jest.fn(async () => attendanceTicket);
      prisma.employee.findMany = jest.fn(async () => []);
    });

    const read = (user: any) => service.findOne(COMPANY, 5, user);

    it.each([['HR'], ['ADMIN'], ['SUPERADMIN']])('%s can read it', async (role) => {
      await expect(read({ role, employeeId: 77 })).resolves.toBeDefined();
    });

    it('the reporter can read their own', async () => {
      await expect(read({ role: 'EMPLOYEE', employeeId: REPORTER })).resolves.toBeDefined();
    });

    it('the HR person it is assigned to can read it', async () => {
      await expect(read({ role: 'EMPLOYEE', employeeId: 9 })).resolves.toBeDefined();
    });

    // The reason this type exists as a special case at all.
    it('a developer cannot read it, even knowing the id', async () => {
      await expect(read({ role: 'EMPLOYEE', employeeId: 88 })).rejects.toThrow(NotFoundException);
    });

    // MANAGER is deliberately not on the handler list: a manager reading
    // complaints raised against their own team is the situation to avoid.
    it('a manager cannot read it', async () => {
      await expect(read({ role: 'MANAGER', employeeId: 88 })).rejects.toThrow(NotFoundException);
    });

    it('says "not found" rather than "forbidden", so the id leaks nothing', async () => {
      await expect(read({ role: 'EMPLOYEE', employeeId: 88 })).rejects.toThrow('Ticket not found');
    });

    it('an ordinary ticket is not subject to the HR rule', async () => {
      prisma.ticket.findFirst = jest.fn(async () => ({ ...attendanceTicket, type: 'BUG' }));
      prisma.employee.findUnique = jest.fn(async () => ({ department: { name: 'Software Development' } }));
      await expect(read({ role: 'EMPLOYEE', employeeId: 88 })).resolves.toBeDefined();
    });
  });

  /**
   * findOne took no caller at all, so the id alone was enough to read any
   * ticket in the company — description, comments, attachments, time entries —
   * which made findAll's scoping decorative.
   */
  describe('reading an ordinary ticket', () => {
    const bug = {
      id: 5, companyId: COMPANY, type: 'BUG', reporterId: REPORTER, assigneeId: 3,
      activities: [], attachments: [], comments: [], timeEntries: [],
    };

    beforeEach(() => {
      prisma.ticket.findFirst = jest.fn(async () => bug);
      prisma.employee.findMany = jest.fn(async () => []);
      // Not in engineering unless a test says so.
      prisma.employee.findUnique = jest.fn(async () => ({ department: { name: 'Finance' } }));
    });

    const read = (user: any) => service.findOne(COMPANY, 5, user);

    it.each([['SUPERADMIN'], ['ADMIN'], ['MANAGER']])('%s can read it', async (role) => {
      await expect(read({ role, employeeId: 88 })).resolves.toBeDefined();
    });

    it('someone in engineering can read it, as the list already allowed', async () => {
      prisma.employee.findUnique = jest.fn(async () => ({ department: { name: 'Software Development' } }));
      await expect(read({ role: 'EMPLOYEE', employeeId: 88 })).resolves.toBeDefined();
    });

    it('the reporter can read their own', async () => {
      await expect(read({ role: 'EMPLOYEE', employeeId: REPORTER })).resolves.toBeDefined();
    });

    // Otherwise assigning a ticket outside engineering makes it unopenable for
    // the person expected to work it.
    it('the assignee can read it whatever their department', async () => {
      await expect(read({ role: 'EMPLOYEE', employeeId: 3 })).resolves.toBeDefined();
    });

    it('an unrelated employee cannot, even knowing the id', async () => {
      await expect(read({ role: 'EMPLOYEE', employeeId: 88 })).rejects.toThrow('Ticket not found');
    });

    // Called without a caller (internal use), the check is skipped rather than
    // failing closed on undefined — the controller always passes one.
    it('is unrestricted when no caller is supplied', async () => {
      await expect(service.findOne(COMPANY, 5)).resolves.toBeDefined();
    });
  });

  describe('the list query', () => {
    beforeEach(() => {
      prisma.ticket.findMany = jest.fn(async () => []);
      prisma.employee.findUnique = jest.fn(async () => ({ department: { name: 'Software Development' } }));
    });

    const whereFor = async (user: any) => {
      await service.findAll(COMPANY, user, {});
      return prisma.ticket.findMany.mock.calls[0][0].where;
    };

    it('excludes attendance issues for an engineer who otherwise sees everything', async () => {
      const where = await whereFor({ role: 'EMPLOYEE', employeeId: 88 });
      expect(where.reporterId).toBeUndefined();        // engineering bypass still applies
      expect(JSON.stringify(where.OR)).toContain('ATTENDANCE_ISSUE');
    });

    it('does not filter them out for HR', async () => {
      const where = await whereFor({ role: 'HR', employeeId: 9 });
      expect(where.OR).toBeUndefined();
    });
  });
});
