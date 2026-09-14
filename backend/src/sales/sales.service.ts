import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ================= QUOTATIONS =================

  /**
   * The next quotation number for this company.
   *
   * `<prefix>-0009`, from a counter on the Company row. The prefix comes from
   * the Company Profile rather than being hardcoded — otherwise that field is a
   * setting that does nothing — and falls back to "QT", which is what the
   * oldest quotations already use.
   *
   * The counter is incremented in place and returned, which Postgres serialises
   * on the row: two people raising a quotation at the same moment get different
   * numbers. That is the whole reason it is a counter and not `max(number) + 1`,
   * which would race, and would also have to parse the millisecond timestamps
   * that the numbers used to be — reading the highest of those as a sequence
   * starts the count at sixty-two million.
   *
   * A create that fails after this point burns a number. Gaps are the right
   * trade for never issuing the same number twice; a quotation is not a tax
   * invoice, so nothing requires the sequence to be unbroken.
   */
  private async nextQuotationNumber(companyId: number): Promise<string> {
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: { quotationSequence: { increment: 1 } },
      select: { quotationSequence: true, quotationPrefix: true },
    });

    const prefix = (company.quotationPrefix || 'QT').trim().replace(/-+$/, '');
    // Padded to four so the common case sorts correctly as text; beyond 9999 it
    // simply grows, which sorts wrong but stays unique and readable.
    return `${prefix}-${String(company.quotationSequence).padStart(4, '0')}`;
  }

  /**
   * Every line must carry a real amount.
   *
   * A quotation for ₹0.00 is not a quotation — it goes out to a client, gets
   * converted to a sales order and drives revenue, so a blank price is a
   * mistake every time. Enforced here rather than only in the form, because a
   * rule that lives in the browser is a suggestion.
   *
   * Quantity is checked too: the amount is quantity × price, and zero of
   * something is the same empty document by another route.
   */
  private assertItemsPriced(items: any[]) {
    if (!Array.isArray(items) || !items.length) {
      throw new BadRequestException('A quotation needs at least one line item.');
    }

    items.forEach((item: any, i: number) => {
      const quantity = Number(item?.quantity);
      const unitPrice = Number(item?.unitPrice);
      const where = item?.name ? `"${item.name}"` : `line ${i + 1}`;

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`Enter a quantity greater than zero for ${where}.`);
      }
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new BadRequestException(`Enter a unit price for ${where}. A line cannot be quoted at zero.`);
      }
    });
  }

  async createQuotation(companyId: number, data: any, userId: number) {
    const { items, attachments, ...quoteData } = data;

    // A quotation belongs to a DEAL; the client link is optional. But it has to
    // belong to something, or it is an orphan document nothing can find again.
    if (!quoteData.clientId && !quoteData.leadId) {
      throw new BadRequestException('A quotation must belong to a deal or a client.');
    }

    // Convert date strings to DateTime
    if (quoteData.date && typeof quoteData.date === 'string') {
      quoteData.date = new Date(quoteData.date);
    }
    if (quoteData.validUntil && typeof quoteData.validUntil === 'string') {
      quoteData.validUntil = new Date(quoteData.validUntil);
    }

    this.assertItemsPriced(items);

    // Auto-calculate subtotal, tax, total
    let subtotal = 0;
    items.forEach(item => {
      item.total = item.quantity * item.unitPrice;
      subtotal += item.total;
    });

    const taxRate = Number(quoteData.taxRate ?? 18);
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    delete quoteData.taxRate; // avoid double-writing; stored separately below

    // A deal carries one proposal, which evolves — so a proposal raised on a
    // deal that already has one is the next version of it, not an unrelated
    // document that happens to sit alongside. Same rule as reviseQuotation;
    // the only difference is that this one starts from a blank form.
    const previous = quoteData.leadId
      ? await this.prisma.quotation.findFirst({
          where: { companyId, leadId: quoteData.leadId },
          orderBy: [{ version: 'desc' }, { id: 'desc' }],
          select: { id: true, quoteNumber: true, version: true },
        })
      : null;
    const version = (previous?.version ?? 0) + 1;

    let quoteNumber: string;
    // The version follows from the deal either way; the number can only follow
    // if the previous quotation actually has one to continue. Being unable to
    // raise a quotation at all is a far worse outcome than a fresh number.
    if (previous?.quoteNumber) {
      quoteNumber = `${previous.quoteNumber.replace(/-R\d+$/, '')}-R${version}`;
    } else {
      quoteNumber = await this.nextQuotationNumber(companyId);
    }

    // Check if total requires approval (e.g. > 10,000)
    let approvalStatus = 'APPROVED';
    let status = 'DRAFT';
    if (total > 10000) {
      approvalStatus = 'PENDING';
      status = 'PENDING_APPROVAL';
    }

    const created = await this.prisma.quotation.create({
      data: {
        ...quoteData,
        quoteNumber,
        version,
        revisionOfId: previous?.id ?? null,
        companyId,
        subtotal,
        taxRate,
        tax,
        total,
        status,
        approvalStatus,
        items: {
          create: items,
        },
        ...(Array.isArray(attachments) && attachments.length
          ? {
              attachments: {
                create: attachments.map((a: any) => ({
                  fileName: a.fileName || 'attachment',
                  fileUrl: a.fileUrl,
                  fileSize: a.fileSize ? Number(a.fileSize) : null,
                })),
              },
            }
          : {}),
      },
      include: { items: true, client: true, attachments: true }
    });

    // Crossing the approval threshold silently parked the quote in a queue with
    // no alert — the salesperson would wait on an approver who never knew.
    if (approvalStatus === 'PENDING') {
      await this.notificationsService
        .notifyApprovers({
          companyId,
          roles: ['SUPERADMIN', 'ADMIN', 'FINANCE'],
          excludeUserId: userId,
          title: 'Quotation Awaiting Approval',
          message: `${created.quoteNumber} for ${created.client?.name ?? created.billingCompanyName ?? 'a deal'} totals ${total.toFixed(2)} and needs approval.`,
          type: 'ACTION_REQUIRED',
          linkUrl: '/sales/quotations',
        })
        .catch(() => { /* the quote is saved; the alert is best-effort */ });
    }

    return created;
  }

  async getQuotations(companyId: number) {
    return this.prisma.quotation.findMany({
      where: { companyId },
      include: {
        client: true,
        // A quote raised against a deal may have no client, and the list has to
        // show something. Selected narrowly rather than `lead: true`, which
        // would ship the whole lead row per quotation.
        lead: { select: { id: true, title: true, companyName: true } },
        items: true,
        attachments: true,
        approvedBy: { select: { employee: { select: { firstName: true, lastName: true } } } }
      },
      orderBy: { date: 'desc' }
    });
  }

  async approveQuotation(companyId: number, quoteId: number, userId: number) {
    const quote = await this.prisma.quotation.findFirst({ where: { id: quoteId, companyId } });
    if (!quote) throw new NotFoundException('Quotation not found');

    return this.prisma.quotation.update({
      where: { id: quoteId },
      data: {
        approvalStatus: 'APPROVED',
        status: 'DRAFT', // Moved back to DRAFT or SENT so it can be acted upon
        approvedById: userId
      }
    });
  }

  // ================= SALES ORDERS =================

  async convertQuoteToOrder(companyId: number, quoteId: number) {
    const quote = await this.prisma.quotation.findFirst({ 
      where: { id: quoteId, companyId },
      include: { items: true } 
    });
    
    if (!quote) throw new NotFoundException('Quotation not found');
    if (quote.approvalStatus === 'PENDING' || quote.approvalStatus === 'REJECTED') {
      throw new BadRequestException('Cannot convert a quotation that is not approved');
    }

    // Update Quote status
    await this.prisma.quotation.update({
      where: { id: quoteId },
      data: { status: 'ACCEPTED' }
    });

    // Generate Sales Order.
    //
    // Quotations may now belong to a deal with no client, but an order is a
    // commitment against a party, so SalesOrder.clientId stays required. Say
    // what to do about it rather than letting Prisma throw a null violation.
    if (!quote.clientId) {
      throw new BadRequestException(
        'This quotation belongs to a deal with no client record. Link a client to the deal before converting it to a sales order.',
      );
    }

    return this.prisma.salesOrder.create({
      data: {
        orderNumber: `SO-${Date.now().toString().slice(-6)}`,
        quotationId: quote.id,
        clientId: quote.clientId,
        date: new Date(),
        total: quote.total,
        currency: quote.currency,
        status: 'CONFIRMED',
        companyId,
        items: {
          create: quote.items.map(item => ({
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total
          }))
        }
      },
      include: { items: true, client: true }
    });
  }

  /**
   * Quotation status moves. The model documents five states but only DRAFT,
   * PENDING_APPROVAL and ACCEPTED were ever set — SENT and REJECTED were
   * unreachable, so a quote could not be marked as sent or declined.
   *
   * ACCEPTED is terminal: it means an order exists. Correcting an accepted
   * quote is a new quote, not an edit.
   */
  private static readonly QUOTE_STATUS_FLOW: Record<string, string[]> = {
    DRAFT: ['SENT', 'REJECTED'],
    PENDING_APPROVAL: ['SENT', 'REJECTED'],
    SENT: ['ACCEPTED', 'REJECTED'],
    REJECTED: ['DRAFT'],
    ACCEPTED: [],
    // Terminal. A superseded quotation is history: the version that replaced it
    // is the one that moves.
    SUPERSEDED: [],
  };

  /**
   * Statuses whose line items and totals may still be corrected.
   *
   * SENT is deliberately absent. Once a quotation has gone to the client they
   * are holding that document; editing the row in place makes the record
   * disagree with their copy and nobody finds out. A correction is a new
   * version — see reviseQuotation.
   */
  private static readonly QUOTE_EDITABLE = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED'];

  /** Statuses a new version can be raised from. */
  private static readonly QUOTE_REVISABLE = ['SENT', 'REJECTED'];

  private async findQuotation(companyId: number, quoteId: number) {
    const quote = await this.prisma.quotation.findFirst({ where: { id: quoteId, companyId } });
    if (!quote) throw new NotFoundException('Quotation not found');
    return quote;
  }

  async updateQuotationStatus(companyId: number, quoteId: number, status: string) {
    const quote = await this.findQuotation(companyId, quoteId);

    const allowed = SalesService.QUOTE_STATUS_FLOW[quote.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        allowed.length
          ? `A ${quote.status} quotation can only move to ${allowed.join(' or ')}.`
          : `A ${quote.status} quotation is final and cannot be changed.`,
      );
    }

    return this.prisma.quotation.update({
      where: { id: quoteId },
      data: { status },
      include: { client: true, items: true },
    });
  }

  /**
   * Rewrites a quotation's line items and recalculates totals. Items are
   * replaced wholesale rather than diffed — a quote is a snapshot, and
   * reconciling partial edits would risk totals drifting from the lines.
   */
  async updateQuotation(companyId: number, quoteId: number, data: any) {
    const quote = await this.findQuotation(companyId, quoteId);

    if (!SalesService.QUOTE_EDITABLE.includes(quote.status)) {
      throw new BadRequestException(
        `A ${quote.status} quotation cannot be edited. Raise a new quotation instead.`,
      );
    }

    const { items, attachments, ...quoteData } = data;
    if (quoteData.date) quoteData.date = new Date(quoteData.date);
    if (quoteData.validUntil) quoteData.validUntil = new Date(quoteData.validUntil);

    // Never let the client dictate identity or derived money fields.
    delete quoteData.id;
    delete quoteData.quoteNumber;
    delete quoteData.companyId;
    delete quoteData.subtotal;
    delete quoteData.tax;
    delete quoteData.total;
    delete quoteData.status;
    delete quoteData.approvalStatus;

    const updateData: any = { ...quoteData };

    if (Array.isArray(items)) {
      this.assertItemsPriced(items);

      let subtotal = 0;
      const priced = items.map((i: any) => {
        const total = Number(i.quantity) * Number(i.unitPrice);
        subtotal += total;
        return { ...i, total };
      });

      const taxRate = Number(data.taxRate ?? quote.taxRate ?? 18);
      const tax = subtotal * (taxRate / 100);

      updateData.subtotal = subtotal;
      updateData.taxRate = taxRate;
      updateData.tax = tax;
      updateData.total = subtotal + tax;
      updateData.items = { deleteMany: {}, create: priced };
    }

    // Attachments were destructured out of the payload here and then never
    // used, so anything uploaded while editing was silently dropped on save.
    //
    // Reconciled rather than replaced wholesale: the client sends the full
    // list, existing rows carrying their id and new ones not. Deleting and
    // recreating the lot would work but would reset createdAt on files that
    // never moved, and churn ids the UI may already be holding.
    if (Array.isArray(attachments)) {
      const keptIds = attachments
        .map((a: any) => Number(a?.id))
        .filter((id: number) => Number.isFinite(id) && id > 0);

      const added = attachments
        .filter((a: any) => !(Number(a?.id) > 0) && a?.fileUrl)
        .map((a: any) => ({
          fileName: a.fileName || 'attachment',
          fileUrl: a.fileUrl,
          fileSize: a.fileSize ? Number(a.fileSize) : null,
        }));

      updateData.attachments = {
        // Anything the payload no longer names has been removed in the form.
        deleteMany: keptIds.length ? { id: { notIn: keptIds } } : {},
        ...(added.length ? { create: added } : {}),
      };
    }

    return this.prisma.quotation.update({
      where: { id: quoteId },
      data: updateData,
      include: { client: true, items: true, attachments: true },
    });
  }

  /**
   * Raise the next version of a deal's proposal.
   *
   * Copies the frozen quotation wholesale — lines, bill-to, terms, tax,
   * attachments — into a fresh DRAFT, and marks the original SUPERSEDED so the
   * pipeline does not show two live quotes for one deal.
   *
   * The quote number is kept and suffixed (3111-59710474 → -R2) so the client
   * sees a revision of the document they already hold rather than an unrelated
   * one. The version is the next ordinal on the deal, which is what "each new
   * proposal is a new version of the previous one" means in practice.
   */
  async reviseQuotation(companyId: number, quoteId: number) {
    const source = await this.prisma.quotation.findFirst({
      where: { id: quoteId, companyId },
      include: { items: true, attachments: true },
    });
    if (!source) throw new NotFoundException('Quotation not found');

    if (!SalesService.QUOTE_REVISABLE.includes(source.status)) {
      throw new BadRequestException(
        source.status === 'DRAFT' || source.status === 'PENDING_APPROVAL'
          ? 'This quotation has not gone to the client yet — edit it directly instead of versioning it.'
          : source.status === 'SUPERSEDED'
            ? 'This version has already been replaced. Raise the new version from the current one.'
            : 'An accepted quotation has become an order and cannot be revised.',
      );
    }

    // Scope by deal where there is one. A quote raised straight from Sales has
    // no lead, so its chain is the only thing that can define "next".
    const siblings = source.leadId
      ? await this.prisma.quotation.findMany({
          where: { companyId, leadId: source.leadId },
          select: { version: true },
        })
      : [{ version: source.version }];
    const nextVersion = Math.max(...siblings.map((q) => q.version ?? 1)) + 1;

    // Strip any existing suffix first, so v3 is -R3 and never -R2-R3.
    const baseNumber = source.quoteNumber.replace(/-R\d+$/, '');

    // Keep the validity window the client was given rather than inventing one.
    const windowMs = new Date(source.validUntil).getTime() - new Date(source.date).getTime();
    const date = new Date();
    const validUntil = new Date(date.getTime() + (Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 30 * 24 * 60 * 60 * 1000));

    const {
      id: _id, quoteNumber: _qn, version: _v, revisionOfId: _r, status: _s, approvalStatus: _as,
      approvedById: _ab, createdAt: _c, updatedAt: _u, items, attachments, ...carried
    } = source as any;

    const [revision] = await this.prisma.$transaction([
      this.prisma.quotation.create({
        data: {
          ...carried,
          quoteNumber: `${baseNumber}-R${nextVersion}`,
          version: nextVersion,
          revisionOfId: source.id,
          status: 'DRAFT',
          approvalStatus: 'APPROVED',
          date,
          validUntil,
          items: {
            create: items.map(({ id, quotationId, ...i }: any) => i),
          },
          ...(attachments.length
            ? { attachments: { create: attachments.map(({ id, quotationId, createdAt, ...a }: any) => a) } }
            : {}),
        },
        include: { items: true, attachments: true, client: true },
      }),
      this.prisma.quotation.update({
        where: { id: source.id },
        data: { status: 'SUPERSEDED' },
      }),
    ]);

    return revision;
  }

  async deleteQuotation(companyId: number, quoteId: number) {
    const quote = await this.findQuotation(companyId, quoteId);

    // A converted quote is the paper trail behind a real order.
    const orderCount = await this.prisma.salesOrder.count({ where: { quotationId: quoteId } });
    if (quote.status === 'ACCEPTED' || orderCount > 0) {
      throw new BadRequestException(
        'This quotation has been converted to an order and cannot be deleted.',
      );
    }

    await this.prisma.quotation.delete({ where: { id: quoteId } });
    return { success: true };
  }

  async getSalesOrders(companyId: number, isRental?: boolean) {
    const whereClause: any = { companyId };
    if (isRental !== undefined) {
      whereClause.isRental = isRental;
    }

    const orders = await this.prisma.salesOrder.findMany({
      where: whereClause,
      include: { client: true, items: true },
      orderBy: { date: 'desc' }
    });

    // OVERDUE is a function of the end date, so derive it on read instead of
    // relying on a scheduled job to stamp every rental at the right moment.
    const now = new Date();
    return orders.map((o) => {
      const overdue =
        o.isRental && o.rentalStatus === 'ACTIVE' && o.rentalEndDate && o.rentalEndDate < now;
      return overdue ? { ...o, rentalStatus: 'OVERDUE' } : o;
    });
  }

  /**
   * Allowed order status moves. Orders are created CONFIRMED (quotation
   * conversion) or DELIVERED (POS), and previously had no way to move at all —
   * the four states the schema and UI both model were unreachable.
   *
   * DELIVERED and CANCELLED are terminal: a delivered order is done, and
   * reviving a cancelled one would leave its stock/invoice side effects
   * ambiguous. Reversing either is a new order, not a status flip.
   */
  private static readonly ORDER_STATUS_FLOW: Record<string, string[]> = {
    DRAFT: ['CONFIRMED', 'CANCELLED'],
    PENDING_APPROVAL: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['DELIVERED', 'CANCELLED'],
    DELIVERED: [],
    CANCELLED: [],
  };

  async updateOrderStatus(companyId: number, orderId: number, status: string) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, companyId } });
    if (!order) throw new NotFoundException('Sales order not found');

    const allowed = SalesService.ORDER_STATUS_FLOW[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        allowed.length
          ? `A ${order.status} order can only move to ${allowed.join(' or ')}.`
          : `A ${order.status} order is final and cannot be changed.`,
      );
    }

    return this.prisma.salesOrder.update({
      where: { id: orderId },
      data: {
        status,
        // Delivering a rental starts its hire period; cancelling ends any claim.
        ...(order.isRental && status === 'DELIVERED' ? { rentalStatus: 'ACTIVE' } : {}),
        ...(status === 'CANCELLED' ? { rentalStatus: null } : {}),
      },
      include: { client: true, items: true },
    });
  }

  /** Marks a rented order as returned, closing its hire period. */
  async returnRental(companyId: number, orderId: number) {
    const order = await this.prisma.salesOrder.findFirst({ where: { id: orderId, companyId } });
    if (!order) throw new NotFoundException('Sales order not found');
    if (!order.isRental) throw new BadRequestException('This order is not a rental');
    if (order.rentalStatus === 'RETURNED') throw new BadRequestException('This rental is already returned');

    return this.prisma.salesOrder.update({
      where: { id: orderId },
      data: { rentalStatus: 'RETURNED' },
      include: { client: true, items: true },
    });
  }

  // ================= POS / QUICK CHECKOUT =================
  
  async createPosCheckout(companyId: number, data: any) {
    const { items, clientId, ...orderData } = data;
    
    // Quick calculate total
    let total = 0;
    const orderItems = items.map(item => {
      const itemTotal = item.quantity * item.unitPrice;
      total += itemTotal;
      return { ...item, total: itemTotal };
    });

    return this.prisma.salesOrder.create({
      data: {
        ...orderData,
        orderNumber: `POS-${Date.now().toString().slice(-6)}`,
        clientId, // Walk-in customer or existing client
        date: new Date(),
        total,
        status: 'DELIVERED', // Instant delivery in POS
        companyId,
        items: {
          create: orderItems
        }
      },
      include: { items: true }
    });
  }

  // ================= DASHBOARD =================

  async getDashboardSummary(companyId: number) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [pendingQuotationApprovals, ordersAgg, quotationsByStatus] = await Promise.all([
      this.prisma.quotation.count({ where: { companyId, approvalStatus: 'PENDING' } }),
      this.prisma.salesOrder.aggregate({
        where: { companyId, date: { gte: startOfMonth, lt: startOfNextMonth } },
        _sum: { total: true },
        _count: true
      }),
      this.prisma.quotation.groupBy({
        by: ['status'],
        where: { companyId },
        _count: true
      })
    ]);

    return {
      pendingQuotationApprovals,
      ordersThisMonth: { count: ordersAgg._count, totalValue: ordersAgg._sum.total || 0 },
      quotationsByStatus
    };
  }
}
