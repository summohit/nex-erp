import { BadRequestException } from '@nestjs/common';

import { SalesService } from './sales.service';

/**
 * Quotations belong to a DEAL, not necessarily to a client.
 *
 * Quotation.clientId used to be NOT NULL, and that column was quietly doing
 * three jobs: guaranteeing the quote belonged to something, naming it in the
 * approval alert, and supplying the client for a sales order. Making it
 * nullable removed all three guarantees at once, so these tests pin the guards
 * that replaced them.
 */
describe('SalesService — quotations without a client', () => {
  let prisma: any;
  let notifications: any;
  let service: SalesService;

  const COMPANY = 1;

  beforeEach(() => {
    prisma = {
      company: { findUnique: jest.fn(async () => ({ quotationPrefix: null })) },
      quotation: {
        create: jest.fn(async ({ data }: any) => ({
          id: 1, quoteNumber: data.quoteNumber, total: data.total,
          client: null, billingCompanyName: data.billingCompanyName ?? null,
        })),
        findFirst: jest.fn(),
        update: jest.fn(async () => ({})),
      },
      salesOrder: { create: jest.fn(async ({ data }: any) => ({ id: 9, ...data })) },
    };
    notifications = { notifyApprovers: jest.fn(async () => undefined) };
    service = new SalesService(prisma, notifications);
  });

  const baseQuote = (over: Partial<any> = {}) => ({
    date: '2026-09-11', validUntil: '2026-10-11', currency: 'INR', taxRate: 18,
    items: [{ quantity: 1, unitPrice: 100 }],
    ...over,
  });

  describe('creating', () => {
    it('accepts a quotation that belongs to a deal with no client', async () => {
      await expect(
        service.createQuotation(COMPANY, baseQuote({ leadId: 42, clientId: null }), 1),
      ).resolves.toBeDefined();
      expect(prisma.quotation.create).toHaveBeenCalled();
    });

    it('still accepts one raised directly against a client', async () => {
      await expect(
        service.createQuotation(COMPANY, baseQuote({ clientId: 7 }), 1),
      ).resolves.toBeDefined();
    });

    // The NOT NULL column used to make this impossible; now a guard must.
    it('refuses a quotation that belongs to neither', async () => {
      await expect(
        service.createQuotation(COMPANY, baseQuote(), 1),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.quotation.create).not.toHaveBeenCalled();
    });
  });

  describe('quote numbering', () => {
    it('falls back to QT when no prefix is configured', async () => {
      await service.createQuotation(COMPANY, baseQuote({ leadId: 42 }), 1);
      expect(prisma.quotation.create.mock.calls[0][0].data.quoteNumber).toMatch(/^QT-\d+$/);
    });

    it("uses the company's configured prefix", async () => {
      prisma.company.findUnique.mockResolvedValue({ quotationPrefix: 'CES' });
      await service.createQuotation(COMPANY, baseQuote({ leadId: 42 }), 1);
      expect(prisma.quotation.create.mock.calls[0][0].data.quoteNumber).toMatch(/^CES-\d+$/);
    });

    it('does not double the separator when the prefix already ends in one', async () => {
      prisma.company.findUnique.mockResolvedValue({ quotationPrefix: 'CES-' });
      await service.createQuotation(COMPANY, baseQuote({ leadId: 42 }), 1);
      expect(prisma.quotation.create.mock.calls[0][0].data.quoteNumber).toMatch(/^CES-\d+$/);
    });
  });

  describe('converting to a sales order', () => {
    const approved = (over: Partial<any> = {}) => ({
      id: 1, approvalStatus: 'APPROVED', total: 118, currency: 'INR',
      items: [{ description: 'x', quantity: 1, unitPrice: 100, total: 100 }],
      clientId: 5, ...over,
    });

    it('converts a quote that has a client', async () => {
      prisma.quotation.findFirst.mockResolvedValue(approved());
      await expect(service.convertQuoteToOrder(COMPANY, 1)).resolves.toMatchObject({ clientId: 5 });
    });

    // SalesOrder.clientId is still NOT NULL — an order is a commitment against a
    // party. Refuse with an explanation rather than a Prisma null violation.
    it('refuses a deal-only quote, and says what to do about it', async () => {
      prisma.quotation.findFirst.mockResolvedValue(approved({ clientId: null }));

      await expect(service.convertQuoteToOrder(COMPANY, 1)).rejects.toThrow(/Link a client to the deal/);
      expect(prisma.salesOrder.create).not.toHaveBeenCalled();
    });
  });
});

/**
 * A quotation for ₹0.00 still goes to a client and can be converted to a sales
 * order. The form blocks it, but the form is not the rule — this is.
 */
