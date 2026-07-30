import { PrismaService } from '../prisma/prisma.service';
export declare class LeavesService {
    private prisma;
    constructor(prisma: PrismaService);
    assignLeaveBalance(data: {
        employeeId: number;
        leaveTypeId: number;
        allocated: number;
        year: number;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        year: number;
        employeeId: number;
        leaveTypeId: number;
        allocated: number;
        used: number;
        carriedOver: number;
    }>;
    getMyBalances(userId: number, year: number): Promise<({
        leaveType: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            description: string | null;
            defaultDays: number;
            isPaid: boolean;
            carryForward: boolean;
            carryForwardLimit: number;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        year: number;
        employeeId: number;
        leaveTypeId: number;
        allocated: number;
        used: number;
        carriedOver: number;
    })[]>;
    getAllBalances(companyId: number, year: number): Promise<({
        employee: {
            id: number;
            firstName: string;
            lastName: string;
        };
        leaveType: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            description: string | null;
            defaultDays: number;
            isPaid: boolean;
            carryForward: boolean;
            carryForwardLimit: number;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        year: number;
        employeeId: number;
        leaveTypeId: number;
        allocated: number;
        used: number;
        carriedOver: number;
    })[]>;
    requestLeave(userId: number, data: {
        leaveTypeId: number;
        startDate: string;
        endDate: string;
        reason?: string;
        attachmentUrl?: string;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        status: string;
        leaveTypeId: number;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        attachmentUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    }>;
    getRequests(companyId: number, filter: any): Promise<({
        employee: {
            id: number;
            firstName: string;
            lastName: string;
        };
        leaveType: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            description: string | null;
            defaultDays: number;
            isPaid: boolean;
            carryForward: boolean;
            carryForwardLimit: number;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        status: string;
        leaveTypeId: number;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        attachmentUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    })[]>;
    updateRequest(userId: number, requestId: number, data: {
        startDate?: string;
        endDate?: string;
        reason?: string;
        attachmentUrl?: string;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        status: string;
        leaveTypeId: number;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        attachmentUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    }>;
    cancelRequest(userId: number, requestId: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        status: string;
        leaveTypeId: number;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        attachmentUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    }>;
    getMyRequests(userId: number): Promise<({
        leaveType: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            description: string | null;
            defaultDays: number;
            isPaid: boolean;
            carryForward: boolean;
            carryForwardLimit: number;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        status: string;
        leaveTypeId: number;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        attachmentUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    })[]>;
    updateRequestStatus(userId: number, requestId: number, status: string, rejectionReason?: string): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        status: string;
        leaveTypeId: number;
        startDate: Date;
        endDate: Date;
        reason: string | null;
        attachmentUrl: string | null;
        rejectionReason: string | null;
        approvedById: number | null;
    }>;
}
