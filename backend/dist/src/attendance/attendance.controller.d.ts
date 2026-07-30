import { AttendanceService } from './attendance.service';
export declare class AttendanceController {
    private readonly attendanceService;
    constructor(attendanceService: AttendanceService);
    getTodayAttendance(req: any): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    } | null>;
    getMyHistory(req: any): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    }[]>;
    clockIn(req: any, data: {
        lat?: number;
        lng?: number;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    }>;
    clockOut(req: any, data: {
        lat?: number;
        lng?: number;
    }): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        date: Date;
        employeeId: number;
        status: string;
        clockIn: Date | null;
        clockOut: Date | null;
        clockInLat: number | null;
        clockInLng: number | null;
        clockOutLat: number | null;
        clockOutLng: number | null;
        isLate: boolean;
        isEarlyLeave: boolean;
    }>;
}