describe('SalesService — every line must be priced', () => {
  let prisma: any;
  let service: SalesService;
  const COMPANY = 1;

  beforeEach(() => {
    prisma = {
      company: { findUnique: jest.fn(async () => ({ quotationPrefix: null })) },
      quotation: {
        create: jest.fn(async ({ data }: any) => ({ id: 1, quoteNumber: data.quoteNumber, total: data.total, client: null })),
        findFirst: jest.fn(async () => ({ id: 5, quoteNumber: '3111-11111111', version: 1, status: 'DRAFT', taxRate: 18 })),
        update: jest.fn(async () => ({})),
      },
    };
    service = new SalesService(prisma, { notifyApprovers: jest.fn() } as any);
  });

  const quote = (items: any[]) => ({
    date: '2026-09-14', validUntil: '2026-10-14', currency: 'INR', taxRate: 18,
    leadId: 7, items,
  });

  const rejected = async (items: any[]) =>
    expect(service.createQuotation(COMPANY, quote(items), 1)).rejects.toThrow(BadRequestException);

  it('rejects a line with no unit price', () => rejected([{ name: 'Service', quantity: 1, unitPrice: 0 }]));
  it('rejects a missing unit price', () => rejected([{ name: 'Service', quantity: 1 }]));
  it('rejects a negative price', () => rejected([{ name: 'Service', quantity: 1, unitPrice: -50 }]));
  it('rejects a zero quantity, which zeroes the amount just as effectively', () =>
    rejected([{ name: 'Service', quantity: 0, unitPrice: 500 }]));
  it('rejects an empty item list', () => rejected([]));

  it('names the offending line so the message is actionable', async () => {
    await expect(service.createQuotation(COMPANY, quote([
      { name: 'Installation', quantity: 1, unitPrice: 500 },
      { name: 'Training', quantity: 1, unitPrice: 0 },
    ]), 1)).rejects.toThrow(/Training/);
  });

  it('falls back to the line number when the item is unnamed', async () => {
    await expect(service.createQuotation(COMPANY, quote([{ quantity: 1, unitPrice: 0 }]), 1))
      .rejects.toThrow(/line 1/);
  });

  it('accepts a properly priced quotation', async () => {
    await expect(service.createQuotation(COMPANY, quote([{ name: 'Service', quantity: 2, unitPrice: 250 }]), 1))
      .resolves.toBeDefined();
  });

  // The edit path writes the same document and needs the same guard.
  it('applies the rule on update too', async () => {
    await expect(service.updateQuotation(COMPANY, 5, { items: [{ name: 'x', quantity: 1, unitPrice: 0 }] }))
      .rejects.toThrow(BadRequestException);
  });
});

/**
 * A sent quotation is a document the client is holding. Editing the row in
 * place makes the record disagree with their copy and nobody finds out, so
 * SENT freezes and corrections become the next version.
 */
