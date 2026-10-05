import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { NoticesService } from './notices.service';

/**
 * The company notice board.
 *
 * What matters: only the right people can announce something, the dashboard
 * shows what is actually live rather than everything ever written, and a mail
 * server having a bad afternoon never costs the announcement.
 */
function make(over: any = {}) {
  const prisma: any = {
    notice: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 5 }),
      create: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 5, ...a.data })),
      update: jest.fn().mockImplementation((a: any) => Promise.resolve({ id: 5, ...a.data })),
    },
    noticeRead: { upsert: jest.fn().mockResolvedValue({}) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 1, email: 'a@x.com' }, { id: 2, email: 'b@x.com' }]) },
    noticeRecipient: { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
  const mail: any = { sendNoticeEmail: jest.fn().mockResolvedValue(undefined) };
  const realtime: any = { sendNotice: jest.fn() };
  return { service: new NoticesService(prisma, mail, realtime), prisma, mail, realtime };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('who may post a notice', () => {
  it.each(['ADMIN', 'SUPERADMIN', 'HR'])('allows %s', async (role) => {
    const { service } = make();
    await expect(service.create(1, 9, role, { title: 'T', body: 'B' })).resolves.toBeDefined();
  });

  it('refuses an ordinary employee', async () => {
    const { service } = make();
    await expect(service.create(1, 9, 'EMPLOYEE', { title: 'T', body: 'B' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('insists on a title and a body', async () => {
    const { service } = make();
    await expect(service.create(1, 9, 'ADMIN', { title: '  ', body: 'B' }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(1, 9, 'ADMIN', { title: 'T', body: '  ' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a notice that expires before it is published', async () => {
    const { service } = make();
    await expect(service.create(1, 9, 'ADMIN', {
      title: 'T', body: 'B',
      publishedAt: '2026-10-01', expiresAt: '2026-09-01',
    })).rejects.toThrow(/cannot expire before/);
  });
});

describe('emailing the company', () => {
  it('emails everybody by default', async () => {
    const { service, mail } = make();
    await service.create(1, 9, 'ADMIN', { title: 'Closed Friday', body: 'B' });
    await flush();
    expect(mail.sendNoticeEmail).toHaveBeenCalledTimes(2);
  });

  it('can be told not to', async () => {
    const { service, mail } = make();
    await service.create(1, 9, 'ADMIN', { title: 'T', body: 'B', sendEmail: false });
    await flush();
    expect(mail.sendNoticeEmail).not.toHaveBeenCalled();
  });

  // The notice is posted either way: a mail server having a bad afternoon
  // must not lose the announcement.
  it('still posts the notice when the mail fails', async () => {
    const { service, mail } = make();
    mail.sendNoticeEmail.mockRejectedValue(new Error('smtp down'));
    await expect(service.create(1, 9, 'ADMIN', { title: 'T', body: 'B' })).resolves.toBeDefined();
    await flush();
  });
});

describe('what the dashboard shows', () => {
  it('asks only for live notices — active, published, not expired', async () => {
    const { service, prisma } = make();
    await service.forDashboard(1, 42);
    const where = prisma.notice.findMany.mock.calls[0][0].where;
    expect(where.companyId).toBe(1);
    const [live, addressed] = where.AND;
    expect(live).toMatchObject({ isActive: true });
    expect(live.publishedAt.lte).toBeInstanceOf(Date);
    expect(live.OR).toEqual([{ expiresAt: null }, { expiresAt: expect.any(Object) }]);
    // Addressed to them, or from before targeting and so to everybody.
    expect(addressed.OR).toEqual([{ recipients: { some: { userId: 42 } } }, { recipients: { none: {} } }]);
  });

  it('marks each one read or unread for the person asking', async () => {
    const { service } = make({
      notice: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, title: 'Seen', reads: [{ id: 9 }] },
          { id: 2, title: 'Not seen', reads: [] },
        ]),
      },
    });
    const out: any = await service.forDashboard(1, 42);
    expect(out.map((n: any) => n.isRead)).toEqual([true, false]);
    // The join rows themselves are not the reader's business.
    expect(out[0].reads).toBeUndefined();
  });
});

describe('retiring', () => {
  // A notice that was read and acted on is the record of what the company was
  // told and when; deleting the row deletes the answer to "were we told".
  it('deactivates rather than deletes', async () => {
    const { service, prisma } = make();
    await service.retire(1, 'ADMIN', 5);
    expect(prisma.notice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isActive: false } }),
    );
  });

  it('refuses an employee', async () => {
    const { service } = make();
    await expect(service.retire(1, 'EMPLOYEE', 5)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('marking one read', () => {
  it('is idempotent, so dismissing twice is harmless', async () => {
    const { service, prisma } = make();
    await service.markRead(1, 42, 5);
    expect(prisma.noticeRead.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { noticeId: 5, userId: 42 }, update: {} }),
    );
  });
});

/**
 * Reading the board is the point of it existing; posting is the restricted
 * part. An announcement only its authors can open is not an announcement.
 */
describe('who may read the board', () => {
  it('lets an employee read it', async () => {
    const { service } = make();
    await expect(service.list(1, 'EMPLOYEE')).resolves.toBeDefined();
  });

  it('shows an employee only what is live', async () => {
    const { service, prisma } = make();
    await service.list(1, 'EMPLOYEE', 42);
    const [live, addressed] = prisma.notice.findMany.mock.calls[0][0].where.AND;
    expect(live).toMatchObject({ isActive: true });
    expect(live.publishedAt.lte).toBeInstanceOf(Date);
    expect(addressed.OR[0]).toEqual({ recipients: { some: { userId: 42 } } });
  });

  // Whoever manages the board needs to see what they have scheduled and
  // retired, not only what is currently showing.
  it('shows an administrator everything, including retired and scheduled', async () => {
    const { service, prisma } = make();
    await service.list(1, 'ADMIN');
    expect(prisma.notice.findMany.mock.calls[0][0].where).toEqual({ companyId: 1 });
  });

  it('reports who may post', () => {
    const { service } = make();
    expect(service.canPost('ADMIN')).toBe(true);
    expect(service.canPost('HR')).toBe(true);
    expect(service.canPost('EMPLOYEE')).toBe(false);
  });
});

/**
 * A date picker yields midnight. "Stop showing on the 18th" has to mean
 * through the 18th, or a notice posted on the 18th to run until the 18th is
 * invisible the moment it is posted -- while still listed to whoever posted
 * it, which is exactly how it goes unnoticed.
 */
describe('when a notice stops showing', () => {
  const expiryOf = (prisma: any) => prisma.notice.create.mock.calls[0][0].data.expiresAt as Date;

  it('runs to the end of the chosen day, not its start', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', {
      title: 'T', body: 'B', publishedAt: '2026-09-18', expiresAt: '2026-09-18',
    });
    const e = expiryOf(prisma);
    expect(e.getHours()).toBe(23);
    expect(e.getMinutes()).toBe(59);
  });

  it('so a notice published and expiring the same day is still live that day', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', {
      title: 'T', body: 'B', publishedAt: '2026-09-18', expiresAt: '2026-09-18',
    });
    const published = prisma.notice.create.mock.calls[0][0].data.publishedAt as Date;
    expect(expiryOf(prisma).getTime()).toBeGreaterThan(published.getTime());
  });

  // A caller sending a real timestamp means it; only a bare date is nudged.
  it('leaves an explicit time alone', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', {
      title: 'T', body: 'B',
      // A publish date is needed, or it defaults to today and the expiry is
      // legitimately in the past.
      publishedAt: '2026-09-01', expiresAt: '2026-09-18T09:30:00.000Z',
    });
    expect(expiryOf(prisma).toISOString()).toBe('2026-09-18T09:30:00.000Z');
  });
});

