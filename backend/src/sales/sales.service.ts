import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

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

    return this.prisma.quotation.create({
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
