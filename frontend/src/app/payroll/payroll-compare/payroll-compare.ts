import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { PayrollCompareResult, PayrollCompareRow, PayrollService } from '../../services/payroll.service';
import {
  LucideArrowLeft,
  LucideArrowRight,
  LucideGitCompare,
  LucideScale,
  LucideTrendingUp,
  LucideTrendingDown,
  LucideUsers,
  LucideCheckCircle2,
  LucideAlertCircle,
  LucideAlertTriangle,
  LucideCalendar,
  LucideCalendarDays,
  LucideSparkles,
  LucideChevronDown,
  LucideChevronUp,
  LucideRefreshCw,
  LucideInfo,
  LucideSearch,
  LucideX,
} from '@lucide/angular';

type Filter = 'ALL' | 'DIFFERENT' | 'NO_PROFILE' | 'NO_SALARY';

/**
 * Payroll plan Phase 3, step 1: the current monthly run vs the new engine for
 * one month, per employee, with the reason for every difference. Read-only.
 */
@Component({
  selector: 'app-payroll-compare',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucideArrowLeft,
    LucideArrowRight,
    LucideGitCompare,
    LucideScale,
    LucideTrendingUp,
    LucideTrendingDown,
    LucideUsers,
    LucideCheckCircle2,
    LucideAlertCircle,
    LucideAlertTriangle,
    LucideCalendar,
    LucideCalendarDays,
    LucideSparkles,
    LucideChevronDown,
    LucideChevronUp,
    LucideRefreshCw,
    LucideInfo,
    LucideSearch,
    LucideX,
  ],
  templateUrl: './payroll-compare.html',
  styleUrls: ['./payroll-compare.css'],
})
export class PayrollCompareComponent implements OnInit {
  private payroll = inject(PayrollService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  readonly months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  readonly years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];
  month = new Date().getMonth() + 1;
  year = new Date().getFullYear();

  result = signal<PayrollCompareResult | null>(null);
  loading = signal(false);
  filter = signal<Filter>('DIFFERENT');
  search = signal('');
  open = signal<Set<number>>(new Set());

  rows = computed(() => {
    const r = this.result();
    if (!r) return [];
    const f = this.filter();
    const q = this.search().trim().toLowerCase();
    return r.rows.filter((x) => {
      const matchFilter = f === 'ALL' || x.status === f || (f === 'DIFFERENT' && (x.status === 'DIFFERENT' || x.status === 'SAME'));
      if (!matchFilter) return false;
      if (!q) return true;
      return (
        x.name.toLowerCase().includes(q) ||
        (x.employeeCode && x.employeeCode.toLowerCase().includes(q)) ||
        (x.department && x.department.toLowerCase().includes(q)) ||
        (x.salaryGroupCode && x.salaryGroupCode.toLowerCase().includes(q))
      );
    });
  });

  ngOnInit() {
    this.run();
  }

  run() {
    this.loading.set(true);
    this.payroll.comparePayroll(this.month, this.year).subscribe({
      next: (r) => { this.result.set(r); this.loading.set(false); },
      error: (e) => { this.loading.set(false); this.toast.error(e?.error?.message || 'Could not run the comparison'); },
    });
  }

  toggle(id: number) {
    const s = new Set(this.open());
    if (s.has(id)) s.delete(id); else s.add(id);
    this.open.set(s);
  }

  back() {
    this.router.navigate(['/payroll/pay-profiles']);
  }

  readonly pieces: { key: 'gross' | 'pf' | 'esi' | 'pt' | 'tds' | 'other' | 'net'; label: string }[] = [
    { key: 'gross', label: 'Gross' },
    { key: 'pf', label: 'PF' },
    { key: 'esi', label: 'ESI' },
    { key: 'pt', label: 'Professional Tax' },
    { key: 'tds', label: 'TDS' },
    { key: 'other', label: 'Other deductions' },
    { key: 'net', label: 'Net pay' },
  ];

  statusLabel(s: PayrollCompareRow['status']) {
    return ({
      SAME: 'Identical Match',
      DIFFERENT: 'Variance Detected',
      NO_PROFILE: 'No Pay Profile',
      NO_SALARY: 'No Salary Record',
      NEW_ONLY: 'New Engine Only',
      NO_GROUP: 'Group Missing',
      ERROR: 'Calculation Error',
    } as any)[s] || s;
  }

  initials(name: string) {
    return name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  }

  getAvatarBg(name: string): string {
    const colors = [
      'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      'linear-gradient(135deg, #ec4899, #be185d)',
      'linear-gradient(135deg, #10b981, #047857)',
      'linear-gradient(135deg, #f59e0b, #b45309)',
      'linear-gradient(135deg, #06b6d4, #0e7490)',
      'linear-gradient(135deg, #6366f1, #4338ca)',
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  money(n: number | null | undefined) {
    if (n == null) return '—';
    const v = Math.round(n);
    return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN');
  }

  signed(n: number | null | undefined) {
    if (n == null) return '—';
    const v = Math.round(n);
    return v === 0 ? '₹0' : (v > 0 ? '+₹' : '−₹') + Math.abs(v).toLocaleString('en-IN');
  }

  isSame(n: number | null | undefined): boolean {
    return Math.abs(n ?? 0) <= 1;
  }

  parseReason(why: string) {
    const match = why.match(/^([^:]+):\s*(.+?)\s*—\s*(.+)$/);
    if (match) {
      return {
        component: match[1].trim(),
        delta: match[2].trim(),
        explanation: match[3].trim(),
      };
    }
    return { component: null, delta: null, explanation: why };
  }
}