describe('who a notice goes to', () => {
  it('takes a department alone as everyone in it', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>', audience: { departmentIds: [3] } });
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([{ employee: { departmentId: { in: [3] } } }]);
  });

  const recipientsOf = (prisma: any) =>
    prisma.notice.create.mock.calls[0][0].data.recipients.create.map((r: any) => r.userId);

  it('goes to everybody active when no audience is picked', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>' });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({ companyId: 1, status: 'ACTIVE' });
    expect(recipientsOf(prisma)).toEqual([1, 2]);
    expect(prisma.notice.create.mock.calls[0][0].data.audience).toBeUndefined();
  });

  it('narrows departments by roles, and always adds picked people', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', {
      title: 'T', body: '<p>B</p>',
      audience: { departmentIds: [3, 3], roles: ['hr'], userIds: [7] },
    });
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      companyId: 1, status: 'ACTIVE',
      OR: [
        { AND: [{ employee: { departmentId: { in: [3] } } }, { role: { in: ['HR'] } }] },
        { id: { in: [7] } },
      ],
    });
    expect(prisma.notice.create.mock.calls[0][0].data.audience)
      .toEqual({ departmentIds: [3], roles: ['HR'], designationIds: [], excludeUserIds: [], userIds: [7] });
  });

  it('takes unticked people out of the group, but keeps people picked by name', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', {
      title: 'T', body: '<p>B</p>',
      audience: { designationIds: [12], excludeUserIds: [4], userIds: [7] },
    });
    expect(prisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
      { AND: [{ employee: { designationId: { in: [12] } } }, { id: { notIn: [4] } }] },
      { id: { in: [7] } },
    ]);
  });

  it('lists somebody once however many picks they match', async () => {
    const { service, prisma } = make({
      user: { findMany: jest.fn().mockResolvedValue([{ id: 4 }, { id: 4 }, { id: 5 }]) },
    });
    await service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>', audience: { roles: ['HR'], userIds: [4] } });
    expect(recipientsOf(prisma)).toEqual([4, 5]);
  });

  it('refuses a notice nobody would receive', async () => {
    const { service } = make({ user: { findMany: jest.fn().mockResolvedValue([]) } });
    await expect(service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>', audience: { roles: ['X'] } }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('emails only the people it went to', async () => {
    const { service, prisma, mail } = make();
    await service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>', audience: { userIds: [1] } });
    await flush();
    expect(prisma.user.findMany.mock.calls[1][0].where.id).toEqual({ in: [1, 2] });
    expect(mail.sendNoticeEmail).toHaveBeenCalled();
  });
});

