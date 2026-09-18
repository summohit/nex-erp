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
    user: { findMany: jest.fn().mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@x.com' }]) },
    ...over,
  };
  const mail: any = { sendNoticeEmail: jest.fn().mockResolvedValue(undefined) };
  return { service: new NoticesService(prisma, mail), prisma, mail };
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
    expect(where).toMatchObject({ companyId: 1, isActive: true });
    expect(where.publishedAt.lte).toBeInstanceOf(Date);
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: expect.any(Object) }]);
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
