"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmployeesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const bcrypt = __importStar(require("bcrypt"));
const permissions_service_1 = require("../permissions/permissions.service");
let EmployeesService = class EmployeesService {
    prisma;
    permissions;
    constructor(prisma, permissions) {
        this.prisma = prisma;
        this.permissions = permissions;
    }
    async findAll(companyId) {
        return this.prisma.employee.findMany({
            where: { companyId },
            include: {
                user: { select: { email: true, role: true } },
                department: { select: { name: true } },
                designation: { select: { name: true } },
                branch: { select: { name: true } },
                shift: { select: { id: true, name: true, startTime: true, endTime: true } }
            },
            orderBy: { createdAt: 'desc' }
        });
    }
    async create(companyId, data) {
        const existingUser = await this.prisma.user.findUnique({ where: { email: data.email } });
        if (existingUser) {
            throw new common_1.ConflictException('User with this email already exists');
        }
        const hashedPassword = await bcrypt.hash('Welcome@123', 10);
        let assignedRole = data.role || 'EMPLOYEE';
        if (data.departmentId) {
            const dept = await this.prisma.department.findUnique({ where: { id: data.departmentId } });
            if (dept && dept.defaultRole) {
                assignedRole = dept.defaultRole;
            }
        }
        return this.prisma.$transaction(async (prisma) => {
            const newUser = await prisma.user.create({
                data: {
                    email: data.email,
                    password: hashedPassword,
                    role: assignedRole,
                    companyId: companyId
                }
            });
            const newEmployee = await prisma.employee.create({
                data: {
                    firstName: data.firstName,
                    lastName: data.lastName,
                    phone: data.phone,
                    departmentId: data.departmentId || null,
                    designationId: data.designationId || null,
                    branchId: data.branchId || null,
                    managerId: data.managerId || null,
                    shiftId: data.shiftId ? (typeof data.shiftId === 'string' ? parseInt(data.shiftId, 10) : data.shiftId) : null,
                    companyId: companyId,
                    userId: newUser.id,
                    onboardingStatus: 'PENDING'
                },
                include: {
                    user: { select: { email: true, role: true } },
                    department: true,
                    designation: true,
                    branch: true,
                    shift: true,
                    manager: {
                        select: { id: true, firstName: true, lastName: true }
                    }
                }
            });
            const templates = await prisma.onboardingTemplate.findMany({ where: { companyId } });
            if (templates.length > 0) {
                await prisma.employeeOnboardingTask.createMany({
                    data: templates.map(t => ({
                        employeeId: newEmployee.id,
                        title: t.title,
                        description: t.description
                    }))
                });
            }
            return newEmployee;
        });
    }
    async update(id, companyId, data) {
        const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        const updateData = {};
        if (data.firstName)
            updateData.firstName = data.firstName;
        if (data.lastName)
            updateData.lastName = data.lastName;
        if (data.phone)
            updateData.phone = data.phone;
        if (data.departmentId !== undefined) {
            if (data.departmentId)
                updateData.department = { connect: { id: data.departmentId } };
            else
                updateData.department = { disconnect: true };
        }
        if (data.designationId !== undefined) {
            if (data.designationId)
                updateData.designation = { connect: { id: data.designationId } };
            else
                updateData.designation = { disconnect: true };
        }
        if (data.branchId !== undefined) {
            if (data.branchId)
                updateData.branch = { connect: { id: data.branchId } };
            else
                updateData.branch = { disconnect: true };
        }
        if (data.managerId !== undefined) {
            if (data.managerId)
                updateData.manager = { connect: { id: data.managerId } };
            else
                updateData.manager = { disconnect: true };
        }
        if (data.shiftId !== undefined) {
            if (data.shiftId)
                updateData.shift = { connect: { id: typeof data.shiftId === 'string' ? parseInt(data.shiftId, 10) : data.shiftId } };
            else
                updateData.shift = { disconnect: true };
        }
        if (data.role) {
            updateData.user = { update: { role: data.role } };
        }
        return this.prisma.employee.update({
            where: { id },
            data: updateData,
            include: {
                user: { select: { email: true, role: true } },
                department: { select: { name: true } },
                designation: { select: { name: true } }
            }
        });
    }
    async delete(id, companyId) {
        const employee = await this.prisma.employee.findFirst({ where: { id, companyId }, select: { userId: true } });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        await this.prisma.user.delete({ where: { id: employee.userId } });
        return { success: true };
    }
    async getMyProfile(companyId, currentUserId) {
        const employee = await this.prisma.employee.findFirst({
            where: { userId: currentUserId, companyId },
            include: {
                user: { select: { email: true, role: true, id: true } },
                department: { select: { name: true } },
                designation: { select: { name: true } },
                emergencyContacts: true,
                documents: true
            }
        });
        if (!employee)
            throw new common_1.NotFoundException('Employee profile not found');
        return { ...employee, isOwner: true };
    }
    async getProfile(id, companyId, currentUserId) {
        const employee = await this.prisma.employee.findFirst({
            where: { id, companyId },
            include: {
                user: { select: { email: true, role: true, id: true } },
                department: { select: { name: true } },
                designation: { select: { name: true } },
                branch: { select: { name: true } },
                manager: { select: { firstName: true, lastName: true, id: true } },
                shift: { select: { name: true, startTime: true, endTime: true } },
                emergencyContacts: true,
                documents: true
            }
        });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        const isOwner = employee.userId === currentUserId;
        if (!isOwner) {
            employee.documents = [];
        }
        return { ...employee, isOwner };
    }
    async checkProfileEditPermission(employeeId, companyId, currentUserId, role) {
        const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        if (employee.userId === currentUserId)
            return employee;
        const requestor = await this.prisma.employee.findFirst({
            where: { userId: currentUserId, companyId },
            include: { designation: true }
        });
        if (requestor?.designation?.canEditProfiles) {
            return employee;
        }
        const hasPermission = await this.permissions.hasPermission(companyId, role, 'EMPLOYEE_PROFILES', 'EDIT_ANY');
        if (!hasPermission) {
            throw new common_1.UnauthorizedException('You do not have permission to edit other employee profiles');
        }
        return employee;
    }
    async updateProfile(id, companyId, currentUserId, role, data) {
        const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);
        if (data.password) {
            const hashedPassword = await bcrypt.hash(data.password, 10);
            await this.prisma.user.update({
                where: { id: employee.userId },
                data: { password: hashedPassword }
            });
        }
        return this.prisma.employee.update({
            where: { id },
            data: {
                salutation: data.salutation,
                firstName: data.firstName,
                lastName: data.lastName,
                phone: data.phone,
                country: data.country,
                state: data.state,
                city: data.city,
                language: data.language,
                gender: data.gender,
                dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
                slackId: data.slackId,
                maritalStatus: data.maritalStatus,
                address: data.address,
                about: data.about,
                avatarUrl: data.avatarUrl
            }
        });
    }
    async addContact(id, companyId, currentUserId, role, data) {
        const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);
        return this.prisma.emergencyContact.create({
            data: {
                employeeId: id,
                name: data.name,
                email: data.email,
                mobile: data.mobile,
                relationship: data.relationship
            }
        });
    }
    async deleteContact(id, contactId, companyId, currentUserId, role) {
        const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);
        return this.prisma.emergencyContact.delete({
            where: { id: contactId }
        });
    }
    async addDocument(id, companyId, currentUserId, role, data) {
        const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);
        return this.prisma.employeeDocument.create({
            data: {
                employeeId: id,
                fileName: data.fileName,
                fileUrl: data.fileUrl
            }
        });
    }
    async deleteDocument(id, documentId, companyId, currentUserId, role) {
        const employee = await this.checkProfileEditPermission(id, companyId, currentUserId, role);
        return this.prisma.employeeDocument.delete({
            where: { id: documentId }
        });
    }
};
exports.EmployeesService = EmployeesService;
exports.EmployeesService = EmployeesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        permissions_service_1.PermissionsService])
], EmployeesService);
//# sourceMappingURL=employees.service.js.map