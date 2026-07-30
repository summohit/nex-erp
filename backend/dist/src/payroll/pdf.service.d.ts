export declare class PdfService {
    private readonly logger;
    generatePayslipPdf(payslipData: any, companyLogoUrl?: string): Promise<{
        buffer: Buffer;
        isPdf: boolean;
    }>;
}
