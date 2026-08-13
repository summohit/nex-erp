import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  // ================= QUOTATIONS =================

  async createQuotation(companyId: number, data: any, userId: number) {
    const { items, ...quoteData } = data;
    
    // Auto-calculate subtotal, tax, total
    let subtotal = 0;
    items.forEach(item => {
      item.total = item.quantity * item.unitPrice;
      subtotal += item.total;
    });
    
    const tax = subtotal * 0.10; // Simple 10% tax for now, could be dynamic
    const total = subtotal + tax;

    // Check if total requires approval (e.g. > $10,000)
    let approvalStatus = 'APPROVED';
    let status = 'DRAFT';
    if (total > 10000) {
      approvalStatus = 'PENDING';
      status = 'PENDING_APPROVAL';
    }

    return this.prisma.quotation.create({
      data: {
        ...quoteData,
        companyId,
        subtotal,
        tax,
        total,
        status,
        approvalStatus,
        items: {
          create: items,
        }
      },
      include: { items: true, client: true }
    });
  }

  async getQuotations(companyId: number) {
    return this.prisma.quotation.findMany({
      where: { companyId },
      include: {
        client: true,
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

    return this.prisma.salesOrder.findMany({
      where: whereClause,
      include: { client: true },
      orderBy: { date: 'desc' }
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
}