describe('the body', () => {
  it('keeps the editor formatting and drops anything that runs', async () => {
    const { service, prisma } = make();
    await service.create(1, 9, 'ADMIN', {
      title: 'T',
      body: '<h2>Hi</h2><p onclick="x()"><strong>b</strong><script>alert(1)</script></p><a href="javascript:x">l</a>',
    });
    const body = prisma.notice.create.mock.calls[0][0].data.body;
    expect(body).toContain('<h2>Hi</h2>');
    expect(body).toContain('<strong>b</strong>');
    expect(body).not.toMatch(/script|onclick|javascript/);
  });

  it('refuses one with nothing but empty paragraphs', async () => {
    const { service } = make();
    await expect(service.create(1, 9, 'ADMIN', { title: 'T', body: '<p><br></p>' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('who has seen it', () => {
  it('splits the stored recipients into viewed and not', async () => {
    const readAt = new Date('2026-10-05T10:00:00Z');
    const { service } = make({
      noticeRecipient: { findMany: jest.fn().mockResolvedValue([{ userId: 1 }, { userId: 2 }]) },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, email: 'a@x.com', role: 'EMPLOYEE', employee: { firstName: 'Asha', lastName: 'K' } },
          { id: 2, email: 'b@x.com', role: 'HR', employee: { firstName: 'Bina', lastName: 'L' } },
        ]),
      },
      noticeRead: { findMany: jest.fn().mockResolvedValue([{ userId: 2, readAt }]) },
    });
    const out = await service.views(1, 'ADMIN', 5);
    expect(out).toMatchObject({ total: 2, viewedCount: 1, pendingCount: 1 });
    expect(out.viewed[0]).toMatchObject({ name: 'Bina L', viewedAt: readAt });
    expect(out.pending[0]).toMatchObject({ name: 'Asha K', viewed: false });
  });

  it('is not shown to an ordinary employee', async () => {
    const { service } = make();
    await expect(service.views(1, 'EMPLOYEE', 5)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('a high-priority notice', () => {
  it('opens at once for the people it went to', async () => {
    const { service, realtime } = make();
    await service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>', priority: 'high', audience: { userIds: [1] } });
    expect(realtime.sendNotice).toHaveBeenCalledWith([1, 2], 5);
  });

  it('waits when scheduled for later', async () => {
    const { service, realtime } = make();
    await service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>', priority: 'HIGH', publishedAt: '2099-01-01' });
    expect(realtime.sendNotice).not.toHaveBeenCalled();
  });

  it('is not pushed for an ordinary notice', async () => {
    const { service, realtime } = make();
    await service.create(1, 9, 'ADMIN', { title: 'T', body: '<p>B</p>' });
    expect(realtime.sendNotice).not.toHaveBeenCalled();
  });
});
