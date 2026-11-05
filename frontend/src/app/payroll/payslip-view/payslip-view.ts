import { Component, EventEmitter, Input, Output, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';

/** The shape the Salary Processing payslip modal reads. */
export interface PayslipViewData {
  month: number;
  year: number;
  status: string;
  employee: { firstName: string; lastName: string; department?: { name: string } | null; designation?: { name: string } | null };
  workingDays: number | string;
  presentDays: number | string;
  absentDays: number;
  items: { componentName: string; type: 'EARNING' | 'DEDUCTION' | string; amount: number }[];
  lossOfPay: number;
  expenseAmount: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A payslip laid out exactly like the Salary Processing payslip modal, for
 * payslips that aren't saved (the dry run). Buttons go in via <ng-content>.
 */
@Component({
  selector: 'app-payslip-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './payslip-view.html',
  styleUrls: ['./payslip-view.css'],
})
export class PayslipViewComponent {
  private auth = inject(AuthService);
  @Input({ required: true }) payslip!: PayslipViewData;
  /** Shown in place of the status, e.g. "DRY RUN — NOT SAVED". */
  @Input() statusLabel: string | null = null;
  @Output() closed = new EventEmitter<void>();

  logoUrl = computed(() => (this.auth.currentUser() as any)?.company?.logoUrl || '/logo.png');

  /** Consultants get a fee, not a salary. */
  isConsultant() { return (this.payslip?.items || []).some((i) => i.type === 'EARNING' && /professional fee|consultant fee/i.test(i.componentName || '')); }
  monthName(m: number) { return MONTHS[m - 1] || ''; }
  cleanComponentName(name: string) { return name ? name.replace(' [Statutory]', '') : ''; }
  isStatutory(name: string) { return name ? name.includes('[Statutory]') : false; }
  money(n: number) { return (n || 0).toLocaleString('en-IN'); }

  /** Same wording as the Salary Processing payslip (PayrollComponent.amountInWords). */
  amountInWords(amount: number): string {
    const n = Math.floor(Math.abs(amount || 0));
    if (n === 0) return 'Zero Rupees Only';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen',
      'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const under100 = (v: number): string => (v < 20 ? ones[v] : `${tens[Math.floor(v / 10)]}${v % 10 ? ' ' + ones[v % 10] : ''}`);
    const under1000 = (v: number): string => {
      const h = Math.floor(v / 100);
      const r = v % 100;
      return [h ? `${ones[h]} Hundred` : '', r ? (h ? 'and ' : '') + under100(r) : ''].filter(Boolean).join(' ');
    };
    const parts: string[] = [];
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const rest = n % 1000;
    if (crore) parts.push(`${under1000(crore)} Crore`);
    if (lakh) parts.push(`${under100(lakh)} Lakh`);
    if (thousand) parts.push(`${under100(thousand)} Thousand`);
    if (rest) parts.push(under1000(rest));
    return `${parts.join(' ')} Rupees Only`;
  }
}
