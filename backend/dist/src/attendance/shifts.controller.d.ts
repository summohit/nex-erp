import { ShiftsService } from './shifts.service';
export declare class ShiftsController {
    private readonly shiftsService;
    constructor(shiftsService: ShiftsService);
    findAll(req: any): Promise<({
        _count: {
            employees: number;
        };
    } & {
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    })[]>;
    create(req: any, data: any): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    }>;
    update(req: any, id: number, data: any): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    }>;
    delete(req: any, id: number): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        startTime: string;
        endTime: string;
        bufferTimeMinutes: number;
    }>;
}