describe('SalesService — locking and versioning', () => {
  const COMPANY = 1;
  let prisma: any;
  let service: SalesService;

  const sourceQuote = (over: any = {}) => ({
    id: 10, companyId: COMPANY, leadId: 7, quoteNumber: '3111-59710474', version: 1,
    status: 'SENT', approvalStatus: 'APPROVED', currency: 'INR', taxRate: 18,
    subtotal: 1000, tax: 180, total: 1180, terms: 'Standard terms',
    billingCompanyName: 'Buyer Ltd', billingEmail: 'buyer@example.com',
    date: new Date('2026-09-01'), validUntil: new Date('2026-10-01'),
    items: [{ id: 1, quotationId: 10, name: 'Service', quantity: 2, unitPrice: 500, total: 1000 }],
    attachments: [{ id: 4, quotationId: 10, fileName: 'spec.pdf', fileUrl: 'https://x/spec.pdf', fileSize: 10, createdAt: new Date() }],
    ...over,
  });

  beforeEach(() => {
    prisma = {
      quotation: {
        findFirst: jest.fn(async () => sourceQuote()),
        findMany: jest.fn(async () => [{ version: 1 }]),
        create: jest.fn(async ({ data }: any) => ({ id: 11, ...data })),
        update: jest.fn(async (args: any) => ({ id: args.where.id, ...args.data })),
      },
      salesOrder: { count: jest.fn(async () => 0) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    service = new SalesService(prisma, { notifyApprovers: jest.fn() } as any);
  });

  it('refuses to edit a sent quotation', async () => {
    await expect(service.updateQuotation(COMPANY, 10, { notes: 'sneaky' }))
      .rejects.toThrow(/SENT quotation cannot be edited/);
  });

  it('still allows editing a draft', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce(sourceQuote({ status: 'DRAFT' }));
    await expect(service.updateQuotation(COMPANY, 10, { notes: 'fine' })).resolves.toBeDefined();
  });

  it('suffixes the quote number rather than issuing a new one', async () => {
    const revision: any = await service.reviseQuotation(COMPANY, 10);
    expect(revision.quoteNumber).toBe('3111-59710474-R2');
    expect(revision.version).toBe(2);
    expect(revision.status).toBe('DRAFT');
    expect(revision.revisionOfId).toBe(10);
  });

  it('never doubles the suffix on a third version', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce(
      sourceQuote({ quoteNumber: '3111-59710474-R2', version: 2 }),
    );
    prisma.quotation.findMany.mockResolvedValueOnce([{ version: 1 }, { version: 2 }]);
    const revision: any = await service.reviseQuotation(COMPANY, 10);
    expect(revision.quoteNumber).toBe('3111-59710474-R3');
  });

  it('carries the lines and attachments across, without their old ids', async () => {
    const revision: any = await service.reviseQuotation(COMPANY, 10);
    expect(revision.items.create).toEqual([
      { name: 'Service', quantity: 2, unitPrice: 500, total: 1000 },
    ]);
    expect(revision.attachments.create[0]).toEqual(
      expect.objectContaining({ fileName: 'spec.pdf', fileUrl: 'https://x/spec.pdf' }),
    );
    expect(revision.terms).toBe('Standard terms');
    expect(revision.billingEmail).toBe('buyer@example.com');
  });

  it('supersedes the version it replaces, so the deal shows one live quote', async () => {
    await service.reviseQuotation(COMPANY, 10);
    expect(prisma.quotation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 10 }, data: { status: 'SUPERSEDED' } }),
    );
  });

  it('keeps the validity window the client was given', async () => {
    const revision: any = await service.reviseQuotation(COMPANY, 10);
    const days = (revision.validUntil.getTime() - revision.date.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('tells a user editing a draft to edit it, not version it', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce(sourceQuote({ status: 'DRAFT' }));
    await expect(service.reviseQuotation(COMPANY, 10)).rejects.toThrow(/edit it directly/);
  });

  it('refuses to revise an already superseded version', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce(sourceQuote({ status: 'SUPERSEDED' }));
    await expect(service.reviseQuotation(COMPANY, 10)).rejects.toThrow(/already been replaced/);
  });

  it('refuses to revise an accepted quotation', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce(sourceQuote({ status: 'ACCEPTED' }));
    await expect(service.reviseQuotation(COMPANY, 10)).rejects.toThrow(/become an order/);
  });

  it('is scoped to the company', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce(null);
    await expect(service.reviseQuotation(COMPANY, 10)).rejects.toThrow('Quotation not found');
  });

  it('numbers from the deal, so a gap in versions cannot collide', async () => {
    prisma.quotation.findMany.mockResolvedValueOnce([{ version: 1 }, { version: 2 }, { version: 5 }]);
    const revision: any = await service.reviseQuotation(COMPANY, 10);
    expect(revision.version).toBe(6);
  });

  it('leaves a superseded quotation with nowhere to move', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce(sourceQuote({ status: 'SUPERSEDED' }));
    await expect(service.updateQuotationStatus(COMPANY, 10, 'ACCEPTED'))
      .rejects.toThrow(/final and cannot be changed/);
  });
});

/**
 * updateQuotation destructured `attachments` out of the payload and never used
 * it, so a file uploaded while editing a proposal vanished on save with no
 * error. These pin the reconcile that replaced that.
 */
