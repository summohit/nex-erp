import { PrismaService } from '../prisma/prisma.service';
import { PermissionsService } from '../permissions/permissions.service';
export declare class EmployeesService {
    private prisma;
    private permissions;
    constructor(prisma: PrismaService, permissions: PermissionsService);
    findAll(companyId: number): Promise<({
        user: {
            email: string;
            role: string;
        };
        department: {
            name: string;
        } | null;
        shift: {
            id: number;
            name: string;
            startTime: string;
            endTime: string;
        } | null;
        designation: {
            name: string;
        } | null;
        branch: {
            name: string;
        } | null;
    } & {
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
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
        departmentId: number | null;
        designationId: number | null;
        userId: number;
        branchId: number | null;
        managerId: number | null;
        shiftId: number | null;
    })[]>;
    create(companyId: number, data: any): Promise<{
        user: {
            email: string;
            role: string;
        };
        department: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            isActive: boolean;
            defaultRole: string;
        } | null;
        shift: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            startTime: string;
            endTime: string;
            bufferTimeMinutes: number;
        } | null;
        designation: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            isActive: boolean;
            departmentId: number | null;
            canEditProfiles: boolean;
        } | null;
        branch: {
            id: number;
            companyId: number;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            startTime: string;
            endTime: string;
            address: string | null;
            latitude: number | null;
            longitude: number | null;
            weeklyOffs: string;
        } | null;
        manager: {
            id: number;
            firstName: string;
            lastName: string;
        } | null;
    } & {
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
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
        departmentId: number | null;
        designationId: number | null;
        userId: number;
        branchId: number | null;
        managerId: number | null;
        shiftId: number | null;
    }>;
    update(id: number, companyId: number, data: any): Promise<{
        user: {
            email: string;
            role: string;
        };
        department: {
            name: string;
        } | null;
        designation: {
            name: string;
        } | null;
    } & {
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
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
        departmentId: number | null;
        designationId: number | null;
        userId: number;
        branchId: number | null;
        managerId: number | null;
        shiftId: number | null;
    }>;
    delete(id: number, companyId: number): Promise<{
        success: boolean;
    }>;
    getMyProfile(companyId: number, currentUserId: number): Promise<{
        isOwner: boolean;
        user: {
            id: number;
            email: string;
            role: string;
        };
        department: {
            name: string;
        } | null;
        designation: {
            name: string;
        } | null;
        emergencyContacts: {
            id: number;
            email: string | null;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            employeeId: number;
            mobile: string;
            relationship: string;
        }[];
        documents: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            employeeId: number;
            fileName: string;
            fileUrl: string;
        }[];
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
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
        departmentId: number | null;
        designationId: number | null;
        userId: number;
        branchId: number | null;
        managerId: number | null;
        shiftId: number | null;
    }>;
    getProfile(id: number, companyId: number, currentUserId: number): Promise<{
        isOwner: boolean;
        user: {
            id: number;
            email: string;
            role: string;
        };
        department: {
            name: string;
        } | null;
        shift: {
            name: string;
            startTime: string;
            endTime: string;
        } | null;
        designation: {
            name: string;
        } | null;
        branch: {
            name: string;
        } | null;
        manager: {
            id: number;
            firstName: string;
            lastName: string;
        } | null;
        emergencyContacts: {
            id: number;
            email: string | null;
            createdAt: Date;
            updatedAt: Date;
            name: string;
            employeeId: number;
            mobile: string;
            relationship: string;
        }[];
        documents: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            employeeId: number;
            fileName: string;
            fileUrl: string;
        }[];
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
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
        departmentId: number | null;
        designationId: number | null;
        userId: number;
        branchId: number | null;
        managerId: number | null;
        shiftId: number | null;
    }>;
    private checkProfileEditPermission;
    updateProfile(id: number, companyId: number, currentUserId: number, role: string, data: any): Promise<{
        id: number;
        companyId: number;
        createdAt: Date;
        updatedAt: Date;
        firstName: string;
        lastName: string;
        phone: string | null;
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
        departmentId: number | null;
        designationId: number | null;
        userId: number;
        branchId: number | null;
        managerId: number | null;
        shiftId: number | null;
    }>;
    addContact(id: number, companyId: number, currentUserId: number, role: string, data: any): Promise<{
        id: number;
        email: string | null;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        employeeId: number;
        mobile: string;
        relationship: string;
    }>;
    deleteContact(id: number, contactId: number, companyId: number, currentUserId: number, role: string): Promise<{
        id: number;
        email: string | null;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        employeeId: number;
        mobile: string;
        relationship: string;
    }>;
    addDocument(id: number, companyId: number, currentUserId: number, role: string, data: any): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        fileName: string;
        fileUrl: string;
    }>;
    deleteDocument(id: number, documentId: number, companyId: number, currentUserId: number, role: string): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        employeeId: number;
        fileName: string;
        fileUrl: string;
    }>;
}
