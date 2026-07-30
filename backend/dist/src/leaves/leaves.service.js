"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LeavesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let LeavesService = class LeavesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async assignLeaveBalance(data) {
        return this.prisma.leaveBalance.upsert({
            where: {
                employeeId_leaveTypeId_year: {
                    employeeId: data.employeeId,
                    leaveTypeId: data.leaveTypeId,
                    year: data.year
                }
            },
            update: {
                allocated: data.allocated
            },
            create: {
                employeeId: data.employeeId,
                leaveTypeId: data.leaveTypeId,
                allocated: data.allocated,
                year: data.year
            }
        });
    }
    async getMyBalances(userId, year) {
        const employee = await this.prisma.employee.findUnique({ where: { userId } });
        if (!employee)
            throw new common_1.BadRequestException('Employee not found');
        return this.prisma.leaveBalance.findMany({
            where: { employeeId: employee.id, year },
            include: { leaveType: true }
        });
    }
    async getAllBalances(companyId, year) {
        return this.prisma.leaveBalance.findMany({
            where: { employee: { companyId }, year },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true } },
                leaveType: true
            }
        });
    }
    async requestLeave(userId, data) {
        const employee = await this.prisma.employee.findUnique({ where: { userId } });
        if (!employee)
            throw new common_1.BadRequestException('Employee not found');
        return this.prisma.leaveRequest.create({
            data: {
                employeeId: employee.id,
                leaveTypeId: data.leaveTypeId,
                startDate: new Date(data.startDate),
                endDate: new Date(data.endDate),
                reason: data.reason,
                attachmentUrl: data.attachmentUrl
            }
        });
    }
    async getRequests(companyId, filter) {
        return this.prisma.leaveRequest.findMany({
            where: { employee: { companyId } },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true } },
                leaveType: true
            },
            orderBy: { createdAt: 'desc' }
        });
    }
    async updateRequest(userId, requestId, data) {
        const employee = await this.prisma.employee.findUnique({ where: { userId } });
        if (!employee)
            throw new common_1.BadRequestException('Employee not found');
        const request = await this.prisma.leaveRequest.findFirst({
            where: { id: requestId, employeeId: employee.id }
        });
        if (!request)
            throw new common_1.BadRequestException('Request not found or not authorized');
        if (request.status !== 'PENDING')
            throw new common_1.BadRequestException('Only pending requests can be edited');
        const updateData = {};
        if (data.startDate)
            updateData.startDate = new Date(data.startDate);
        if (data.endDate)
            updateData.endDate = new Date(data.endDate);
        if (data.reason !== undefined)
            updateData.reason = data.reason;
        if (data.attachmentUrl !== undefined)
            updateData.attachmentUrl = data.attachmentUrl;
        return this.prisma.leaveRequest.update({
            where: { id: requestId },
            data: updateData
        });
    }
    async cancelRequest(userId, requestId) {
        const employee = await this.prisma.employee.findUnique({ where: { userId } });
        if (!employee)
            throw new common_1.BadRequestException('Employee not found');
        const request = await this.prisma.leaveRequest.findFirst({
            where: { id: requestId, employeeId: employee.id }
        });
        if (!request)
            throw new common_1.BadRequestException('Request not found or not authorized');
        if (request.status === 'REJECTED' || request.status === 'CANCELLED') {
            throw new common_1.BadRequestException('Request is already ' + request.status.toLowerCase());
        }
        return this.prisma.$transaction(async (tx) => {
            const updatedRequest = await tx.leaveRequest.update({
                where: { id: requestId },
                data: { status: 'CANCELLED' }
            });
            if (request.status === 'APPROVED') {
                const start = new Date(request.startDate);
                const end = new Date(request.endDate);
                const diffTime = Math.abs(end.getTime() - start.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                await tx.leaveBalance.updateMany({
                    where: {
                        employeeId: request.employeeId,
                        leaveTypeId: request.leaveTypeId,
                        year: start.getFullYear()
                    },
                    data: {
                        used: { decrement: diffDays }
                    }
                });
            }
            return updatedRequest;
        });
    }
    async getMyRequests(userId) {
        const employee = await this.prisma.employee.findUnique({ where: { userId } });
        if (!employee)
            throw new common_1.BadRequestException('Employee not found');
        return this.prisma.leaveRequest.findMany({
            where: { employeeId: employee.id },
            include: { leaveType: true },
            orderBy: { createdAt: 'desc' }
        });
    }
    async updateRequestStatus(userId, requestId, status, rejectionReason) {
        const request = await this.prisma.leaveRequest.findUnique({
            where: { id: requestId },
            include: { employee: true }
        });
        if (!request)
            throw new common_1.BadRequestException('Request not found');
        if (status === 'REJECTED' && !rejectionReason)
            throw new common_1.BadRequestException('Rejection reason is required');
        return this.prisma.$transaction(async (tx) => {
            const updatedRequest = await tx.leaveRequest.update({
                where: { id: requestId },
                data: {
                    status,
                    rejectionReason: status === 'REJECTED' ? rejectionReason : null,
                    approvedById: userId
                }
            });
            if (status === 'APPROVED' && request.status !== 'APPROVED') {
                const start = new Date(request.startDate);
                const end = new Date(request.endDate);
                const diffTime = Math.abs(end.getTime() - start.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                await tx.leaveBalance.updateMany({
                    where: {
                        employeeId: request.employeeId,
                        leaveTypeId: request.leaveTypeId,
                        year: start.getFullYear()
                    },
                    data: {
                        used: { increment: diffDays }
                    }
                });
            }
            else if (status === 'REJECTED' && request.status === 'APPROVED') {
                const start = new Date(request.startDate);
                const end = new Date(request.endDate);
                const diffTime = Math.abs(end.getTime() - start.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                await tx.leaveBalance.updateMany({
                    where: {
                        employeeId: request.employeeId,
                        leaveTypeId: request.leaveTypeId,
                        year: start.getFullYear()
                    },
                    data: {
                        used: { decrement: diffDays }
                    }
                });
            }
            return updatedRequest;
        });
    }
};
exports.LeavesService = LeavesService;
exports.LeavesService = LeavesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LeavesService);
//# sourceMappingURL=leaves.service.js.map