describe('SalesService — attachments survive an edit', () => {
  const COMPANY = 1;
  let prisma: any;
  let service: SalesService;

  beforeEach(() => {
    prisma = {
      quotation: {
        findFirst: jest.fn(async () => ({ id: 10, companyId: COMPANY, status: 'DRAFT', taxRate: 18 })),
        update: jest.fn(async (args: any) => ({ id: 10, ...args.data })),
      },
    };
    service = new SalesService(prisma, { notifyApprovers: jest.fn() } as any);
  });

  const updateArg = () => prisma.quotation.update.mock.calls[0][0].data;

  it('creates a newly uploaded file', async () => {
    await service.updateQuotation(COMPANY, 10, {
      attachments: [{ fileName: 'spec.pdf', fileUrl: 'https://ik/spec.pdf', fileSize: 2048 }],
    });
    expect(updateArg().attachments.create).toEqual([
      { fileName: 'spec.pdf', fileUrl: 'https://ik/spec.pdf', fileSize: 2048 },
    ]);
  });

  it('leaves a file that was already there alone', async () => {
    await service.updateQuotation(COMPANY, 10, {
      attachments: [{ id: 4, quotationId: 10, fileName: 'old.pdf', fileUrl: 'https://ik/old.pdf' }],
    });
    expect(updateArg().attachments.create).toBeUndefined();
    expect(updateArg().attachments.deleteMany).toEqual({ id: { notIn: [4] } });
  });

  it('handles the real case: one kept, one added', async () => {
    await service.updateQuotation(COMPANY, 10, {
      attachments: [
        { id: 4, fileName: 'old.pdf', fileUrl: 'https://ik/old.pdf' },
        { fileName: 'new.png', fileUrl: 'https://ik/new.png', fileSize: 900 },
      ],
    });
    expect(updateArg().attachments.deleteMany).toEqual({ id: { notIn: [4] } });
    expect(updateArg().attachments.create).toEqual([
      { fileName: 'new.png', fileUrl: 'https://ik/new.png', fileSize: 900 },
    ]);
  });

  it('removes everything when the form is cleared', async () => {
    await service.updateQuotation(COMPANY, 10, { attachments: [] });
    expect(updateArg().attachments.deleteMany).toEqual({});
    expect(updateArg().attachments.create).toBeUndefined();
  });

  // Omitted is not the same as empty: a PATCH that says nothing about
  // attachments must not delete them.
  it('does not touch attachments when the field is not sent', async () => {
    await service.updateQuotation(COMPANY, 10, { notes: 'just a note' });
    expect(updateArg()).not.toHaveProperty('attachments');
  });

  it('ignores an entry with no file URL rather than writing a broken row', async () => {
    await service.updateQuotation(COMPANY, 10, { attachments: [{ fileName: 'ghost.pdf' }] });
    expect(updateArg().attachments.create).toBeUndefined();
  });

  it('returns the attachments so the form reflects what was saved', async () => {
    await service.updateQuotation(COMPANY, 10, { attachments: [] });
    expect(prisma.quotation.update.mock.calls[0][0].include.attachments).toBe(true);
  });
});

/**
 * A deal carries one proposal that evolves. Creating a proposal on a deal that
 * already has one therefore continues the lineage — every quotation defaulting
 * to v1 is what "why do all three say v1" looked like from the outside.
 */
describe('SalesService — a new proposal continues the deal lineage', () => {
  const COMPANY = 1;
  let prisma: any;
  let service: SalesService;

  beforeEach(() => {
    prisma = {
      company: { findUnique: jest.fn(async () => ({ quotationPrefix: '3111' })) },
      quotation: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => ({ id: 2, ...data, client: null })),
      },
    };
    service = new SalesService(prisma, { notifyApprovers: jest.fn() } as any);
  });

  const draft = (over: any = {}) => ({
    leadId: 7, date: '2026-09-14', validUntil: '2026-10-14', currency: 'INR', taxRate: 18,
    items: [{ name: 'Service', quantity: 1, unitPrice: 100 }], ...over,
  });

  it('is v1 with a fresh number when the deal has no proposal yet', async () => {
    const q: any = await service.createQuotation(COMPANY, draft(), 1);
    expect(q.version).toBe(1);
    expect(q.revisionOfId).toBeNull();
    expect(q.quoteNumber).toMatch(/^3111-\d{8}$/);
  });

  it('is the next version of the deal when one already exists', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce({ id: 16, quoteNumber: '3111-59710474', version: 1 });
    const q: any = await service.createQuotation(COMPANY, draft(), 1);
    expect(q.version).toBe(2);
    expect(q.quoteNumber).toBe('3111-59710474-R2');
    expect(q.revisionOfId).toBe(16);
  });

  it('does not stack suffixes on a third proposal', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce({ id: 17, quoteNumber: '3111-59710474-R2', version: 2 });
    const q: any = await service.createQuotation(COMPANY, draft(), 1);
    expect(q.quoteNumber).toBe('3111-59710474-R3');
    expect(q.version).toBe(3);
  });

  // A quote raised straight from Sales has no deal to belong to, so there is no
  // lineage to continue and it keeps its own number.
  it('leaves a client-only quotation on its own number', async () => {
    const q: any = await service.createQuotation(COMPANY, draft({ leadId: null, clientId: 3 }), 1);
    expect(prisma.quotation.findFirst).not.toHaveBeenCalled();
    expect(q.version).toBe(1);
    expect(q.quoteNumber).toMatch(/^3111-\d{8}$/);
  });

  it('still issues a number when the previous quotation has none', async () => {
    prisma.quotation.findFirst.mockResolvedValueOnce({ id: 16, quoteNumber: null, version: 1 });
    const q: any = await service.createQuotation(COMPANY, draft(), 1);
    expect(q.version).toBe(2);
    expect(q.quoteNumber).toMatch(/^3111-\d{8}$/);
  });
});
