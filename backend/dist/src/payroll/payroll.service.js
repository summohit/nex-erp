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
exports.PayrollService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const pdf_service_1 = require("./pdf.service");
const email_service_1 = require("./email.service");
const PREDEFINED_COMPONENTS = [
    { name: 'Basic Salary', type: 'EARNING', description: 'Base component of employee salary' },
    { name: 'House Rent Allowance (HRA)', type: 'EARNING', description: 'Tax-exempt housing allowance' },
    { name: 'Special Allowance', type: 'EARNING', description: 'Performance and special allowance' },
    { name: 'Conveyance Allowance', type: 'EARNING', description: 'Travel and commuting allowance' },
    { name: 'Medical Allowance', type: 'EARNING', description: 'Medical expenses reimbursement' },
    { name: 'Dearness Allowance (DA)', type: 'EARNING', description: 'Cost of living adjustment' },
    { name: 'Provident Fund (PF)', type: 'DEDUCTION', description: 'Retirement savings contribution' },
    { name: 'Professional Tax', type: 'DEDUCTION', description: 'State government employment tax' },
    { name: 'Income Tax (TDS)', type: 'DEDUCTION', description: 'Tax deducted at source' },
    { name: 'Employee State Insurance (ESI)', type: 'DEDUCTION', description: 'Social security and health insurance' }
];
let PayrollService = class PayrollService {
    prisma;
    pdfService;
    emailService;
    constructor(prisma, pdfService, emailService) {
        this.prisma = prisma;
        this.pdfService = pdfService;
        this.emailService = emailService;
    }
    async getSalaryComponents(companyId) {
        const existing = await this.prisma.salaryComponent.findMany({
            where: { companyId },
            orderBy: { id: 'asc' }
        });
        if (existing.length === 0) {
            await this.prisma.salaryComponent.createMany({
                data: PREDEFINED_COMPONENTS.map(c => ({
                    ...c,
                    isPreDefined: true,
                    companyId
                }))
            });
            return this.prisma.salaryComponent.findMany({
                where: { companyId },
                orderBy: { id: 'asc' }
            });
        }
        return existing;
    }
    async createSalaryComponent(companyId, data) {
        if (!['EARNING', 'DEDUCTION'].includes(data.type)) {
            throw new common_1.BadRequestException('Component type must be EARNING or DEDUCTION');
        }
        return this.prisma.salaryComponent.create({
            data: {
                name: data.name,
                type: data.type,
                description: data.description,
                isPreDefined: false,
                companyId
            }
        });
    }
    async updateSalaryComponent(companyId, id, data) {
        const comp = await this.prisma.salaryComponent.findFirst({ where: { id, companyId } });
        if (!comp)
            throw new common_1.NotFoundException('Component not found');
        return this.prisma.salaryComponent.update({
            where: { id },
            data: {
                name: data.name,
                description: data.description
            }
        });
    }
    async deleteSalaryComponent(companyId, id) {
        const comp = await this.prisma.salaryComponent.findFirst({ where: { id, companyId } });
        if (!comp)
            throw new common_1.NotFoundException('Component not found');
        if (comp.isPreDefined) {
            throw new common_1.BadRequestException('Predefined components cannot be deleted');
        }
        return this.prisma.salaryComponent.delete({ where: { id } });
    }
    async getSalaryStructure(companyId, employeeId) {
        const employee = await this.prisma.employee.findFirst({
            where: { id: employeeId, companyId },
            include: {
                salaryStructures: {
                    include: { component: true }
                }
            }
        });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        return employee.salaryStructures;
    }
    async updateSalaryStructure(companyId, employeeId, items) {
        const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        for (const item of items) {
            await this.prisma.salaryStructure.upsert({
                where: {
                    employeeId_componentId: {
                        employeeId,
                        componentId: Number(item.componentId)
                    }
                },
                update: { amount: Number(item.amount) || 0 },
                create: {
                    employeeId,
                    componentId: Number(item.componentId),
                    amount: Number(item.amount) || 0
                }
            });
        }
        return this.getSalaryStructure(companyId, employeeId);
    }
    isWeeklyOff(date, rules) {
        const day = date.getDay();
        const dateNum = date.getDate();
        const occurrence = Math.ceil(dateNum / 7);
        for (const rule of rules) {
            const parts = rule.split(':');
            const ruleDay = parseInt(parts[0], 10);
            const condition = parts[1] || 'all';
            if (day === ruleDay) {
                if (condition === 'all')
                    return true;
                if (condition === 'even' && occurrence % 2 === 0)
                    return true;
                if (condition === 'odd' && occurrence % 2 !== 0)
                    return true;
            }
        }
        return false;
    }
    async generatePayslips(companyId, month, year) {
        const employees = await this.prisma.employee.findMany({
            where: { companyId },
            include: {
                salaryStructures: {
                    include: { component: true }
                },
                branch: true
            }
        });
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        const totalDaysInMonth = endDate.getDate();
        for (const emp of employees) {
            const weeklyOffsConfig = emp.branch?.weeklyOffs || "0";
            const weeklyOffRules = weeklyOffsConfig.split(',').map(n => n.trim());
            let workingDaysInMonth = 0;
            for (let d = 1; d <= totalDaysInMonth; d++) {
                const date = new Date(year, month - 1, d);
                if (!this.isWeeklyOff(date, weeklyOffRules)) {
                    workingDaysInMonth++;
                }
            }
            if (workingDaysInMonth === 0)
                workingDaysInMonth = totalDaysInMonth;
            const attendances = await this.prisma.attendance.findMany({
                where: {
                    employeeId: emp.id,
                    date: {
                        gte: startDate,
                        lte: endDate
                    }
                }
            });
            const approvedLeaves = await this.prisma.leaveRequest.findMany({
                where: {
                    employeeId: emp.id,
                    status: 'APPROVED',
                    leaveType: { isPaid: true },
                    startDate: { lte: endDate },
                    endDate: { gte: startDate }
                },
                include: { leaveType: true }
            });
            let presentCount = 0;
            let halfDayCount = 0;
            const attendanceMap = new Map();
            for (const att of attendances) {
                const dateStr = att.date.toISOString().split('T')[0];
                attendanceMap.set(dateStr, att.status);
                if (att.status === 'PRESENT')
                    presentCount++;
                else if (att.status === 'HALF_DAY')
                    halfDayCount++;
            }
            let unexcusedAbsences = 0;
            for (let d = 1; d <= totalDaysInMonth; d++) {
                const date = new Date(year, month - 1, d);
                if (!this.isWeeklyOff(date, weeklyOffRules)) {
                    const dateStr = date.toISOString().split('T')[0];
                    const status = attendanceMap.get(dateStr);
                    if (status !== 'PRESENT' && status !== 'HALF_DAY') {
                        let isCovered = false;
                        for (const leave of approvedLeaves) {
                            const leaveStartStr = leave.startDate.toISOString().split('T')[0];
                            const leaveEndStr = leave.endDate.toISOString().split('T')[0];
                            if (dateStr >= leaveStartStr && dateStr <= leaveEndStr) {
                                isCovered = true;
                                break;
                            }
                        }
                        if (!isCovered) {
                            unexcusedAbsences++;
                        }
                    }
                }
            }
            unexcusedAbsences += (halfDayCount * 0.5);
            const presentDays = presentCount + (halfDayCount * 0.5);
            const approvedExpenses = await this.prisma.expenseClaim.findMany({
                where: {
                    employeeId: emp.id,
                    companyId,
                    status: 'APPROVED',
                    OR: [
                        { month: null, year: null },
                        { month: Number(month), year: Number(year) }
                    ]
                }
            });
            const expenseAmount = approvedExpenses.reduce((sum, exp) => sum + exp.amount, 0);
            let totalEarnings = 0;
            let totalDeductions = 0;
            const payslipItemsData = [];
            let basicSalary = 0;
            for (const struct of emp.salaryStructures) {
                const amt = struct.amount || 0;
                if (amt > 0) {
                    if (struct.component.type === 'EARNING') {
                        totalEarnings += amt;
                        payslipItemsData.push({
                            componentName: struct.component.name,
                            type: 'EARNING',
                            amount: amt
                        });
                        if (struct.component.name.toLowerCase().includes('basic')) {
                            basicSalary = amt;
                        }
                    }
                    else if (struct.component.type === 'DEDUCTION') {
                        totalDeductions += amt;
                        payslipItemsData.push({
                            componentName: struct.component.name,
                            type: 'DEDUCTION',
                            amount: amt
                        });
                    }
                }
            }
            if (basicSalary === 0 && totalEarnings > 0) {
                basicSalary = totalEarnings * 0.5;
            }
            const pfAmount = Math.round(basicSalary * 0.12);
            if (pfAmount > 0 && !payslipItemsData.some(i => i.componentName.includes('Provident Fund'))) {
                payslipItemsData.push({ componentName: 'Provident Fund (PF) [Statutory]', type: 'DEDUCTION', amount: pfAmount });
                totalDeductions += pfAmount;
            }
            if (totalEarnings > 0 && totalEarnings <= 21000 && !payslipItemsData.some(i => i.componentName.includes('State Insurance'))) {
                const esiAmount = Math.round(totalEarnings * 0.0075);
                payslipItemsData.push({ componentName: 'Employee State Insurance (ESI) [Statutory]', type: 'DEDUCTION', amount: esiAmount });
                totalDeductions += esiAmount;
            }
            if (totalEarnings > 15000 && !payslipItemsData.some(i => i.componentName.includes('Professional Tax'))) {
                const ptAmount = 200;
                payslipItemsData.push({ componentName: 'Professional Tax [Statutory]', type: 'DEDUCTION', amount: ptAmount });
                totalDeductions += ptAmount;
            }
            if (totalEarnings > 50000 && !payslipItemsData.some(i => i.componentName.includes('TDS'))) {
                const tdsAmount = Math.round((totalEarnings - 50000) * 0.10);
                payslipItemsData.push({ componentName: 'Income Tax (TDS) [Statutory]', type: 'DEDUCTION', amount: tdsAmount });
                totalDeductions += tdsAmount;
            }
            const dailyRate = workingDaysInMonth > 0 ? (totalEarnings / workingDaysInMonth) : 0;
            const lossOfPay = Math.round(dailyRate * unexcusedAbsences * 100) / 100;
            const netPay = Math.max(0, Math.round((totalEarnings - totalDeductions - lossOfPay + expenseAmount) * 100) / 100);
            const payslip = await this.prisma.payslip.upsert({
                where: {
                    employeeId_month_year: {
                        employeeId: emp.id,
                        month: Number(month),
                        year: Number(year)
                    }
                },
                update: {
                    workingDays: workingDaysInMonth,
                    presentDays,
                    absentDays: unexcusedAbsences,
                    halfDays: halfDayCount,
                    totalEarnings,
                    totalDeductions,
                    lossOfPay,
                    expenseAmount,
                    netPay,
                    status: 'DRAFT'
                },
                create: {
                    employeeId: emp.id,
                    companyId,
                    month: Number(month),
                    year: Number(year),
                    workingDays: workingDaysInMonth,
                    presentDays,
                    absentDays: unexcusedAbsences,
                    halfDays: halfDayCount,
                    totalEarnings,
                    totalDeductions,
                    lossOfPay,
                    expenseAmount,
                    netPay,
                    status: 'DRAFT'
                }
            });
            await this.prisma.payslipItem.deleteMany({ where: { payslipId: payslip.id } });
            if (payslipItemsData.length > 0) {
                await this.prisma.payslipItem.createMany({
                    data: payslipItemsData.map(item => ({
                        ...item,
                        payslipId: payslip.id
                    }))
                });
            }
            if (approvedExpenses.length > 0) {
                await this.prisma.expenseClaim.updateMany({
                    where: { id: { in: approvedExpenses.map(e => e.id) } },
                    data: { month: Number(month), year: Number(year) }
                });
            }
        }
        return this.getPayslips(companyId, month, year);
    }
    async getPayslips(companyId, month, year) {
        const where = { companyId };
        if (month)
            where.month = Number(month);
        if (year)
            where.year = Number(year);
        const existing = await this.prisma.payslip.findMany({
            where,
            include: {
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        department: { select: { name: true } },
                        designation: { select: { name: true } }
                    }
                },
                items: true
            },
            orderBy: { employee: { firstName: 'asc' } }
        });
        if (existing.length === 0 && month && year) {
            return this.generatePayslips(companyId, Number(month), Number(year));
        }
        return existing;
    }
    async getMyPayslips(companyId, userId) {
        const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
        if (!employee)
            throw new common_1.NotFoundException('Employee profile not found');
        return this.prisma.payslip.findMany({
            where: {
                employeeId: employee.id,
                companyId,
                status: { in: ['FINALIZED', 'PAID'] }
            },
            include: {
                items: true,
                employee: {
                    select: {
                        firstName: true,
                        lastName: true,
                        department: { select: { name: true } },
                        designation: { select: { name: true } }
                    }
                }
            },
            orderBy: [{ year: 'desc' }, { month: 'desc' }]
        });
    }
    async updatePayslip(companyId, id, data) {
        const payslip = await this.prisma.payslip.findFirst({ where: { id, companyId } });
        if (!payslip)
            throw new common_1.NotFoundException('Payslip not found');
        const lossOfPay = data.lossOfPay !== undefined ? Number(data.lossOfPay) : payslip.lossOfPay;
        const totalEarnings = data.totalEarnings !== undefined ? Number(data.totalEarnings) : payslip.totalEarnings;
        const totalDeductions = data.totalDeductions !== undefined ? Number(data.totalDeductions) : payslip.totalDeductions;
        const expenseAmount = data.expenseAmount !== undefined ? Number(data.expenseAmount) : payslip.expenseAmount;
        const netPay = Math.max(0, Math.round((totalEarnings - totalDeductions - lossOfPay + expenseAmount) * 100) / 100);
        if (data.totalDeductions !== undefined) {
            const deductionItems = await this.prisma.payslipItem.findMany({
                where: { payslipId: id, type: 'DEDUCTION' }
            });
            if (deductionItems.length === 1) {
                await this.prisma.payslipItem.update({
                    where: { id: deductionItems[0].id },
                    data: { amount: totalDeductions }
                });
            }
            else if (deductionItems.length > 1) {
                const oldSum = deductionItems.reduce((sum, item) => sum + item.amount, 0);
                for (let i = 0; i < deductionItems.length; i++) {
                    const item = deductionItems[i];
                    const newAmt = oldSum > 0 ? Math.round((item.amount / oldSum) * totalDeductions * 100) / 100 : (i === 0 ? totalDeductions : 0);
                    await this.prisma.payslipItem.update({
                        where: { id: item.id },
                        data: { amount: newAmt }
                    });
                }
            }
        }
        if (data.totalEarnings !== undefined) {
            const earningItems = await this.prisma.payslipItem.findMany({
                where: { payslipId: id, type: 'EARNING' }
            });
            if (earningItems.length > 0) {
                const oldSum = earningItems.reduce((sum, item) => sum + item.amount, 0);
                for (let i = 0; i < earningItems.length; i++) {
                    const item = earningItems[i];
                    const newAmt = oldSum > 0 ? Math.round((item.amount / oldSum) * totalEarnings * 100) / 100 : (i === 0 ? totalEarnings : 0);
                    await this.prisma.payslipItem.update({
                        where: { id: item.id },
                        data: { amount: newAmt }
                    });
                }
            }
        }
        return this.prisma.payslip.update({
            where: { id },
            data: {
                lossOfPay,
                totalEarnings,
                totalDeductions,
                expenseAmount,
                netPay,
                status: data.status || payslip.status
            },
            include: { items: true, employee: true }
        });
    }
    async batchFinalizePayslips(companyId, month, year) {
        return this.prisma.payslip.updateMany({
            where: {
                companyId,
                month: Number(month),
                year: Number(year),
                status: 'DRAFT'
            },
            data: { status: 'FINALIZED' }
        });
    }
    async markPayslipsPaid(companyId, month, year) {
        return this.prisma.payslip.updateMany({
            where: {
                companyId,
                month: Number(month),
                year: Number(year),
                status: 'FINALIZED'
            },
            data: { status: 'PAID', paidOn: new Date() }
        });
    }
    async createExpenseClaim(companyId, userId, data) {
        const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        return this.prisma.expenseClaim.create({
            data: {
                employeeId: employee.id,
                companyId,
                title: data.title,
                description: data.description,
                amount: Number(data.amount),
                category: data.category || 'OTHER',
                receiptUrl: data.receiptUrl,
                status: 'PENDING'
            }
        });
    }
    async getMyExpenseClaims(companyId, userId) {
        const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
        if (!employee)
            throw new common_1.NotFoundException('Employee not found');
        return this.prisma.expenseClaim.findMany({
            where: { employeeId: employee.id, companyId },
            include: {
                approvedBy: {
                    select: { employee: { select: { firstName: true, lastName: true } } }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }
    async getAllExpenseClaims(companyId) {
        return this.prisma.expenseClaim.findMany({
            where: { companyId },
            include: {
                employee: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        department: { select: { name: true } }
                    }
                },
                approvedBy: {
                    select: { employee: { select: { firstName: true, lastName: true } } }
                }
            },
            orderBy: { createdAt: 'desc' }
        });
    }
    async updateExpenseClaimStatus(companyId, userId, id, data) {
        const claim = await this.prisma.expenseClaim.findFirst({ where: { id, companyId } });
        if (!claim)
            throw new common_1.NotFoundException('Expense claim not found');
        return this.prisma.expenseClaim.update({
            where: { id },
            data: {
                status: data.status,
                rejectionReason: data.rejectionReason,
                approvedById: userId
            }
        });
    }
    async deleteExpenseClaim(companyId, id, userId) {
        const claim = await this.prisma.expenseClaim.findFirst({
            where: { id, companyId, employee: { userId }, status: 'PENDING' }
        });
        if (!claim)
            throw new common_1.NotFoundException('Pending expense claim not found');
        return this.prisma.expenseClaim.delete({ where: { id } });
    }
    async batchSendPayslipEmails(companyId, month, year) {
        const payslips = await this.prisma.payslip.findMany({
            where: { companyId, month, year },
            include: {
                employee: {
                    include: {
                        user: true,
                        department: true,
                        designation: true
                    }
                },
                items: true
            }
        });
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const monthName = monthNames[month - 1];
        let successCount = 0;
        let failedCount = 0;
        for (const payslip of payslips) {
            const email = payslip.employee?.user?.email;
            if (!email) {
                failedCount++;
                continue;
            }
            const empName = payslip.employee.lastName
                ? `${payslip.employee.firstName} ${payslip.employee.lastName}`
                : payslip.employee.firstName;
            try {
                const { buffer } = await this.pdfService.generatePayslipPdf(payslip);
                const sent = await this.emailService.sendPayslipEmail(email, empName, monthName, year, buffer);
                if (sent)
                    successCount++;
                else
                    failedCount++;
            }
            catch (e) {
                failedCount++;
            }
        }
        return {
            message: `Batch email processing complete`,
            sentCount: successCount,
            failedCount,
            totalCount: payslips.length
        };
    }
};
exports.PayrollService = PayrollService;
exports.PayrollService = PayrollService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        pdf_service_1.PdfService,
        email_service_1.EmailService])
], PayrollService);
//# sourceMappingURL=payroll.service.js.map