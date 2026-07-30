import { PayrollService } from './payroll.service';
export declare class PayrollController {
    private readonly payrollService;
    constructor(payrollService: PayrollService);
    getSalaryComponents(req: any): Promise<{
        id: number;
        name: string;
        type: string;
        isPreDefined: boolean;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
    }[]>;
    createSalaryComponent(req: any, data: {
        name: string;
        type: string;
        description?: string;
    }): Promise<{
        id: number;
        name: string;
        type: string;
        isPreDefined: boolean;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
    }>;
    updateSalaryComponent(req: any, id: number, data: {
        name?: string;
        description?: string;
    }): Promise<{
        id: number;
        name: string;
        type: string;
        isPreDefined: boolean;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
    }>;
    deleteSalaryComponent(req: any, id: number): Promise<{
        id: number;
        name: string;
        type: string;
        isPreDefined: boolean;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
    }>;
    getSalaryStructure(req: any, employeeId: number): Promise<({
        component: {
            id: number;
            name: string;
            type: string;
            isPreDefined: boolean;
            description: string | null;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        componentId: number;
        amount: number;
    })[]>;
    updateSalaryStructure(req: any, employeeId: number, items: {
        componentId: number;
        amount: number;
    }[]): Promise<({
        component: {
            id: number;
            name: string;
            type: string;
            isPreDefined: boolean;
            description: string | null;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        componentId: number;
        amount: number;
    })[]>;
    generatePayslips(req: any, body: {
        month: number;
        year: number;
    }): any;
    batchSendEmails(req: any, body: {
        month: number;
        year: number;
    }): Promise<{
        message: string;
        sentCount: number;
        failedCount: number;
        totalCount: number;
    }>;
    getMyPayslips(req: any): Promise<({
        employee: {
            firstName: string;
            lastName: string;
            department: {
                name: string;
            } | null;
            designation: {
                name: string;
            } | null;
        };
        items: {
            id: number;
            type: string;
            createdAt: Date;
            updatedAt: Date;
            amount: number;
            payslipId: number;
            componentName: string;
        }[];
    } & {
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        month: number;
        year: number;
        workingDays: number;
        presentDays: number;
        absentDays: number;
        halfDays: number;
        totalEarnings: number;
        totalDeductions: number;
        lossOfPay: number;
        expenseAmount: number;
        netPay: number;
        status: string;
        paidOn: Date | null;
    })[]>;
    getPayslips(req: any, month?: number, year?: number): any;
    batchFinalizePayslips(req: any, body: {
        month: number;
        year: number;
    }): Promise<import("@prisma/client").Prisma.BatchPayload>;
    markPayslipsPaid(req: any, body: {
        month: number;
        year: number;
    }): Promise<import("@prisma/client").Prisma.BatchPayload>;
    updatePayslip(req: any, id: number, data: {
        lossOfPay?: number;
        totalEarnings?: number;
        totalDeductions?: number;
        expenseAmount?: number;
        status?: string;
    }): Promise<{
        employee: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            firstName: string;
            lastName: string;
            departmentId: number | null;
            designationId: number | null;
            phone: string | null;
            userId: number;
            branchId: number | null;
            managerId: number | null;
            shiftId: number | null;
            onboardingStatus: string;
            salutation: string | null;
            country: string | null;
            state: string | null;
            city: string | null;
            language: string | null;
            gender: string | null;
            dateOfBirth: Date | null;
            slackId: string | null;
            maritalStatus: string | null;
            address: string | null;
            about: string | null;
            avatarUrl: string | null;
            themePref: string | null;
            currency: string | null;
        };
        items: {
            id: number;
            type: string;
            createdAt: Date;
            updatedAt: Date;
            amount: number;
            payslipId: number;
            componentName: string;
        }[];
    } & {
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        month: number;
        year: number;
        workingDays: number;
        presentDays: number;
        absentDays: number;
        halfDays: number;
        totalEarnings: number;
        totalDeductions: number;
        lossOfPay: number;
        expenseAmount: number;
        netPay: number;
        status: string;
        paidOn: Date | null;
    }>;
    createExpenseClaim(req: any, data: {
        title: string;
        description?: string;
        amount: number;
        category?: string;
        receiptUrl?: string;
    }): Promise<{
        id: number;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        amount: number;
        month: number | null;
        year: number | null;
        status: string;
        title: string;
        category: string;
        receiptUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    }>;
    getMyExpenseClaims(req: any): Promise<({
        approvedBy: {
            employee: {
                firstName: string;
                lastName: string;
            } | null;
        } | null;
    } & {
        id: number;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        amount: number;
        month: number | null;
        year: number | null;
        status: string;
        title: string;
        category: string;
        receiptUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    })[]>;
    getAllExpenseClaims(req: any): Promise<({
        employee: {
            id: number;
            firstName: string;
            lastName: string;
            department: {
                name: string;
            } | null;
        };
        approvedBy: {
            employee: {
                firstName: string;
                lastName: string;
            } | null;
        } | null;
    } & {
        id: number;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        amount: number;
        month: number | null;
        year: number | null;
        status: string;
        title: string;
        category: string;
        receiptUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    })[]>;
    updateExpenseClaimStatus(req: any, id: number, data: {
        status: string;
        rejectionReason?: string;
    }): Promise<{
        id: number;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        amount: number;
        month: number | null;
        year: number | null;
        status: string;
        title: string;
        category: string;
        receiptUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    }>;
    deleteExpenseClaim(req: any, id: number): Promise<{
        id: number;
        description: string | null;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        amount: number;
        month: number | null;
        year: number | null;
        status: string;
        title: string;
        category: string;
        receiptUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    }>;
}
