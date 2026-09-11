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
