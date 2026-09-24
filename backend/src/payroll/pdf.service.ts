import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

function getLogoDataUri(): string {
  const possiblePaths = [
    path.join(__dirname, '../assets/CESlogo.png'),
    path.join(__dirname, '../../src/assets/CESlogo.png'),
    path.join(process.cwd(), 'src/assets/CESlogo.png'),
    path.join(process.cwd(), 'backend/src/assets/CESlogo.png'),
    path.join(process.cwd(), 'dist/assets/CESlogo.png'),
    path.join(process.cwd(), 'dist/src/assets/CESlogo.png'),
    path.join(process.cwd(), 'assets/CESlogo.png'),
    '/Users/mohitsingh/Documents/AI-Guard/server/src/assets/CESlogo.png',
  ];

  for (const p of possiblePaths) {
    try {
      if (fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        return `data:image/png;base64,${buffer.toString('base64')}`;
      }
    } catch {}
  }
  return 'https://www.ces-pl.com/assets/CESlogo.png';
}

function formatCurrency(n: number | string | null | undefined): string {
  return Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function numberToWordsINR(num: number | null | undefined): string {
  if (!num || isNaN(num) || num <= 0) return 'Zero Rupees Only';
  const a = [
    '', 'One ', 'Two ', 'Three ', 'Four ', 'Five ', 'Six ', 'Seven ', 'Eight ', 'Nine ',
    'Ten ', 'Eleven ', 'Twelve ', 'Thirteen ', 'Fourteen ', 'Fifteen ', 'Sixteen ',
    'Seventeen ', 'Eighteen ', 'Nineteen ',
  ];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const n = Math.floor(num);
  const padded = ('000000000' + n).substr(-9);
  const match = padded.match(/^(\d{2})(\d{2})(\d{2})(\d{1})(\d{2})$/);
  if (!match) return '';
  let str = '';
  str += Number(match[1]) !== 0 ? (a[Number(match[1])] || b[Number(match[1][0])] + ' ' + a[Number(match[1][1])]) + 'Crore ' : '';
  str += Number(match[2]) !== 0 ? (a[Number(match[2])] || b[Number(match[2][0])] + ' ' + a[Number(match[2][1])]) + 'Lakh ' : '';
  str += Number(match[3]) !== 0 ? (a[Number(match[3])] || b[Number(match[3][0])] + ' ' + a[Number(match[3][1])]) + 'Thousand ' : '';
  str += Number(match[4]) !== 0 ? (a[Number(match[4])] || b[Number(match[4][0])] + ' ' + a[Number(match[4][1])]) + 'Hundred ' : '';
  str += Number(match[5]) !== 0 ? (str !== '' ? 'and ' : '') + (a[Number(match[5])] || b[Number(match[5][0])] + ' ' + a[Number(match[5][1])]) : '';
  return str.trim() ? `${str.trim()} Rupees Only` : '';
}

function getChromeExecutablePath(): string | undefined {
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (process.platform === 'darwin' && fs.existsSync(macChrome)) {
    return macChrome;
  }
  return undefined;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);
  private browserPromise: any = null;

  private async getBrowser() {
    if (!this.browserPromise) {
      const puppeteer = require('puppeteer');
      const executablePath = getChromeExecutablePath();
      const options: any = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      };
      if (executablePath) {
        options.executablePath = executablePath;
      }
      this.browserPromise = puppeteer.launch(options);
    }
    return this.browserPromise;
  }

  renderPayslipHtml(payslipData: any, companyLogoUrl?: string): string {
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const month = monthNames[(payslipData.month || 1) - 1];
    const year = payslipData.year;
    const emp = payslipData.employee || {};
    const name = emp.lastName ? `${emp.firstName} ${emp.lastName}` : (emp.firstName || 'Employee');
    const employeeId = emp.employeeCode || (emp.id != null ? String(emp.id) : '-');
    const designation = emp.designation?.name || 'Staff';
    const department = emp.department?.name || 'General';
    const salarySlipNo = `${year}/${String(payslipData.month || 1).padStart(2, '0')}/${emp.id ?? payslipData.id}`;
    const noOfDays = payslipData.workingDays != null ? payslipData.workingDays : (payslipData.presentDays != null ? payslipData.presentDays : 30);
    const ctc = payslipData.ctc || 0;

    const logoDataUri = companyLogoUrl || getLogoDataUri();

    const items: { componentName: string; type: string; amount: number }[] = payslipData.items || [];

    const standardEarnings = [
      'Basic Salary',
      'House Rent Allowance (HRA)',
      'Travel Allowance',
      'Medical Allowance',
      'Special Allowance',
    ];

    const standardDeductions = [
      'Provident Fund (EPF)',
      'Employee State Insurance (ESI)',
      'Tax Deducted at Source (TDS)',
      'Advance Salary',
      'Unpaid Days Deduction',
    ];

    // Compile earnings
    const allEarnings: { label: string; amount: number }[] = standardEarnings.map((stdName) => {
      const found = items.find(
        (i) => i.type === 'EARNING' && i.componentName?.trim().toLowerCase() === stdName.toLowerCase()
      );
      return { label: stdName, amount: found ? Number(found.amount) || 0 : 0 };
    });

    for (const item of items) {
      if (item.type === 'EARNING') {
        const isStd = standardEarnings.some((s) => s.toLowerCase() === item.componentName?.trim().toLowerCase());
        if (!isStd && (Number(item.amount) || 0) > 0) {
          allEarnings.push({ label: item.componentName.trim(), amount: Number(item.amount) || 0 });
        }
      }
    }

    if ((payslipData.expenseAmount || 0) > 0 && !allEarnings.some((e) => /expense/i.test(e.label))) {
      allEarnings.push({ label: 'Expense Reimbursements', amount: Number(payslipData.expenseAmount) || 0 });
    }

    // Compile deductions
    const allDeductions: { label: string; amount: number }[] = standardDeductions.map((stdName) => {
      if (/unpaid days/i.test(stdName)) {
        const found = items.find(
          (i) =>
            i.type === 'DEDUCTION' &&
            (/unpaid days/i.test(i.componentName) || /loss of pay/i.test(i.componentName))
        );
        const amount = found ? Number(found.amount) || 0 : Number(payslipData.lossOfPay) || 0;
        return { label: stdName, amount };
      }
      const found = items.find(
        (i) =>
          i.type === 'DEDUCTION' &&
          (i.componentName?.trim().toLowerCase() === stdName.toLowerCase() ||
            (/pf|provident/i.test(stdName) && /pf|provident/i.test(i.componentName)) ||
            (/esi|insurance/i.test(stdName) && /esi|insurance/i.test(i.componentName)) ||
            (/tds|tax deducted/i.test(stdName) && /tds|tax deducted/i.test(i.componentName)) ||
            (/advance/i.test(stdName) && /advance/i.test(i.componentName)))
      );
      return { label: stdName, amount: found ? Number(found.amount) || 0 : 0 };
    });

    for (const item of items) {
      if (item.type === 'DEDUCTION') {
        const isStd = standardDeductions.some(
          (s) =>
            s.toLowerCase() === item.componentName?.trim().toLowerCase() ||
            (/pf|provident/i.test(s) && /pf|provident/i.test(item.componentName)) ||
            (/esi|insurance/i.test(s) && /esi|insurance/i.test(item.componentName)) ||
            (/tds|tax deducted/i.test(s) && /tds|tax deducted/i.test(item.componentName)) ||
            (/advance/i.test(s) && /advance/i.test(item.componentName)) ||
            (/unpaid days/i.test(s) && (/unpaid/i.test(item.componentName) || /loss of pay/i.test(item.componentName)))
        );
        if (!isStd && (Number(item.amount) || 0) > 0) {
          allDeductions.push({ label: item.componentName.trim(), amount: Number(item.amount) || 0 });
        }
      }
    }

    const grossEarnings = allEarnings.reduce((t, e) => t + e.amount, 0);
    const totalDeductions = allDeductions.reduce((t, d) => t + d.amount, 0);
    const netPay = Math.max(0, payslipData.netPay != null ? Number(payslipData.netPay) : grossEarnings - totalDeductions);
    const netPayWords = numberToWordsINR(netPay);

    // Balance tables with spacer rows
    const earningsCount = allEarnings.length;
    const deductionsCount = allDeductions.length;

    let earningsSpacerRows = '';
    let deductionsSpacerRows = '';

    if (earningsCount > deductionsCount) {
      const diff = earningsCount - deductionsCount;
      deductionsSpacerRows = Array(diff)
        .fill(0)
        .map(
          () => `
        <tr>
          <td style="color: transparent; user-select: none;">&nbsp;</td>
          <td class="amount" style="color: transparent; user-select: none;">&nbsp;</td>
        </tr>
      `
        )
        .join('');
    } else if (deductionsCount > earningsCount) {
      const diff = deductionsCount - earningsCount;
      earningsSpacerRows = Array(diff)
        .fill(0)
        .map(
          () => `
        <tr>
          <td style="color: transparent; user-select: none;">&nbsp;</td>
          <td class="amount" style="color: transparent; user-select: none;">&nbsp;</td>
        </tr>
      `
        )
        .join('');
    }

    const earningsRowsHtml =
      allEarnings
        .map(
          (item) => `
      <tr>
        <td>${item.label}</td>
        <td class="amount">Rs. ${formatCurrency(item.amount)}</td>
      </tr>
    `
        )
        .join('') + earningsSpacerRows;

    const deductionsRowsHtml =
      allDeductions
        .map(
          (item) => `
      <tr>
        <td>${item.label}</td>
        <td class="amount">Rs. ${formatCurrency(item.amount)}</td>
      </tr>
    `
        )
        .join('') + deductionsSpacerRows;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Payslip - ${name || employeeId} - ${month} ${year}</title>
<style>
  @page {
    size: A4;
    margin: 8mm 12mm;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1e293b;
    margin: 0;
    padding: 0;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet {
    position: relative;
    max-width: 780px;
    margin: 0 auto;
    border: 1px solid #cbd5e1;
    border-radius: 8px;
    overflow: hidden;
    background: #ffffff;
  }

  /* Watermark Container */
  .watermark {
    position: absolute;
    top: 56%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-18deg);
    width: 440px;
    opacity: 0.085;
    pointer-events: none;
    z-index: 1;
    text-align: center;
  }
  .watermark img {
    width: 100%;
    height: auto;
  }

  /* Main Document Content */
  .content {
    position: relative;
    z-index: 2;
    padding: 22px 26px 18px 26px;
  }

  /* Left-Aligned Company Header */
  .company-header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    margin-bottom: 14px;
  }
  .company-header .company-logo {
    height: 48px;
    width: auto;
    object-fit: contain;
    margin-bottom: 6px;
  }
  .company-header .company-title {
    font-size: 16px;
    font-weight: 400;
    color: #0f172a;
    margin-bottom: 2px;
    letter-spacing: -0.2px;
  }
  .company-header .company-ownership {
    font-size: 11px;
    font-weight: 600;
    color: #0284c7;
    margin-bottom: 3px;
    letter-spacing: 0.2px;
  }
  .company-header .company-address {
    font-size: 10px;
    color: #334155;
    max-width: 100%;
    line-height: 1.4;
    margin-bottom: 2px;
  }
  .company-header .company-contact {
    font-size: 10.5px;
    color: #334155;
    line-height: 1.35;
  }
  .company-header .company-contact strong {
    font-weight: 700;
    color: #0f172a;
  }

  /* Dark Navy Payslip Banner */
  .payslip-banner {
    background: #111c2e;
    color: #ffffff;
    border-radius: 6px;
    padding: 12px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .banner-title {
    font-size: 18px;
    font-weight: 700;
    letter-spacing: -0.2px;
    color: #ffffff;
  }
  .banner-slip-no {
    font-size: 12px;
    font-weight: 500;
    color: #cbd5e1;
    letter-spacing: 0.3px;
  }

  /* Employee Details Grid */
  .employee-card {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 16px;
  }
  .employee-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 10px 14px;
  }
  .emp-item {
    display: flex;
    flex-direction: column;
  }
  .emp-label {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .emp-value {
    font-size: 12.5px;
    font-weight: 600;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .emp-mono {
    font-family: monospace;
  }

  /* Side-by-side Tables */
  .tables-row {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
  }
  .table-box {
    flex: 1;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    overflow: hidden;
    background: #ffffff;
  }
  .table-box table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }
  .table-box thead {
    background: #f1f5f9;
    border-bottom: 1px solid #e2e8f0;
  }
  .table-box th {
    padding: 8px 12px;
    text-align: left;
    font-size: 10px;
    font-weight: 700;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .table-box th.amount {
    text-align: right;
    white-space: nowrap;
  }
  .table-box td {
    padding: 7px 12px;
    border-bottom: 1px solid #f8fafc;
    color: #334155;
  }
  .table-box td.amount {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    white-space: nowrap;
  }
  .total-row td {
    font-weight: 700;
    font-size: 11.5px;
    padding: 9px 12px;
    border-top: 1.5px solid #cbd5e1;
    border-bottom: none;
  }
  .earnings-total td {
    background: #f8fafc;
    color: #0f172a;
  }
  .deductions-total td {
    background: #f8fafc;
    color: #0f172a;
  }

  /* Net Salary Payable Banner */
  .net-pay-banner {
    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
    color: #ffffff;
    border-radius: 6px;
    padding: 14px 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }
  .net-left {
    display: flex;
    flex-direction: column;
  }
  .net-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #94a3b8;
    margin-bottom: 4px;
  }
  .net-words {
    font-size: 11px;
    font-weight: 500;
    font-style: italic;
    color: #e2e8f0;
    letter-spacing: 0.2px;
  }
  .net-right {
    text-align: right;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .net-amount {
    font-size: 22px;
    font-weight: 800;
    color: #ffffff;
    letter-spacing: -0.5px;
    font-variant-numeric: tabular-nums;
  }
  .net-currency-tag {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    color: #94a3b8;
    letter-spacing: 0.8px;
    margin-top: 2px;
  }

  /* Formal Footer */
  .footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-top: 1px solid #f1f5f9;
    padding-top: 10px;
    font-size: 10px;
    color: #94a3b8;
  }
  .footer-left {
    display: flex;
    align-items: center;
  }
  .footer-right {
    font-weight: 500;
    color: #64748b;
  }
</style>
</head>
<body>
  <div class="sheet">
    <!-- Watermark -->
    <div class="watermark" aria-hidden="true">
      <img src="${logoDataUri}" alt="" />
    </div>

    <div class="content">
      <!-- Left-Aligned Company Header -->
      <div class="company-header">
        <img src="${logoDataUri}" alt="A Unit of N-Expert Solutions Private Limited" class="company-logo" />
        <div class="company-title"><span style="font-weight:400;">A Unit of</span> N-Expert Solutions Private Limited</div>
        <div class="company-address">Assotech Business Cresterra, Tower-2 | 9th Floor | Unit No. #901-902, Sector-135, Noida 201304, Uttar Pradesh</div>
        <div class="company-contact"><strong>Email:</strong> info@ces-pl.com</div>
      </div>

      <!-- Dark Navy Payslip Banner -->
      <div class="payslip-banner">
        <div class="banner-title">Payslip for ${month} ${year}</div>
        ${salarySlipNo ? `<div class="banner-slip-no">Slip No: ${salarySlipNo}</div>` : ''}
      </div>

      <!-- Employee Metadata Card -->
      <div class="employee-card">
        <div class="employee-grid">
          <div class="emp-item">
            <span class="emp-label">Employee Name</span>
            <span class="emp-value">${name || '-'}</span>
          </div>
          <div class="emp-item">
            <span class="emp-label">Employee ID</span>
            <span class="emp-value emp-mono">${employeeId || '-'}</span>
          </div>
          <div class="emp-item">
            <span class="emp-label">Designation</span>
            <span class="emp-value">${designation || '-'}</span>
          </div>
          <div class="emp-item">
            <span class="emp-label">Department</span>
            <span class="emp-value">${department || '-'}</span>
          </div>
          <div class="emp-item">
            <span class="emp-label">No. of Days</span>
            <span class="emp-value">${noOfDays !== undefined && noOfDays !== null && noOfDays !== '' ? noOfDays : 30}</span>
          </div>
        </div>
      </div>

      <!-- Side-by-Side Earnings and Deductions Tables -->
      <div class="tables-row">
        <!-- Earnings Column -->
        <div class="table-box">
          <table>
            <thead>
              <tr>
                <th>Earnings</th>
                <th class="amount">Amount (Rs.)</th>
              </tr>
            </thead>
            <tbody>
              ${earningsRowsHtml}
              <tr class="total-row earnings-total">
                <td>Total Gross Earnings</td>
                <td class="amount">Rs. ${formatCurrency(grossEarnings)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Deductions Column -->
        <div class="table-box">
          <table>
            <thead>
              <tr>
                <th>Deductions</th>
                <th class="amount">Amount (Rs.)</th>
              </tr>
            </thead>
            <tbody>
              ${deductionsRowsHtml}
              <tr class="total-row deductions-total">
                <td>Total Deductions</td>
                <td class="amount">Rs. ${formatCurrency(totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Net Salary Payable Banner -->
      <div class="net-pay-banner">
        <div class="net-left">
          <div class="net-title">Net Salary Payable (Take Home)</div>
          ${netPayWords ? `<div class="net-words">${netPayWords}</div>` : ''}
        </div>
        <div class="net-right">
          <div class="net-amount">Rs. ${formatCurrency(netPay)}</div>
          <div class="net-currency-tag">₹ Indian Rupees (INR)</div>
        </div>
      </div>

      <!-- Formal Footer -->
      <div class="footer">
        <div class="footer-left">
          <span>This is a system-generated document and does not require a physical signature.</span>
        </div>
        <div class="footer-right">
          <span>Confidential • A Unit of N-Expert Solutions Private Limited</span>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  async generatePayslipPdf(
    payslipData: any,
    companyLogoUrl?: string
  ): Promise<{ buffer: Buffer; isPdf: boolean }> {
    const htmlContent = this.renderPayslipHtml(payslipData, companyLogoUrl);

    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();
      try {
        await page.setContent(htmlContent, { waitUntil: 'load' });
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '15px', bottom: '15px', left: '15px', right: '15px' },
        });
        return { buffer: Buffer.from(pdfBytes), isPdf: true };
      } finally {
        await page.close();
      }
    } catch (e: any) {
      this.logger.warn('Puppeteer shared browser error, attempting fresh launch: ' + (e?.message || e));
      this.browserPromise = null;
      try {
        const puppeteer = require('puppeteer');
        const executablePath = getChromeExecutablePath();
        const options: any = {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        };
        if (executablePath) {
          options.executablePath = executablePath;
        }
        const browser = await puppeteer.launch(options);
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'load' });
        const pdfBytes = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '15px', bottom: '15px', left: '15px', right: '15px' },
        });
        await browser.close();
        return { buffer: Buffer.from(pdfBytes), isPdf: true };
      } catch (err) {
        this.logger.error('Puppeteer not available, returning HTML fallback', err);
        return { buffer: Buffer.from(htmlContent, 'utf-8'), isPdf: false };
      }
    }
  }
}
