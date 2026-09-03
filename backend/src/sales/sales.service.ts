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

  async createQuotation(companyId: number, data: any, userId: number) {
    const { items, attachments, ...quoteData } = data;

    // Convert date strings to DateTime
    if (quoteData.date && typeof quoteData.date === 'string') {
      quoteData.date = new Date(quoteData.date);
    }
    if (quoteData.validUntil && typeof quoteData.validUntil === 'string') {
      quoteData.validUntil = new Date(quoteData.validUntil);
    }

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

    const quoteNumber = `QT-${Date.now().toString().slice(-8)}`;

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
          message: `${created.quoteNumber} for ${created.client?.name ?? 'a client'} totals ${total.toFixed(2)} and needs approval.`,
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

    // Generate Sales Order
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
  };

  /** Statuses whose line items and totals may still be corrected. */
  private static readonly QUOTE_EDITABLE = ['DRAFT', 'PENDING_APPROVAL', 'SENT', 'REJECTED'];

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
      if (!items.length) throw new BadRequestException('A quotation needs at least one line item');

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

    return this.prisma.quotation.update({
      where: { id: quoteId },
      data: updateData,
      include: { client: true, items: true },
    });
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
