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
      images: a.images ? (typeof a.images === 'string' && a.images.startsWith('[') ? JSON.parse(a.images) : [a.images]) : []
    }));
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

    const asset = await this.prisma.asset.create({
      data: {
        companyId,
        assetTag,
        name: data.name,
        category: data.category || 'LAPTOP',
        brand: data.brand,
        model: data.model,
        serialNumber: data.serialNumber,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        cost: data.cost ? parseFloat(data.cost) : null,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : null,
        images: imagesStr,
        status: data.status || 'AVAILABLE'
      }
    });

    return {
      ...asset,
      images: asset.images ? (asset.images.startsWith('[') ? JSON.parse(asset.images) : [asset.images]) : []
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

    const updated = await this.prisma.asset.update({
      where: { id },
      data: {
        assetTag,
        name: data.name,
        category: data.category,
        brand: data.brand,
        model: data.model,
        serialNumber: data.serialNumber,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
        cost: data.cost ? parseFloat(data.cost) : undefined,
        warrantyExpiry: data.warrantyExpiry ? new Date(data.warrantyExpiry) : undefined,
        images: imagesStr,
        status: data.status
      }
    });

    return {
      ...updated,
      images: updated.images ? (updated.images.startsWith('[') ? JSON.parse(updated.images) : [updated.images]) : []
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
}
