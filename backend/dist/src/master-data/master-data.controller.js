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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MasterDataController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const prisma_service_1 = require("../prisma/prisma.service");
let MasterDataController = class MasterDataController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getDepartments(req, activeOnly) {
        const where = { companyId: req.user.companyId };
        if (activeOnly === 'true')
            where.isActive = true;
        return this.prisma.department.findMany({
            where,
            orderBy: { name: 'asc' }
        });
    }
    async getDesignations(req, activeOnly) {
        const where = { companyId: req.user.companyId };
        if (activeOnly === 'true')
            where.isActive = true;
        return this.prisma.designation.findMany({
            where,
            include: { department: true },
            orderBy: { name: 'asc' }
        });
    }
    async createDepartment(req, data) {
        return this.prisma.department.create({
            data: {
                name: data.name,
                companyId: req.user.companyId,
                defaultRole: data.defaultRole || 'EMPLOYEE'
            }
        });
    }
    async updateDepartment(req, id, data) {
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.isActive !== undefined)
            updateData.isActive = data.isActive;
        if (data.defaultRole !== undefined)
            updateData.defaultRole = data.defaultRole;
        const result = await this.prisma.department.update({
            where: { id, companyId: req.user.companyId },
            data: updateData
        });
        if (data.isActive !== undefined) {
            await this.prisma.designation.updateMany({
                where: { departmentId: id, companyId: req.user.companyId },
                data: { isActive: data.isActive }
            });
        }
        return result;
    }
    async deleteDepartment(req, id) {
        return this.prisma.department.delete({
            where: { id, companyId: req.user.companyId }
        });
    }
    async createDesignation(req, data) {
        return this.prisma.designation.create({
            data: {
                name: data.name,
                departmentId: data.departmentId ? Number(data.departmentId) : null,
                companyId: req.user.companyId,
                canEditProfiles: data.canEditProfiles || false
            }
        });
    }
    async updateDesignation(req, id, data) {
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.departmentId !== undefined)
            updateData.departmentId = data.departmentId ? Number(data.departmentId) : null;
        if (data.isActive !== undefined)
            updateData.isActive = data.isActive;
        if (data.canEditProfiles !== undefined)
            updateData.canEditProfiles = data.canEditProfiles;
        return this.prisma.designation.update({
            where: { id, companyId: req.user.companyId },
            data: updateData
        });
    }
    async deleteDesignation(req, id) {
        return this.prisma.designation.delete({
            where: { id, companyId: req.user.companyId }
        });
    }
    async getBranches(req) {
        return this.prisma.branch.findMany({
            where: { companyId: req.user.companyId },
            orderBy: { name: 'asc' }
        });
    }
    async createBranch(req, data) {
        return this.prisma.branch.create({
            data: {
                name: data.name,
                address: data.address,
                startTime: data.startTime,
                endTime: data.endTime,
                latitude: data.latitude,
                longitude: data.longitude,
                weeklyOffs: data.weeklyOffs,
                companyId: req.user.companyId,
            }
        });
    }
    async updateBranch(req, id, data) {
        return this.prisma.branch.update({
            where: { id, companyId: req.user.companyId },
            data: {
                name: data.name,
                address: data.address,
                startTime: data.startTime,
                endTime: data.endTime,
                latitude: data.latitude,
                longitude: data.longitude,
                weeklyOffs: data.weeklyOffs,
            }
        });
    }
    async deleteBranch(req, id) {
        return this.prisma.branch.delete({
            where: { id, companyId: req.user.companyId }
        });
    }
    async getLeaveTypes(req) {
        return this.prisma.leaveType.findMany({
            where: { companyId: req.user.companyId },
            orderBy: { name: 'asc' }
        });
    }
    async createLeaveType(req, data) {
        return this.prisma.leaveType.create({
            data: {
                name: data.name,
                description: data.description,
                defaultDays: data.defaultDays,
                isPaid: data.isPaid,
                carryForward: data.carryForward,
                carryForwardLimit: data.carryForwardLimit,
                companyId: req.user.companyId,
            }
        });
    }
    async updateLeaveType(req, id, data) {
        return this.prisma.leaveType.update({
            where: { id, companyId: req.user.companyId },
            data: {
                name: data.name,
                description: data.description,
                defaultDays: data.defaultDays,
                isPaid: data.isPaid,
                carryForward: data.carryForward,
                carryForwardLimit: data.carryForwardLimit,
            }
        });
    }
    async deleteLeaveType(req, id) {
        return this.prisma.leaveType.delete({
            where: { id, companyId: req.user.companyId }
        });
    }
    async getHolidays(req) {
        return this.prisma.holiday.findMany({
            where: { companyId: req.user.companyId },
            orderBy: { date: 'asc' }
        });
    }
    async createHoliday(req, data) {
        return this.prisma.holiday.create({
            data: {
                name: data.name,
                date: new Date(data.date),
                companyId: req.user.companyId,
            }
        });
    }
    async seedHolidays(req, data) {
        if (!data.holidays || data.holidays.length === 0)
            return { success: false };
        const createPromises = data.holidays.map(h => this.prisma.holiday.create({
            data: {
                name: h.name,
                date: new Date(h.date),
                companyId: req.user.companyId
            }
        }));
        await Promise.all(createPromises);
        return { success: true, count: data.holidays.length };
    }
    async updateHoliday(req, id, data) {
        const updateData = {};
        if (data.name !== undefined)
            updateData.name = data.name;
        if (data.date !== undefined)
            updateData.date = new Date(data.date);
        return this.prisma.holiday.update({
            where: { id, companyId: req.user.companyId },
            data: updateData
        });
    }
    async deleteHoliday(req, id) {
        return this.prisma.holiday.delete({
            where: { id, companyId: req.user.companyId }
        });
    }
};
exports.MasterDataController = MasterDataController;
__decorate([
    (0, common_1.Get)('departments'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('activeOnly')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "getDepartments", null);
__decorate([
    (0, common_1.Get)('designations'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('activeOnly')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "getDesignations", null);
__decorate([
    (0, common_1.Post)('departments'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "createDepartment", null);
__decorate([
    (0, common_1.Put)('departments/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "updateDepartment", null);
__decorate([
    (0, common_1.Delete)('departments/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "deleteDepartment", null);
__decorate([
    (0, common_1.Post)('designations'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "createDesignation", null);
__decorate([
    (0, common_1.Put)('designations/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "updateDesignation", null);
__decorate([
    (0, common_1.Delete)('designations/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "deleteDesignation", null);
__decorate([
    (0, common_1.Get)('branches'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "getBranches", null);
__decorate([
    (0, common_1.Post)('branches'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "createBranch", null);
__decorate([
    (0, common_1.Put)('branches/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "updateBranch", null);
__decorate([
    (0, common_1.Delete)('branches/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "deleteBranch", null);
__decorate([
    (0, common_1.Get)('leave-types'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "getLeaveTypes", null);
__decorate([
    (0, common_1.Post)('leave-types'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "createLeaveType", null);
__decorate([
    (0, common_1.Put)('leave-types/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "updateLeaveType", null);
__decorate([
    (0, common_1.Delete)('leave-types/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "deleteLeaveType", null);
__decorate([
    (0, common_1.Get)('holidays'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "getHolidays", null);
__decorate([
    (0, common_1.Post)('holidays'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "createHoliday", null);
__decorate([
    (0, common_1.Post)('holidays/seed'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "seedHolidays", null);
__decorate([
    (0, common_1.Put)('holidays/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number, Object]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "updateHoliday", null);
__decorate([
    (0, common_1.Delete)('holidays/:id'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", Promise)
], MasterDataController.prototype, "deleteHoliday", null);
exports.MasterDataController = MasterDataController = __decorate([
    (0, common_1.Controller)('master-data'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MasterDataController);
//# sourceMappingURL=master-data.controller.js.map