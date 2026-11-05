import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { PayrollDryRunResult, PayrollDryRunRow, PayrollService } from '../../services/payroll.service';
import { PayslipViewComponent, PayslipViewData } from '../payslip-view/payslip-view';
import {
  LucideArrowLeft,
  LucideSparkles,
  LucideShieldCheck,
  LucideCalendar,
  LucideChevronDown,
  LucideChevronUp,
  LucideRefreshCw,
  LucideDownload,
  LucideFileText,
  LucideCoins,
  LucideReceipt,
  LucideWallet,
  LucideUsers,
  LucideCheckCircle2,
  LucideAlertCircle,
  LucideAlertTriangle,
  LucideSearch,
  LucideX,
  LucideTrendingUp,
  LucideInfo,
  LucideExternalLink,
  LucideClock,
} from '@lucide/angular';

type Filter = 'ALL' | 'OK' | 'CHECK' | 'BLOCKED';

/**
 * Payroll plan Phase 3: payslips for a month worked out with the new engine
 * and pay profiles, with loss of pay from attendance. Read-only — real
 * payslips and drafts are not touched.
 */
@Component({
  selector: 'app-payroll-dry-run',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucideArrowLeft,
    LucideSparkles,
    LucideShieldCheck,
    LucideCalendar,
    LucideChevronDown,
    LucideChevronUp,
    LucideRefreshCw,
    LucideDownload,
    LucideFileText,
    LucideCoins,
    LucideReceipt,
    LucideWallet,
    LucideUsers,
    LucideCheckCircle2,
    LucideAlertCircle,
    LucideAlertTriangle,
    LucideSearch,
    LucideX,
    LucideTrendingUp,
    LucideInfo,
    LucideExternalLink,
    LucideClock,
    PayslipViewComponent,
  ],
  templateUrl: './payroll-dry-run.html',
  styleUrls: ['./payroll-dry-run.css'],
})
export class PayrollDryRunComponent implements OnInit {
  private payroll = inject(PayrollService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  readonly months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  readonly years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];
  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();
  /** A month still in progress has little attendance yet — show the full month instead. */
  fullMonth = true;
  /** For a month before the pay profiles start (e.g. October): use them anyway. */
  currentProfiles = true;

  result = signal<PayrollDryRunResult | null>(null);
  loading = signal(false);
  filter = signal<Filter>('ALL');
  search = signal('');
  open = signal<Set<number>>(new Set());
  /** The payslip open in the Salary Processing-style viewer. */
  viewing = signal<PayslipViewData | null>(null);

  rows = computed(() => {
    const r = this.result();
    if (!r) return [];
    const f = this.filter();
    const q = this.search().trim().toLowerCase();
    return r.rows.filter((x) =>
      (f === 'ALL' || x.status === f) &&
      (!q || [x.name, x.department, x.employeeCode, x.salaryGroupCode, x.designation].some((v) => (v || '').toLowerCase().includes(q)))
    );
  });

  isAllExpanded = computed(() => {
    const currentRows = this.rows();
    if (!currentRows.length) return false;
    const opened = this.open();
    return currentRows.every((x) => opened.has(x.employeeId));
  });

  ngOnInit() {
    this.run();
  }

