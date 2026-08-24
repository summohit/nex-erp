import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  // ==========================================
  // 1. ASSET INVENTORY
  // ==========================================
  async getAllAssets(companyId: number) {
    const assets = await this.prisma.asset.findMany({
      where: { companyId },
      include: {
        assignments: {
          where: { status: 'ACTIVE' },
          include: {
            employee: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                department: { select: { name: true } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return assets.map(a => ({
      ...a,
      images: a.images ? (typeof a.images === 'string' && a.images.startsWith('[') ? JSON.parse(a.images) : [a.images]) : [],
      tags: a.tags ? (a.tags.startsWith('[') ? JSON.parse(a.tags) : [a.tags]) : []
    }));
  }

  private readonly standardCategories = ['LAPTOP', 'DESKTOP', 'MONITOR', 'PERIPHERAL', 'SOFTWARE', 'MOBILE'];

  async getCategories(companyId: number) {
    const distinctRows = await this.prisma.asset.findMany({
      where: { companyId },
      select: { category: true },
      distinct: ['category']
    });
    const custom = distinctRows
      .map(r => r.category)
      .filter(c => c && !this.standardCategories.includes(c));

    return [...this.standardCategories, ...custom];
  }

  async createAsset(companyId: number, data: any) {
    let assetTag = data.assetTag ? String(data.assetTag).trim() : '';
    if (!assetTag) {
      const count = await this.prisma.asset.count({ where: { companyId } });
      const year = new Date().getFullYear();
      assetTag = `AST-${year}-${(count + 1).toString().padStart(3, '0')}`;
    }

    const existing = await this.prisma.asset.findFirst({
      where: { companyId, assetTag: { equals: assetTag, mode: 'insensitive' } }
    });
    if (existing) {
      throw new BadRequestException('Asset tag must be unique');
    }

    const imagesStr = Array.isArray(data.images) ? JSON.stringify(data.images) : (data.images || null);
    const tagsStr = Array.isArray(data.tags) ? JSON.stringify(data.tags) : (data.tags || null);

    const asset = await this.prisma.asset.create({
      data: {
        companyId,
        assetTag,
        name: data.name,
        category: data.category || 'LAPTOP',
        quantity: data.quantity ? parseInt(data.quantity, 10) : 1,
        brand: data.brand,
        model: data.model,
        serialNumber: data.serialNumber,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        cost: data.cost ? parseFloat(data.cost) : null,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : null,
        images: imagesStr,
        location: data.location || null,
        notes: data.notes || null,
        tags: tagsStr,
        status: data.status || 'AVAILABLE',
        ram: data.ram,
        storage: data.storage,
        processor: data.processor
      }
    });

    return {
      ...asset,
      images: asset.images ? (asset.images.startsWith('[') ? JSON.parse(asset.images) : [asset.images]) : [],
      tags: asset.tags ? (asset.tags.startsWith('[') ? JSON.parse(asset.tags) : [asset.tags]) : []
    };
  }

  async updateAsset(companyId: number, id: number, data: any) {
    const asset = await this.prisma.asset.findFirst({ where: { id, companyId } });
    if (!asset) throw new NotFoundException('Asset not found');

    let assetTag = data.assetTag !== undefined && data.assetTag !== null && data.assetTag !== ''
      ? String(data.assetTag).trim()
      : asset.assetTag;

    if (assetTag !== asset.assetTag) {
      const existing = await this.prisma.asset.findFirst({
        where: { companyId, assetTag: { equals: assetTag, mode: 'insensitive' }, NOT: { id } }
      });
      if (existing) {
        throw new BadRequestException('Asset tag must be unique');
      }
    }

    const imagesStr = Array.isArray(data.images) ? JSON.stringify(data.images) : (data.images !== undefined ? data.images : undefined);
    const tagsStr = Array.isArray(data.tags) ? JSON.stringify(data.tags) : (data.tags !== undefined ? data.tags : undefined);

    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        assetTag,
        name: data.name,
        category: data.category,
        quantity: data.quantity !== undefined && data.quantity !== null && data.quantity !== '' ? parseInt(data.quantity, 10) : undefined,
        brand: data.brand,
        model: data.model,
        serialNumber: data.serialNumber,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        cost: data.cost ? parseFloat(data.cost) : undefined,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : undefined,
        images: imagesStr,
        location: data.location !== undefined ? data.location : undefined,
        notes: data.notes !== undefined ? data.notes : undefined,
        tags: tagsStr,
        status: data.status,
        ram: data.ram,
        storage: data.storage,
        processor: data.processor
      }
    });

    return {
      ...updated,
      images: updated.images ? (updated.images.startsWith('[') ? JSON.parse(updated.images) : [updated.images]) : [],
      tags: updated.tags ? (updated.tags.startsWith('[') ? JSON.parse(updated.tags) : [updated.tags]) : []
    };
  }

  async deleteAsset(companyId: number, id: number) {
    const asset = await this.prisma.asset.findFirst({ where: { id, companyId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const activeAssignments = await this.prisma.assetAssignment.findMany({
      where: { assetId: id, companyId, status: 'ACTIVE' }
    });
    if (activeAssignments.length > 0) {
      throw new BadRequestException('Deletion blocked due to active assignment. Must archive or return first.');
    }

    return this.prisma.asset.delete({ where: { id } });
  }

  // ==========================================
  // 2. ASSET ASSIGNMENTS
  // ==========================================
  async getAssignments(companyId: number) {
    return this.prisma.assetAssignment.findMany({
      where: { companyId },
      include: {
        asset: true,
        employee: {
          include: {
            department: true,
            designation: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async assignAsset(companyId: number, data: { assetId: number; employeeId: number; assignedDate?: string; conditionOnAssign?: string; notes?: string }) {
    const asset = await this.prisma.asset.findFirst({ where: { id: data.assetId, companyId } });
    if (!asset) throw new NotFoundException('Asset not found');

    const employee = await this.prisma.employee.findFirst({ where: { id: data.employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    // Create Assignment
    const assignment = await this.prisma.assetAssignment.create({
      data: {
        companyId,
        assetId: data.assetId,
        employeeId: data.employeeId,
        assignedDate: data.assignedDate ? new Date(data.assignedDate) : new Date(),
        conditionOnAssign: data.conditionOnAssign || 'GOOD',
        notes: data.notes,
        status: 'ACTIVE'
      }
    });

    // Update Asset Status to ASSIGNED
    await this.prisma.asset.update({
      where: { id: data.assetId },
      data: { status: 'ASSIGNED' }
    });

    return assignment;
  }

  async returnAsset(companyId: number, id: number, data: { returnDate?: string; conditionOnReturn?: string; assetNextStatus?: string; notes?: string }) {
    const assignment = await this.prisma.assetAssignment.findFirst({ where: { id, companyId } });
    if (!assignment) throw new NotFoundException('Assignment record not found');

    const nextStatus = data.assetNextStatus || (data.conditionOnReturn === 'NEEDS_REPAIR' ? 'IN_REPAIR' : 'AVAILABLE');

    // Mark Assignment as Returned
    const updatedAssignment = await this.prisma.assetAssignment.update({
      where: { id },
      data: {
        status: 'RETURNED',
        returnDate: data.returnDate ? new Date(data.returnDate) : new Date(),
        conditionOnReturn: data.conditionOnReturn || 'GOOD',
        notes: data.notes ? `${assignment.notes || ''}\n[Return Notes]: ${data.notes}` : assignment.notes
      }
    });

    // Update Asset status back to AVAILABLE or IN_REPAIR
    await this.prisma.asset.update({
      where: { id: assignment.assetId },
      data: { status: nextStatus }
    });

    return updatedAssignment;
  }

  // ==========================================
  // 3. HARDWARE REQUESTS
  // ==========================================
  async getHardwareRequests(companyId: number, userId?: number, userRole?: string) {
    const isPrivileged = userRole === 'SUPERADMIN' || userRole === 'ADMIN' || userRole === 'HR';

    let whereClause: any = { companyId };
    if (!isPrivileged && userId) {
      const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
      if (employee) {
        whereClause.employeeId = employee.id;
      }
    }

    return this.prisma.hardwareRequest.findMany({
      where: whereClause,
      include: {
        employee: {
          include: {
            department: true,
            designation: true
          }
        },
        fulfilledAsset: true,
        approvedBy: {
          include: {
            employee: {
              select: { firstName: true, lastName: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async createHardwareRequest(companyId: number, userId: number, data: { requestType: string; category: string; urgency: string; reason: string; images?: string[] }) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee profile not found');

    const imagesStr = data.images && data.images.length > 0 ? (Array.isArray(data.images) ? JSON.stringify(data.images) : data.images) : null;

    return this.prisma.hardwareRequest.create({
      data: {
        companyId,
        employeeId: employee.id,
        requestType: data.requestType || 'NEW_DEVICE',
        category: data.category || 'LAPTOP',
        urgency: data.urgency || 'MEDIUM',
        reason: data.reason,
        images: imagesStr,
        status: 'PENDING'
      }
    });
  }

  async updateHardwareRequest(companyId: number, id: number, userId: number, data: { requestType?: string; category?: string; urgency?: string; reason?: string; images?: string[] }) {
    const request = await this.prisma.hardwareRequest.findFirst({
      where: { id, companyId },
      include: { employee: true }
    });
    if (!request) throw new NotFoundException('Hardware request not found');

    if (request.employee.userId !== userId) {
      throw new ForbiddenException('You can only edit your own hardware request');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be edited');
    }

    const imagesStr = data.images && data.images.length > 0 ? (Array.isArray(data.images) ? JSON.stringify(data.images) : data.images) : null;

    return this.prisma.hardwareRequest.update({
      where: { id },
      data: {
        requestType: data.requestType || request.requestType,
        category: data.category || request.category,
        urgency: data.urgency || request.urgency,
        reason: data.reason || request.reason,
        images: imagesStr
      }
    });
  }

  async cancelHardwareRequest(companyId: number, id: number, userId: number) {
    const request = await this.prisma.hardwareRequest.findFirst({
      where: { id, companyId },
      include: { employee: true }
    });
    if (!request) throw new NotFoundException('Hardware request not found');

    if (request.employee.userId !== userId) {
      throw new ForbiddenException('You can only cancel your own hardware request');
    }

    if (request.status !== 'PENDING') {
      throw new BadRequestException('Only pending requests can be cancelled');
    }

    return this.prisma.hardwareRequest.delete({ where: { id } });
  }

  async updateHardwareRequestStatus(companyId: number, id: number, userId: number, userRole: string, data: { status: string; rejectionReason?: string; fulfilledAssetId?: number }) {
    const request = await this.prisma.hardwareRequest.findFirst({ 
      where: { id, companyId },
      include: { employee: true }
    });
    if (!request) throw new NotFoundException('Hardware request not found');

    if (request.employee.userId === userId && userRole !== 'SUPERADMIN') {
      throw new ForbiddenException('You cannot approve or reject your own hardware request');
    }

    if (data.status === 'REJECTED' && data.rejectionReason && data.rejectionReason.length > 100) {
      throw new BadRequestException('Rejection reason cannot exceed 100 characters');
    }

    const updated = await this.prisma.hardwareRequest.update({
      where: { id },
      data: {
        status: data.status,
        rejectionReason: data.rejectionReason,
        fulfilledAssetId: data.fulfilledAssetId || null,
        approvedById: userId
      }
    });

    // If FULFILLED and asset selected, automatically assign asset to requesting employee
    if (data.status === 'FULFILLED' && data.fulfilledAssetId) {
      await this.assignAsset(companyId, {
        assetId: data.fulfilledAssetId,
        employeeId: request.employeeId,
        conditionOnAssign: 'GOOD',
        notes: `Fulfilled via Hardware Request #${request.id}`
      });
    }

    return updated;
  }

  // ==========================================
  // 4. PRODUCT/BATCH INVENTORY (transaction-based)
  // ==========================================

  private parseDate(value: any): Date | null {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  private toInt(value: any, fallback = 0): number {
    const n = parseInt(value, 10);
    return isNaN(n) ? fallback : n;
  }

  private toFloat(value: any, fallback = 0): number {
    const n = parseFloat(value);
    return isNaN(n) ? fallback : n;
  }

  private computeMetrics(item: { quantity: number }, txns: { type: string; quantity: number }[]) {
    let grossAssigned = 0, returned = 0, consumed = 0, expired = 0;
    for (const t of txns) {
      switch (t.type) {
        case 'ASSIGNMENT': grossAssigned += t.quantity; break;
        case 'RETURN': returned += t.quantity; break;
        case 'CONSUMPTION': consumed += t.quantity; break;
        case 'EXPIRED': expired += t.quantity; break;
      }
    }
    const netAssigned = Math.max(0, grossAssigned - returned);
    const available = Math.max(0, item.quantity - netAssigned - consumed - expired);
    return { grossAssigned, netAssigned, returned, consumed, expired, available };
  }

  private deriveStatus(item: { status: string; expiryDate?: Date | null; itemType: string; quantity: number }, m: ReturnType<AssetsService['computeMetrics']>) {
    if (item.status === 'IN_REPAIR') return 'Under Repair';
    if (item.status === 'RETIRED') return 'Retired';

    if (item.itemType === 'CONSUMABLE' && item.expiryDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (new Date(item.expiryDate) < today && m.available > 0) return 'Expired';
    }
    if (m.available <= 0) return m.netAssigned > 0 ? 'Fully Assigned' : 'Out of Stock';
    if (m.netAssigned > 0) return 'Partially Assigned';
    return 'In Stock';
  }

  private decorateItem(item: any, txns: { type: string; quantity: number }[]) {
    const metrics = this.computeMetrics(item, txns);
    const lowStockThreshold = Math.max(1, Math.ceil(item.quantity * 0.2));
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const in30Days = new Date(today); in30Days.setDate(in30Days.getDate() + 30);

    return {
      ...item,
      ...metrics,
      totalValue: (item.quantity || 0) * (item.unitCost || 0),
      statusLabel: this.deriveStatus(item, metrics),
      lowStock: item.status === 'ACTIVE' && metrics.available > 0 && metrics.available <= lowStockThreshold,
      expiringSoon:
        item.itemType === 'CONSUMABLE' &&
        !!item.expiryDate &&
        new Date(item.expiryDate) >= today &&
        new Date(item.expiryDate) <= in30Days
    };
  }

  async getInventoryItems(companyId: number) {
    const [items, txns] = await Promise.all([
      this.prisma.inventoryItem.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.inventoryTransaction.findMany({
        where: { companyId, type: { in: ['ASSIGNMENT', 'RETURN', 'CONSUMPTION', 'EXPIRED'] } },
        select: { itemId: true, type: true, quantity: true }
      })
    ]);

    const byItem = new Map<number, { type: string; quantity: number }[]>();
    for (const t of txns) {
      if (!byItem.has(t.itemId)) byItem.set(t.itemId, []);
      byItem.get(t.itemId)!.push(t);
    }

    return items.map(item => this.decorateItem(item, byItem.get(item.id) || []));
  }

  async createInventoryItem(companyId: number, userId: number, data: any) {
    if (!data.name || !String(data.name).trim()) throw new BadRequestException('Item name is required');

    const quantity = this.toInt(data.quantity, 0);
    if (quantity < 0) throw new BadRequestException('Quantity cannot be negative');

    const unitCost = this.toFloat(data.unitCost, 0);
    if (unitCost < 0) throw new BadRequestException('Unit cost cannot be negative');

    const purchaseDate = this.parseDate(data.purchaseDate);
    const expiryDate = this.parseDate(data.expiryDate);
    const warrantyExpiry = this.parseDate(data.warrantyExpiry);

    const item = await this.prisma.inventoryItem.create({
      data: {
        companyId,
        name: String(data.name).trim(),
        brand: data.brand || null,
        category: data.category || 'OTHER',
        itemType: data.itemType === 'ASSET' ? 'ASSET' : 'CONSUMABLE',
        unit: data.unit || 'units',
        quantity,
        unitCost,
        purchaseDate,
        supplier: data.supplier || null,
        batchNumber: data.batchNumber || null,
        expiryDate,
        location: data.location || null,
        model: data.model || null,
        serialNumber: data.serialNumber || null,
        warrantyExpiry,
        notes: data.notes || null,
        status: 'ACTIVE'
      }
    });

    await this.prisma.inventoryTransaction.create({
      data: {
        companyId,
        itemId: item.id,
        type: 'PURCHASE',
        quantity,
        date: purchaseDate || new Date(),
        assigneeText: data.supplier ? `Vendor: ${data.supplier}` : null,
        purpose: 'Initial Purchase',
        createdById: userId
      }
    });

    return item;
  }

  async updateInventoryItem(companyId: number, id: number, data: any) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
    if (!item) throw new NotFoundException('Inventory item not found');

    // Quantity is intentionally not editable here - stock changes must go through transactions
    return this.prisma.inventoryItem.update({
      where: { id },
      data: {
        name: data.name !== undefined ? String(data.name).trim() : undefined,
        brand: data.brand !== undefined ? (data.brand || null) : undefined,
        category: data.category !== undefined ? data.category : undefined,
        itemType: data.itemType !== undefined ? (data.itemType === 'ASSET' ? 'ASSET' : 'CONSUMABLE') : undefined,
        unit: data.unit !== undefined ? (data.unit || 'units') : undefined,
        unitCost: data.unitCost !== undefined ? this.toFloat(data.unitCost, item.unitCost) : undefined,
        purchaseDate: data.purchaseDate !== undefined ? this.parseDate(data.purchaseDate) : undefined,
        supplier: data.supplier !== undefined ? (data.supplier || null) : undefined,
        batchNumber: data.batchNumber !== undefined ? (data.batchNumber || null) : undefined,
        expiryDate: data.expiryDate !== undefined ? this.parseDate(data.expiryDate) : undefined,
        location: data.location !== undefined ? (data.location || null) : undefined,
        model: data.model !== undefined ? (data.model || null) : undefined,
        serialNumber: data.serialNumber !== undefined ? (data.serialNumber || null) : undefined,
        warrantyExpiry: data.warrantyExpiry !== undefined ? this.parseDate(data.warrantyExpiry) : undefined,
        notes: data.notes !== undefined ? (data.notes || null) : undefined
      }
    });
  }

  async setInventoryItemStatus(companyId: number, id: number, status: string) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
    if (!item) throw new NotFoundException('Inventory item not found');
    if (!['ACTIVE', 'IN_REPAIR', 'RETIRED'].includes(status)) throw new BadRequestException('Invalid status');
    return this.prisma.inventoryItem.update({ where: { id }, data: { status } });
  }

  async deleteInventoryItem(companyId: number, id: number) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id, companyId } });
    if (!item) throw new NotFoundException('Inventory item not found');

    const txns = await this.prisma.inventoryTransaction.findMany({
      where: { itemId: id, type: { in: ['ASSIGNMENT', 'RETURN', 'CONSUMPTION', 'EXPIRED'] } },
      select: { type: true, quantity: true }
    });
    const m = this.computeMetrics(item, txns);
    if (m.netAssigned > 0) {
      throw new BadRequestException(`Cannot delete "${item.name}": ${m.netAssigned} unit(s) are still assigned. Record returns first.`);
    }

    return this.prisma.inventoryItem.delete({ where: { id } });
  }

  async getInventoryTransactions(companyId: number, itemId: number) {
    const item = await this.prisma.inventoryItem.findFirst({ where: { id: itemId, companyId } });
    if (!item) throw new NotFoundException('Inventory item not found');

    return this.prisma.inventoryTransaction.findMany({
      where: { itemId, companyId },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, email: true, role: true } },
        linkedReturns: { select: { id: true, quantity: true } }
      }
    });
  }

  async getInventoryAssignments(companyId: number) {
    return this.prisma.inventoryTransaction.findMany({
      where: { companyId, type: 'ASSIGNMENT' },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      include: {
        item: { select: { id: true, name: true, category: true, unit: true, itemType: true } },
        employee: {
          select: {
            id: true, firstName: true, lastName: true,
            department: { select: { name: true } }
          }
        },
        createdBy: { select: { id: true, email: true, role: true } },
        linkedReturns: { select: { id: true, quantity: true } }
      }
    });
  }

  async assignInventoryItem(companyId: number, userId: number, itemId: number, data: any) {
    const qty = this.toInt(data.quantity, 0);
    if (qty < 1) throw new BadRequestException('Quantity to assign must be at least 1');
    if (!data.employeeId && !data.assigneeText) throw new BadRequestException('Select an employee or enter a person/location');

    let employeeName: string | null = null;
    if (data.employeeId) {
      const employee = await this.prisma.employee.findFirst({ where: { id: data.employeeId, companyId } });
      if (!employee) throw new NotFoundException('Employee not found');
      employeeName = `${employee.firstName} ${employee.lastName}`;
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, companyId } });
      if (!item) throw new NotFoundException('Inventory item not found');

      const txns = await tx.inventoryTransaction.findMany({
        where: { itemId, type: { in: ['ASSIGNMENT', 'RETURN', 'CONSUMPTION', 'EXPIRED'] } },
        select: { type: true, quantity: true }
      });
      const m = this.computeMetrics(item, txns);

      if (qty > m.available) {
        throw new BadRequestException(`Cannot assign ${qty}: only ${m.available} of ${item.quantity} unit(s) of "${item.name}" available`);
      }

      return tx.inventoryTransaction.create({
        data: {
          companyId,
          itemId,
          type: 'ASSIGNMENT',
          quantity: qty,
          date: this.parseDate(data.date) || new Date(),
          employeeId: data.employeeId || null,
          assigneeText: data.assigneeText || null,
          expectedReturnDate: this.parseDate(data.expectedReturnDate),
          purpose: data.purpose || null,
          createdById: userId
        }
      });
    }).then(txn => ({ ...txn, employeeName }));
  }

  async returnInventoryUnits(companyId: number, userId: number, txnId: number, data: any) {
    const qty = this.toInt(data.quantity, 0);
    if (qty < 1) throw new BadRequestException('Return quantity must be at least 1');

    return this.prisma.$transaction(async (tx) => {
      const parent = await tx.inventoryTransaction.findFirst({
        where: { id: txnId, companyId, type: 'ASSIGNMENT' }
      });
      if (!parent) throw new NotFoundException('Assignment record not found');

      const returns = await tx.inventoryTransaction.aggregate({
        _sum: { quantity: true },
        where: { parentTransactionId: txnId, type: 'RETURN' }
      });
      const outstanding = parent.quantity - (returns._sum.quantity || 0);

      if (qty > outstanding) {
        throw new BadRequestException(`Only ${outstanding} unit(s) remain outstanding on this assignment`);
      }

      return tx.inventoryTransaction.create({
        data: {
          companyId,
          itemId: parent.itemId,
          type: 'RETURN',
          quantity: qty,
          date: this.parseDate(data.returnDate) || new Date(),
          employeeId: parent.employeeId,
          assigneeText: parent.assigneeText,
          parentTransactionId: txnId,
          purpose: parent.purpose,
          conditionOnReturn: data.conditionOnReturn || null,
          reason: data.notes || null,
          createdById: userId
        }
      });
    });
  }

  async consumeInventoryItem(companyId: number, userId: number, itemId: number, data: any) {
    const qty = this.toInt(data.quantity, 0);
    if (qty < 1) throw new BadRequestException('Consumption quantity must be at least 1');

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, companyId } });
      if (!item) throw new NotFoundException('Inventory item not found');
      if (item.itemType !== 'CONSUMABLE') throw new BadRequestException('Consumption can only be recorded for consumable items');

      const txns = await tx.inventoryTransaction.findMany({
        where: { itemId, type: { in: ['ASSIGNMENT', 'RETURN', 'CONSUMPTION', 'EXPIRED'] } },
        select: { type: true, quantity: true }
      });
      const m = this.computeMetrics(item, txns);

      if (qty > m.available) {
        throw new BadRequestException(`Cannot consume ${qty}: only ${m.available} unit(s) of "${item.name}" available`);
      }

      return tx.inventoryTransaction.create({
        data: {
          companyId,
          itemId,
          type: 'CONSUMPTION',
          quantity: qty,
          date: this.parseDate(data.date) || new Date(),
          assigneeText: data.location || item.location || null,
          purpose: data.purpose || null,
          createdById: userId
        }
      });
    });
  }

  async expireInventoryItem(companyId: number, userId: number, itemId: number, data: any) {
    const qty = this.toInt(data.quantity, 0);
    if (qty < 1) throw new BadRequestException('Expired quantity must be at least 1');

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, companyId } });
      if (!item) throw new NotFoundException('Inventory item not found');

      const txns = await tx.inventoryTransaction.findMany({
        where: { itemId, type: { in: ['ASSIGNMENT', 'RETURN', 'CONSUMPTION', 'EXPIRED'] } },
        select: { type: true, quantity: true }
      });
      const m = this.computeMetrics(item, txns);

      if (qty > m.available) {
        throw new BadRequestException(`Cannot mark ${qty} expired: only ${m.available} unit(s) of "${item.name}" available`);
      }

      return tx.inventoryTransaction.create({
        data: {
          companyId,
          itemId,
          type: 'EXPIRED',
          quantity: qty,
          date: this.parseDate(data.date) || new Date(),
          reason: data.reason || null,
          createdById: userId
        }
      });
    });
  }

  async adjustInventoryStock(companyId: number, userId: number, itemId: number, data: any) {
    const delta = this.toInt(data.delta, 0);
    if (delta === 0) throw new BadRequestException('Adjustment must be a non-zero quantity');

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.inventoryItem.findFirst({ where: { id: itemId, companyId } });
      if (!item) throw new NotFoundException('Inventory item not found');

      const newQuantity = item.quantity + delta;
      if (newQuantity < 0) throw new BadRequestException(`Adjustment would make total quantity negative (current: ${item.quantity})`);

      if (delta < 0) {
        const txns = await tx.inventoryTransaction.findMany({
          where: { itemId, type: { in: ['ASSIGNMENT', 'RETURN', 'CONSUMPTION', 'EXPIRED'] } },
          select: { type: true, quantity: true }
        });
        const m = this.computeMetrics(item, txns);
        if (Math.abs(delta) > m.available) {
          throw new BadRequestException(`Only ${m.available} unit(s) available to remove`);
        }
      }

      await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: newQuantity } });

      return tx.inventoryTransaction.create({
        data: {
          companyId,
          itemId,
          type: 'ADJUSTMENT',
          quantity: delta,
          date: this.parseDate(data.date) || new Date(),
          reason: data.reason || 'Stock adjustment',
          createdById: userId
        }
      });
    });
  }

  async importInventoryItems(companyId: number, userId: number, rows: any[]) {
    const results: { row: number; name?: string; error?: string }[] = [];
    let created = 0;

    for (let i = 0; i < rows.length; i++) {
      try {
        await this.createInventoryItem(companyId, userId, rows[i]);
        created++;
      } catch (e: any) {
        results.push({ row: i + 1, name: rows[i]?.name, error: e?.message || 'Failed' });
      }
    }

    return { created, failed: results.length, errors: results };
  }
}
