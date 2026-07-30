import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async generatePayslipPdf(payslipData: any, companyLogoUrl?: string): Promise<{ buffer: Buffer; isPdf: boolean }> {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthName = monthNames[(payslipData.month || 1) - 1];
    const year = payslipData.year;
    const empName = payslipData.employee?.lastName 
      ? `${payslipData.employee.firstName} ${payslipData.employee.lastName}`
      : (payslipData.employee?.firstName || 'Employee');
    const deptName = payslipData.employee?.department?.name || 'General';
    const desigName = payslipData.employee?.designation?.name || 'N/A';
    const logoUrl = companyLogoUrl || 'http://localhost:3000/uploads/logo.png';

    const items = payslipData.items || [];
    const earnings = items.filter((i: any) => i.type === 'EARNING');
    const deductions = items.filter((i: any) => i.type === 'DEDUCTION');

    const maxRows = Math.max(earnings.length, deductions.length, 1);
    let tableRowsHtml = '';

    for (let i = 0; i < maxRows; i++) {
      const earn = earnings[i];
      const ded = deductions[i];
      tableRowsHtml += `
        <tr>
          <td>${earn ? earn.componentName : '-'}</td>
          <td>${earn ? '₹' + earn.amount.toLocaleString('en-IN') : '-'}</td>
          <td>${ded ? ded.componentName : '-'}</td>
          <td>${ded ? '₹' + ded.amount.toLocaleString('en-IN') : '-'}</td>
        </tr>
      `;
    }

    if (payslipData.lossOfPay > 0) {
      tableRowsHtml += `
        <tr>
          <td>-</td>
          <td>-</td>
          <td>Loss of Pay (LOP)</td>
          <td>₹${payslipData.lossOfPay.toLocaleString('en-IN')}</td>
        </tr>
      `;
    }

    if (payslipData.expenseAmount > 0) {
      tableRowsHtml += `
        <tr>
          <td>Expense Reimbursements</td>
          <td>₹${payslipData.expenseAmount.toLocaleString('en-IN')}</td>
          <td>-</td>
          <td>-</td>
        </tr>
      `;
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          body {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            color: #0F172A;
            margin: 0;
            padding: 20px;
            position: relative;
            background: #ffffff;
          }
          .watermark {
            position: absolute;
            top: 45%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 250px;
            opacity: 0.06;
            pointer-events: none;
            z-index: 0;
          }
          .content {
            position: relative;
            z-index: 1;
          }
          .header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
          }
          .company-title {
            font-size: 20px;
            font-weight: 700;
            color: #FF5200;
            margin: 0 0 2px 0;
          }
          .company-subtitle {
            font-size: 12px;
            color: #64748B;
            margin: 0;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 6px 16px;
            background: #F8FAFC;
            border: 1px solid #E2E8F0;
            border-radius: 8px;
            padding: 10px 14px;
            font-size: 12px;
            margin-bottom: 16px;
          }
          .meta-label { color: #475569; }
          .meta-val { color: #0F172A; }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          th, td {
            padding: 8px 12px;
            border: 1px solid #E2E8F0;
            text-align: left;
          }
          th {
            background: #F1F5F9;
            font-size: 12px;
            font-weight: 700;
            color: #334155;
          }
          td {
            font-size: 13px;
            color: #1E293B;
          }
          tfoot th {
            background: #F8FAFC;
          }
          .banner {
            background: #0F172A;
            color: #FFFFFF;
            padding: 12px 18px;
            border-radius: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 16px;
          }
          .banner-label { font-size: 13px; font-weight: 400; }
          .banner-net { color: #10B981; font-size: 18px; font-weight: 700; margin: 0; }
        </style>
      </head>
      <body>
        <img src="${logoUrl}" class="watermark" />
        <div class="content">
          <div class="header">
            <img src="${logoUrl}" style="height: 32px; max-width: 120px; object-fit: contain;" />
            <div>
              <h1 class="company-title">CES Tech ERP</h1>
              <p class="company-subtitle">Official Monthly Salary Slip - ${monthName} ${year}</p>
            </div>
          </div>

          <div class="meta-grid">
            <div><span class="meta-label">Employee Name:</span> <span class="meta-val">${empName}</span></div>
            <div><span class="meta-label">Department:</span> <span class="meta-val">${deptName}</span></div>
            <div><span class="meta-label">Designation:</span> <span class="meta-val">${desigName}</span></div>
            <div><span class="meta-label">Working Days:</span> <span class="meta-val">${payslipData.workingDays}</span></div>
            <div><span class="meta-label">Present Days:</span> <span class="meta-val">${payslipData.presentDays}</span></div>
            <div><span class="meta-label">Absent Days:</span> <span class="meta-val">${payslipData.absentDays}</span></div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Earnings</th>
                <th>Amount (₹)</th>
                <th>Deductions</th>
                <th>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
            <tfoot>
              <tr>
                <th>Total Earnings</th>
                <th>₹${((payslipData.totalEarnings || 0) + (payslipData.expenseAmount || 0)).toLocaleString('en-IN')}</th>
                <th>Total Deductions</th>
                <th>₹${((payslipData.totalDeductions || 0) + (payslipData.lossOfPay || 0)).toLocaleString('en-IN')}</th>
              </tr>
            </tfoot>
          </table>

          <div class="banner">
            <span class="banner-label">Net Salary Payable:</span>
            <h2 class="banner-net">₹${(payslipData.netPay || 0).toLocaleString('en-IN')}</h2>
          </div>
        </div>
      </body>
      </html>
    `;

    try {
      const puppeteer = require('puppeteer');
      const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
      });
      await browser.close();
      return { buffer: Buffer.from(pdfBuffer), isPdf: true };
    } catch (e) {
      this.logger.warn('Puppeteer not available, returning HTML buffer fallback');
      return { buffer: Buffer.from(htmlContent, 'utf-8'), isPdf: false };
    }
  }
}