  run() {
    this.loading.set(true);
    this.payroll.dryRunPayroll(this.month, this.year, this.fullMonth, this.currentProfiles).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(e?.error?.message || 'Could not run the dry run simulation');
      },
    });
  }

  toggle(id: number) {
    const s = new Set(this.open());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.open.set(s);
  }

  toggleAll() {
    const currentRows = this.rows();
    if (this.isAllExpanded()) {
      this.open.set(new Set());
    } else {
      const s = new Set<number>();
      for (const row of currentRows) {
        if (row.status !== 'BLOCKED') s.add(row.employeeId);
      }
      this.open.set(s);
    }
  }

  /** The dry-run row as the payslip Generate would save: earnings at the full month, loss of pay on its own line. */
  viewPayslip(x: PayrollDryRunRow) {
    const r = this.result();
    if (!r || x.status === 'BLOCKED') return;
    const full = r.fullMonth || x.lopExempt;
    this.viewing.set({
      month: r.month,
      year: r.year,
      status: 'DRY RUN',
      employee: {
        firstName: x.name,
        lastName: '',
        department: x.department ? { name: x.department } : null,
        designation: x.designation ? { name: x.designation } : null,
      },
      workingDays: full ? 'Full month' : x.workingDays ?? 0,
      presentDays: full ? 'Full month' : x.presentDays ?? 0,
      absentDays: x.absences ?? 0,
      items: [
        ...(x.earnings || []).map((l) => ({ componentName: l.name, type: 'EARNING', amount: l.full })),
        ...(x.gst ? [{ componentName: `GST @ ${x.gstPct}%`, type: 'EARNING', amount: x.gst }] : []),
        ...(x.deductions || []).filter((l) => l.paid > 0).map((l) => ({ componentName: l.name, type: 'DEDUCTION', amount: l.paid })),
      ],
      lossOfPay: x.lossOfPay ?? 0,
      expenseAmount: 0,
      totalEarnings: (x.grossFull ?? 0) + (x.gst ?? 0),
      totalDeductions: x.totalDeductions ?? 0,
      netPay: x.net ?? 0,
    });
  }

  back() {
    this.router.navigate(['/payroll/compare']);
  }

  /** One row per employee, every earning and deduction as a column — for Finance's Excel check. */
  exportCsv() {
    const r = this.result();
    if (!r) return;
    const earnCodes = new Map<string, string>();
    const dedCodes = new Map<string, string>();
    for (const x of r.rows) {
      (x.earnings || []).forEach((l) => earnCodes.set(l.code, l.name));
      (x.deductions || []).forEach((l) => dedCodes.set(l.code, l.name));
    }
    const head = [
      'Employee code',
      'Name',
      'Department',
      'Designation',
      'Status',
      'Salary group',
      'Annual CTC',
      'Working days',
      'Present',
      'Absent',
      ...[...earnCodes.values()],
      'Gross (full month)',
      'Loss of pay',
      'Gross paid',
      ...[...dedCodes.values()],
      'Total deductions',
      'Net pay',
      'Employer PF/ESI',
      'Notes',
      'Warnings',
    ];
    const rows = r.rows.map((x) => {
      const e = (code: string) => x.earnings?.find((l) => l.code === code)?.paid ?? '';
      const d = (code: string) => x.deductions?.find((l) => l.code === code)?.paid ?? '';
      return [
        x.employeeCode ?? '',
        x.name,
        x.department ?? '',
        x.designation ?? '',
        x.status,
        x.salaryGroupCode ?? '',
        x.annualCtc ?? '',
        x.workingDays ?? '',
        x.presentDays ?? '',
        x.absences ?? '',
        ...[...earnCodes.keys()].map(e),
        x.grossFull ?? '',
        x.lossOfPay ?? '',
        x.grossPaid ?? '',
        ...[...dedCodes.keys()].map(d),
        x.totalDeductions ?? '',
        x.net ?? '',
        x.employerContributions ?? '',
        (x.notes || []).join(' | '),
        (x.warnings || []).join(' | '),
      ];
    });
    const csv = [head, ...rows]
      .map((row) =>
        row
          .map((v) => {
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(',')
      )
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payroll-dry-run-${r.year}-${String(r.month).padStart(2, '0')}${r.fullMonth ? '-full-month' : ''}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  statusLabel(s: PayrollDryRunRow['status']) {
    return ({ OK: 'Ready', CHECK: 'Needs Review', BLOCKED: 'Can\'t Pay' } as any)[s] || s;
  }

  initials(name: string) {
    return (
      name
        .split(/\s+/)
        .filter((w) => /[A-Za-z]/.test(w))
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('') || '?'
    );
  }

  getAvatarBg(name: string): string {
    const colors = [
      'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      'linear-gradient(135deg, #ec4899, #be185d)',
      'linear-gradient(135deg, #10b981, #047857)',
      'linear-gradient(135deg, #f59e0b, #b45309)',
      'linear-gradient(135deg, #06b6d4, #0e7490)',
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  money(n: number | null | undefined) {
    if (n == null) return '—';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }
}
