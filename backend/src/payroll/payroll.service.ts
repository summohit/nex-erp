import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PdfService } from './pdf.service';
import { EmailService } from './email.service';

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

@Injectable()
export class PayrollService {
  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
    private emailService: EmailService
  ) {}

  // ==================== 1. SALARY COMPONENTS ====================

  async getSalaryComponents(companyId: number) {
    const existing = await this.prisma.salaryComponent.findMany({
      where: { companyId },
      orderBy: { id: 'asc' }
    });

    if (existing.length === 0) {
      // Seed predefined components
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

  async createSalaryComponent(companyId: number, data: { name: string; type: string; description?: string }) {
    if (!['EARNING', 'DEDUCTION'].includes(data.type)) {
      throw new BadRequestException('Component type must be EARNING or DEDUCTION');
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

  async updateSalaryComponent(companyId: number, id: number, data: { name?: string; description?: string }) {
    const comp = await this.prisma.salaryComponent.findFirst({ where: { id, companyId } });
    if (!comp) throw new NotFoundException('Component not found');
    return this.prisma.salaryComponent.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description
      }
    });
  }

  async deleteSalaryComponent(companyId: number, id: number) {
    const comp = await this.prisma.salaryComponent.findFirst({ where: { id, companyId } });
    if (!comp) throw new NotFoundException('Component not found');
    if (comp.isPreDefined) {
      throw new BadRequestException('Predefined components cannot be deleted');
    }
    return this.prisma.salaryComponent.delete({ where: { id } });
  }

  // ==================== 2. SALARY STRUCTURE ====================

  async getSalaryStructure(companyId: number, employeeId: number) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        salaryStructures: {
          include: { component: true }
        }
      }
    });
    if (!employee) throw new NotFoundException('Employee not found');
    return employee.salaryStructures;
  }

  async updateSalaryStructure(companyId: number, employeeId: number, items: { componentId: number; amount: number }[]) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

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

  // ==================== 3. PAYSLIPS ====================

  private isWeeklyOff(date: Date, rules: string[]): boolean {
    const day = date.getDay(); // 0=Sun, 6=Sat
    const dateNum = date.getDate();
    const occurrence = Math.ceil(dateNum / 7); // 1st, 2nd, 3rd, 4th, 5th occurrence in the month
    
    for (const rule of rules) {
      const parts = rule.split(':');
      const ruleDay = parseInt(parts[0], 10);
      const condition = parts[1] || 'all';

      if (day === ruleDay) {
        if (condition === 'all') return true;
        if (condition === 'even' && occurrence % 2 === 0) return true;
        if (condition === 'odd' && occurrence % 2 !== 0) return true;
      }
    }
    return false;
  }

  async generatePayslips(companyId: number, month: number, year: number) {
    const existingPayslips = await this.prisma.payslip.findMany({
      where: { companyId, month: Number(month), year: Number(year) },
      select: { status: true }
    });

    if (existingPayslips.length > 0) {
      const hasFinalized = existingPayslips.some(p => p.status === 'FINALIZED' || p.status === 'PAID');
      if (hasFinalized) {
        throw new BadRequestException('Blocked or overrides existing DRAFT. Cannot override FINALIZED.');
      }
    }

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
    const endDate = new Date(year, month, 0); // Last day of month
    const totalDaysInMonth = endDate.getDate();

    for (const emp of employees) {
      // Branch Weekly Offs logic
      const weeklyOffsConfig = emp.branch?.weeklyOffs || "0";
      const weeklyOffRules = weeklyOffsConfig.split(',').map(n => n.trim());
      
      let workingDaysInMonth = 0;
      for (let d = 1; d <= totalDaysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        if (!this.isWeeklyOff(date, weeklyOffRules)) {
          workingDaysInMonth++;
        }
      }

      // Fallback if configured poorly (e.g. all days are weekly off)
      if (workingDaysInMonth === 0) workingDaysInMonth = totalDaysInMonth;

      // Calculate attendance statistics for this month
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
        // Simple YYYY-MM-DD string for safe comparison ignoring timezones
        const dateStr = att.date.toISOString().split('T')[0];
        attendanceMap.set(dateStr, att.status);
        if (att.status === 'PRESENT') presentCount++;
        else if (att.status === 'HALF_DAY') halfDayCount++;
      }

      let unexcusedAbsences = 0;

      for (let d = 1; d <= totalDaysInMonth; d++) {
        const date = new Date(year, month - 1, d);
        // Only check working days for LOP
        if (!this.isWeeklyOff(date, weeklyOffRules)) {
          const dateStr = date.toISOString().split('T')[0];
          const status = attendanceMap.get(dateStr);
          
          if (status !== 'PRESENT' && status !== 'HALF_DAY') {
            // Check if covered by approved paid leave
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

      // Fetch approved expense claims for this period
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

      // Earnings & Deductions from Structure
      let totalEarnings = 0;
      let totalDeductions = 0;
      const payslipItemsData: { componentName: string; type: string; amount: number }[] = [];

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
          } else if (struct.component.type === 'DEDUCTION') {
            totalDeductions += amt;
            payslipItemsData.push({
              componentName: struct.component.name,
              type: 'DEDUCTION',
              amount: amt
            });
          }
        }
      }

      // --- STATUTORY COMPLIANCE ENGINE ---
      if (basicSalary === 0 && totalEarnings > 0) {
        basicSalary = totalEarnings * 0.5;
      }

      // PF: 12% of Basic Salary
      const pfAmount = Math.round(basicSalary * 0.12);
      if (pfAmount > 0 && !payslipItemsData.some(i => i.componentName.includes('Provident Fund'))) {
        payslipItemsData.push({ componentName: 'Provident Fund (PF) [Statutory]', type: 'DEDUCTION', amount: pfAmount });
        totalDeductions += pfAmount;
      }

      // ESI: 0.75% of Gross if Gross <= 21,000
      if (totalEarnings > 0 && totalEarnings <= 21000 && !payslipItemsData.some(i => i.componentName.includes('State Insurance'))) {
        const esiAmount = Math.round(totalEarnings * 0.0075);
        payslipItemsData.push({ componentName: 'Employee State Insurance (ESI) [Statutory]', type: 'DEDUCTION', amount: esiAmount });
        totalDeductions += esiAmount;
      }

      // PT: Flat ₹200 if Gross > 15,000
      if (totalEarnings > 15000 && !payslipItemsData.some(i => i.componentName.includes('Professional Tax'))) {
        const ptAmount = 200;
        payslipItemsData.push({ componentName: 'Professional Tax [Statutory]', type: 'DEDUCTION', amount: ptAmount });
        totalDeductions += ptAmount;
      }

      // TDS: 10% on amount exceeding 50,000
      if (totalEarnings > 50000 && !payslipItemsData.some(i => i.componentName.includes('TDS'))) {
        const tdsAmount = Math.round((totalEarnings - 50000) * 0.10);
        payslipItemsData.push({ componentName: 'Income Tax (TDS) [Statutory]', type: 'DEDUCTION', amount: tdsAmount });
        totalDeductions += tdsAmount;
      }
      // --- END STATUTORY COMPLIANCE ---

      // Loss of Pay (LOP) calculation based on actual unexcused working day absences
      const dailyRate = workingDaysInMonth > 0 ? (totalEarnings / workingDaysInMonth) : 0;
      const lossOfPay = Math.round(dailyRate * unexcusedAbsences * 100) / 100;

      const netPay = Math.max(0, Math.round((totalEarnings - totalDeductions - lossOfPay + expenseAmount) * 100) / 100);

      // Upsert DRAFT Payslip
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

  async getPayslips(companyId: number, month?: number, year?: number) {
    const where: any = { companyId };
    if (month) where.month = Number(month);
    if (year) where.year = Number(year);

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

  async getMyPayslips(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee profile not found');

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

  async updatePayslip(companyId: number, id: number, data: { lossOfPay?: number; totalEarnings?: number; totalDeductions?: number; expenseAmount?: number; status?: string }) {
    const payslip = await this.prisma.payslip.findFirst({ where: { id, companyId } });
    if (!payslip) throw new NotFoundException('Payslip not found');

    const lossOfPay = Math.max(0, data.lossOfPay !== undefined ? Number(data.lossOfPay) : payslip.lossOfPay);
    const totalEarnings = Math.max(0, data.totalEarnings !== undefined ? Number(data.totalEarnings) : payslip.totalEarnings);
    const totalDeductions = Math.max(0, data.totalDeductions !== undefined ? Number(data.totalDeductions) : payslip.totalDeductions);
    const expenseAmount = Math.max(0, data.expenseAmount !== undefined ? Number(data.expenseAmount) : payslip.expenseAmount);

    const netPay = Math.max(0, Math.round((totalEarnings - totalDeductions - lossOfPay + expenseAmount) * 100) / 100);

    // Sync deduction line items if totalDeductions was manually adjusted
    if (data.totalDeductions !== undefined) {
      const deductionItems = await this.prisma.payslipItem.findMany({
        where: { payslipId: id, type: 'DEDUCTION' }
      });
      if (deductionItems.length === 1) {
        await this.prisma.payslipItem.update({
          where: { id: deductionItems[0].id },
          data: { amount: Math.max(0, totalDeductions) }
        });
      } else if (deductionItems.length > 1) {
        const oldSum = deductionItems.reduce((sum, item) => sum + item.amount, 0);
        for (let i = 0; i < deductionItems.length; i++) {
          const item = deductionItems[i];
          const newAmt = oldSum > 0 ? Math.round((item.amount / oldSum) * totalDeductions * 100) / 100 : (i === 0 ? totalDeductions : 0);
          await this.prisma.payslipItem.update({
            where: { id: item.id },
            data: { amount: Math.max(0, newAmt) }
          });
        }
      }
    }

    // Sync earning line items if totalEarnings was manually adjusted
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
            data: { amount: Math.max(0, newAmt) }
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

  async batchFinalizePayslips(companyId: number, month: number, year: number) {
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

  async markPayslipsPaid(companyId: number, month: number, year: number) {
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

  // ==================== 4. EXPENSE CLAIMS ====================

  async createExpenseClaim(companyId: number, userId: number, data: { title: string; description?: string; amount: number; category?: string; receiptUrl?: string; purchaseDate?: string; purchasedFrom?: string; projectCode?: string; projectName?: string; projectId?: number }) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    const amount = Number(data.amount);
    if (!amount || amount <= 0) {
      throw new BadRequestException('Claim amount must be greater than zero');
    }

    const MAX_CLAIM_LIMIT = 100000;
    if (amount > MAX_CLAIM_LIMIT) {
      throw new BadRequestException(`Expense limit exceeded. Maximum claim limit is ₹1,00,000 (${amount.toLocaleString('en-IN')} cannot be claimed).`);
    }

    if (data.purchaseDate) {
      const pDate = new Date(data.purchaseDate);
      const today = new Date();
      if (pDate > today) {
        throw new BadRequestException('Purchase date cannot be in the future');
      }
    }

    return this.prisma.expenseClaim.create({
      data: {
        employeeId: employee.id,
        companyId,
        title: data.title,
        description: data.description,
        amount: amount,
        category: data.category || 'OTHER',
        receiptUrl: data.receiptUrl,
        purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : null,
        purchasedFrom: data.purchasedFrom || null,
        projectCode: data.projectCode || null,
        projectName: data.projectName || null,
        projectId: data.projectId || null,
        status: 'PENDING'
      }
    });
  }


  async getMyExpenseClaims(companyId: number, userId: number) {
    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    if (!employee) throw new NotFoundException('Employee not found');

    return this.prisma.expenseClaim.findMany({
      where: { employeeId: employee.id, companyId },
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

  async getDashboardSummary(companyId: number) {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();

    const [payrollAgg, pendingCount, pendingSum, recentPending] = await Promise.all([
      this.prisma.payslip.aggregate({
        where: { companyId, month, year },
        _sum: { netPay: true, totalEarnings: true, totalDeductions: true },
        _count: true
      }),
      this.prisma.expenseClaim.count({ where: { companyId, status: 'PENDING' } }),
      this.prisma.expenseClaim.aggregate({
        where: { companyId, status: 'PENDING' },
        _sum: { amount: true }
      }),
      this.prisma.expenseClaim.findMany({
        where: { companyId, status: 'PENDING' },
        include: { employee: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5
      })
    ]);

    return {
      payrollSummary: {
        month,
        year,
        payslipCount: payrollAgg._count,
        totalNetPay: payrollAgg._sum.netPay || 0,
        totalEarnings: payrollAgg._sum.totalEarnings || 0,
        totalDeductions: payrollAgg._sum.totalDeductions || 0
      },
      pendingExpenseClaims: {
        count: pendingCount,
        totalAmount: pendingSum._sum.amount || 0,
        recent: recentPending
      }
    };
  }

  async getAllExpenseClaims(companyId: number) {
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

  async updateExpenseClaimStatus(companyId: number, userId: number, id: number, data: { status: string; rejectionReason?: string }, userRole?: string) {
    // Only privileged roles can approve/reject expense claims
    const privilegedRoles = ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE'];
    if (!userRole || !privilegedRoles.includes(userRole)) {
      throw new BadRequestException('You do not have permission to approve or reject expense claims');
    }

    const claim = await this.prisma.expenseClaim.findFirst({ where: { id, companyId }, include: { employee: true } });
    if (!claim) throw new NotFoundException('Expense claim not found');

    // Prevent self-approval: check if the approver is the same person who submitted
    if (claim.employee) {
      const approverEmployee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
      if (approverEmployee && approverEmployee.id === claim.employeeId) {
        throw new BadRequestException('You cannot approve or reject your own expense claim');
      }
    }

    return this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: data.status,
        rejectionReason: data.rejectionReason,
        approvedById: userId
      }
    });
  }

  async deleteExpenseClaim(companyId: number, id: number, userId: number, userRole?: string) {
    const claim = await this.prisma.expenseClaim.findFirst({
      where: { id, companyId }
    });
    if (!claim) throw new NotFoundException('Expense claim not found');

    const employee = await this.prisma.employee.findFirst({ where: { userId, companyId } });
    const isOwner = employee && claim.employeeId === employee.id;
    const isPrivileged = userRole === 'SUPERADMIN' || userRole === 'ADMIN' || userRole === 'HR';

    if (!isOwner && !isPrivileged) {
      throw new BadRequestException('You do not have permission to delete this expense claim');
    }

    return this.prisma.expenseClaim.delete({ where: { id } });
  }

  async batchSendPayslipEmails(companyId: number, month: number, year: number) {
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
        const sent = await this.emailService.sendPayslipEmail(
          email,
          empName,
          monthName,
          year,
          buffer
        );
        if (sent) successCount++;
        else failedCount++;
      } catch (e) {
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
}
