import { LeavesService } from './leaves.service';
export declare class LeavesController {
    private readonly leavesService;
    constructor(leavesService: LeavesService);
    assignBalance(req: any, data: {
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
    getMyBalances(req: any, year: string): Promise<({
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
    getAllBalances(req: any, year: string): Promise<({
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
    requestLeave(req: any, data: {
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
    getMyRequests(req: any): Promise<({
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
    getRequests(req: any, filter: any): Promise<({
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
    updateRequest(req: any, id: number, data: {
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
    cancelRequest(req: any, id: number): Promise<{
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
    updateRequestStatus(req: any, id: number, data: {
        status: string;
        rejectionReason?: string;
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
}
