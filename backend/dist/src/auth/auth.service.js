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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcrypt"));
let AuthService = class AuthService {
    prisma;
    jwtService;
    constructor(prisma, jwtService) {
        this.prisma = prisma;
        this.jwtService = jwtService;
    }
    async signupCompany(companyName, domain, adminEmail, adminPassword, firstName, lastName, phone) {
        const existingCompany = await this.prisma.company.findUnique({ where: { domain } });
        if (existingCompany)
            throw new common_1.ConflictException('Company domain already in use.');
        const existingUser = await this.prisma.user.findUnique({ where: { email: adminEmail } });
        if (existingUser)
            throw new common_1.ConflictException('Admin email already in use.');
        const hashedPassword = await bcrypt.hash(adminPassword, 10);
        return this.prisma.$transaction(async (tx) => {
            const company = await tx.company.create({
                data: { name: companyName, domain },
            });
            const user = await tx.user.create({
                data: {
                    email: adminEmail,
                    password: hashedPassword,
                    role: 'SUPERADMIN',
                    companyId: company.id,
                },
            });
            const employee = await tx.employee.create({
                data: {
                    firstName,
                    lastName,
                    phone,
                    userId: user.id,
                    companyId: company.id,
                },
            });
            const departmentsData = [
                { name: 'Engineering', roles: ['Software Engineer', 'QA Engineer', 'Engineering Manager'] },
                { name: 'Sales', roles: ['Sales Representative', 'Account Executive', 'Sales Director'] },
                { name: 'Marketing', roles: ['Marketing Specialist', 'Content Writer', 'Marketing Manager'] },
                { name: 'Human Resources', roles: ['HR Generalist', 'Recruiter', 'HR Manager'] },
                { name: 'Finance', roles: ['Financial Analyst', 'Accountant', 'Finance Director'] },
                { name: 'Operations', roles: ['Operations Coordinator', 'Operations Manager'] },
                { name: 'Product', roles: ['Product Manager', 'UX Designer'] },
                { name: 'Executive', roles: ['CEO', 'CTO', 'COO'] }
            ];
            for (const dept of departmentsData) {
                const createdDept = await tx.department.create({
                    data: { name: dept.name, companyId: company.id }
                });
                await tx.designation.createMany({
                    data: dept.roles.map(role => ({
                        name: role,
                        departmentId: createdDept.id,
                        companyId: company.id
                    }))
                });
            }
            const rolePermissions = {
                'ADMIN': [
                    'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
                    'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews',
                    'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/shifts', 'attendance/holidays',
                    'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
                    'assets', 'assets/inventory', 'assets/assignments', 'assets/requests',
                    'settings', 'settings/company', 'settings/master-data', 'settings/permissions', 'settings/integrations'
                ],
                'HR': [
                    'employees', 'employees/directory', 'employees/org-chart', 'employees/onboarding', 'employees/documents',
                    'recruitment', 'recruitment/jobs', 'recruitment/candidates', 'recruitment/interviews',
                    'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/shifts', 'attendance/holidays',
                    'payroll', 'payroll/processing', 'payroll/payslips'
                ],
                'FINANCE': [
                    'employees', 'employees/directory', 'employees/org-chart',
                    'attendance', 'attendance/timesheets',
                    'payroll', 'payroll/processing', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
                    'assets', 'assets/inventory', 'assets/assignments'
                ],
                'SALES': [
                    'employees', 'employees/directory', 'employees/org-chart',
                    'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
                    'payroll', 'payroll/payslips', 'payroll/expenses'
                ],
                'EMPLOYEE': [
                    'employees', 'employees/directory', 'employees/org-chart', 'employees/documents',
                    'attendance', 'attendance/timesheets', 'attendance/leaves', 'attendance/holidays',
                    'payroll', 'payroll/payslips', 'payroll/expenses', 'payroll/taxes',
                    'assets', 'assets/requests'
                ]
            };
            const permissionData = [];
            for (const [role, modules] of Object.entries(rolePermissions)) {
                for (const module of modules) {
                    permissionData.push({
                        role,
                        module,
                        action: 'VIEW',
                        companyId: company.id
                    });
                }
            }
            await tx.rolePermission.createMany({
                data: permissionData
            });
            const payload = { sub: user.id, email: user.email, role: user.role, companyId: user.companyId };
            const access_token = await this.jwtService.signAsync(payload);
            return { company, access_token };
        });
    }
    async login(email, pass) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const isMatch = await bcrypt.compare(pass, user.password);
        if (!isMatch)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const payload = { sub: user.id, email: user.email, role: user.role, companyId: user.companyId };
        return {
            access_token: await this.jwtService.signAsync(payload),
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService])
], AuthService);
//# sourceMappingURL=auth.service.js.map