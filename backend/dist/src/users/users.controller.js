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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const prisma_service_1 = require("../prisma/prisma.service");
let UsersController = class UsersController {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getMe(req) {
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.sub },
            include: { company: true, employee: true }
        });
        if (user) {
            delete user.password;
        }
        return user;
    }
    async completeOnboarding(req, data) {
        const user = await this.prisma.user.findUnique({
            where: { id: req.user.sub },
            include: { employee: true }
        });
        if (!user) {
            return { success: false, message: 'User not found' };
        }
        await this.prisma.company.update({
            where: { id: user.companyId },
            data: {
                logoUrl: data.logoUrl,
                industry: data.industry,
                size: data.size,
                timezone: data.timezone,
                onboardingCompleted: true
            }
        });
        if (user.employee) {
            await this.prisma.employee.update({
                where: { id: user.employee.id },
                data: {
                    designationId: data.designationId ? parseInt(data.designationId) : null,
                    departmentId: data.departmentId ? parseInt(data.departmentId) : null,
                    avatarUrl: data.avatarUrl,
                    themePref: data.themePref,
                    currency: data.currency
                }
            });
        }
        return { success: true };
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "getMe", null);
__decorate([
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    (0, common_1.Post)('onboarding'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "completeOnboarding", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersController);
//# sourceMappingURL=users.controller.js.map