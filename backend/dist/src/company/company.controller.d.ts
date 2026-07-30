import { CompanyService } from './company.service';
export declare class CompanyController {
    private readonly companyService;
    constructor(companyService: CompanyService);
    getProfile(req: any): Promise<{
        id: number;
        name: string;
        domain: string | null;
        logoUrl: string | null;
        industry: string | null;
        size: string | null;
        timezone: string | null;
    }>;
    updateProfile(req: any, data: {
        name?: string;
        domain?: string;
        industry?: string;
        size?: string;
        timezone?: string;
        logoUrl?: string;
    }): Promise<{
        id: number;
        name: string;
        domain: string | null;
        logoUrl: string | null;
        industry: string | null;
        size: string | null;
        timezone: string | null;
    }>;
}
