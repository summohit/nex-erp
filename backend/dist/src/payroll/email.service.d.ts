export declare class EmailService {
    private readonly logger;
    private transporter;
    constructor();
    sendPayslipEmail(toEmail: string, employeeName: string, monthName: string, year: number, pdfBuffer: Buffer): Promise<boolean>;
}
