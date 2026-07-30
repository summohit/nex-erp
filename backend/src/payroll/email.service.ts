import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.ethereal.email',
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || 'demo@ces-pl.com',
        pass: process.env.SMTP_PASS || 'demopass',
      },
    });
  }

  async sendPayslipEmail(
    toEmail: string,
    employeeName: string,
    monthName: string,
    year: number,
    pdfBuffer: Buffer
  ): Promise<boolean> {
    try {
      const mailOptions = {
        from: `"CES Tech ERP Payroll" <${process.env.SMTP_FROM || 'payroll@ces-pl.com'}>`,
        to: toEmail,
        subject: `Your Salary Payslip for ${monthName} ${year} - CES Tech ERP`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
            <h2>Hello ${employeeName},</h2>
            <p>Your salary payslip for <strong>${monthName} ${year}</strong> has been generated and is attached to this email as a PDF document.</p>
            <p>Please review the attached document. If you have any questions regarding your earnings or deductions, contact the HR / Payroll department.</p>
            <br/>
            <p>Best regards,<br/><strong>Payroll Team</strong><br/>CES Tech ERP</p>
          </div>
        `,
        attachments: [
          {
            filename: `Payslip_${employeeName.replace(/\s+/g, '_')}_${monthName}_${year}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      };

      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`Payslip email sent to ${toEmail}: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send payslip email to ${toEmail}`, error);
      return false;
    }
  }
}
