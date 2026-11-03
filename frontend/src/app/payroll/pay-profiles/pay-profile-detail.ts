import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { AuthService } from '../../services/auth.service';
import {
  DetailState,
  MasterSalaryGroup,
  PayDetailSuggestion,
  PayProfileDetail,
  PayProfileVersion,
  PayrollDropdownList,
  PayrollService,
  SalaryCalculationResult,
} from '../../services/payroll.service';

/**
 * One employee's pay profile (Payroll plan W9): today's breakup from the
 * engine, every version, statutory details, and adding a new version.
 */
@Component({
  selector: 'app-pay-profile-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './pay-profile-detail.html',
  styleUrls: ['./pay-profiles.css'],
})
export class PayProfileDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private payroll = inject(PayrollService);
  private auth = inject(AuthService);
  private toast = inject(HotToastService);

  employeeId = 0;
  data = signal<PayProfileDetail | null>(null);
  loading = signal(true);
  groups = signal<MasterSalaryGroup[]>([]);
  dropdowns = signal<PayrollDropdownList[]>([]);

  canEdit = computed(() => ['SUPERADMIN', 'SUPER_ADMIN', 'ADMIN', 'FINANCE'].includes(this.auth.currentUser()?.role));

  current = computed<PayProfileVersion | null>(() => {
    const d = this.data();
    return d?.versions.find((v) => v.version === d.currentVersion) ?? null;
  });

  workerTypes = computed(() => this.dropdowns().find((l) => l.listKey === 'WORKER_TYPE')?.options ?? []);
  paymentMethods = computed(() => this.dropdowns().find((l) => l.listKey === 'PAYMENT_METHOD')?.options ?? []);

  // ── Statutory & bank details ──
  details: Record<string, string | null> = {};
  savingDetails = signal(false);

  // ── Verifying PAN / UAN / bank ──
  verifying = signal<string | null>(null);

  /** One block per detail: its documents, AI suggestions and input fields. */
  verifyBlocks(d: PayProfileDetail) {
    const e = d.employee;
    const docs = (type: string) => e.documents.filter((x) => x.documentType === type);
    const sugg = (fields: string[]) => d.suggestions.filter((s) => s.status === 'SUGGESTED' && fields.includes(s.field));
    const unreadable = (type: string) => d.suggestions.filter((s) => s.field === 'UNREADABLE' && docs(type).some((x) => x.id === s.documentId));
    const state = (has: boolean, at: string | null, fields: string[], type: string): DetailState =>
      has && at ? 'VERIFIED' : sugg(fields).length ? 'SUGGESTED' : has ? 'UNVERIFIED' : docs(type).length ? 'DOCUMENT' : 'MISSING';
    const blocks = [
      {
        detail: 'PAN' as const, title: 'PAN', verifiedAt: e.panVerifiedAt,
        state: state(!!e.panNumber, e.panVerifiedAt, ['PAN'], 'PAN Card'),
        documents: docs('PAN Card'), suggestions: sugg(['PAN']), unreadable: unreadable('PAN Card'),
        fields: [{ key: 'panNumber', label: 'PAN number', placeholder: 'ABCDE1234F', max: 10 }],
      },
      {
        detail: 'UAN' as const, title: 'UAN', verifiedAt: e.uanVerifiedAt,
        state: state(!!e.uanNumber, e.uanVerifiedAt, ['UAN'], 'UAN'),
        documents: docs('UAN'), suggestions: sugg(['UAN']), unreadable: unreadable('UAN'),
        fields: [{ key: 'uanNumber', label: 'UAN (12 digits)', placeholder: '100200300400', max: 12 }],
      },
      {
        detail: 'BANK' as const, title: 'Bank account', verifiedAt: e.bankVerifiedAt,
        state: state(!!(e.bankAccountNumber && e.ifscCode), e.bankVerifiedAt, ['BANK_ACCOUNT', 'IFSC', 'BANK_NAME'], 'Bank Proof / Cancelled Cheque'),
        documents: docs('Bank Proof / Cancelled Cheque'), suggestions: sugg(['BANK_ACCOUNT', 'IFSC', 'BANK_NAME']), unreadable: unreadable('Bank Proof / Cancelled Cheque'),
        fields: [
          { key: 'bankAccountNumber', label: 'Account number', placeholder: 'Digits only', max: 18 },
          { key: 'ifscCode', label: 'IFSC', placeholder: 'HDFC0001234', max: 11 },
          { key: 'bankName', label: 'Bank name', placeholder: 'e.g. HDFC Bank', max: 80 },
        ],
      },
    ];
    return d.employee.payType === 'CONSULTANT' ? blocks.filter((b) => b.detail !== 'UAN') : blocks;
  }

  stateLabel(s: DetailState) {
    return ({ VERIFIED: '✓ Verified', UNVERIFIED: 'Entered, not verified', SUGGESTED: 'AI suggestion to check', DOCUMENT: 'Document only', MISSING: 'Missing' } as any)[s];
  }

  fieldLabel(f: string) {
    return ({ PAN: 'PAN', UAN: 'UAN', BANK_ACCOUNT: 'account', IFSC: 'IFSC', BANK_NAME: 'bank' } as any)[f] || f;
  }

  /** Put the AI's value in the box — Finance still presses Verify after checking the document. */
  useSuggestion(sg: PayDetailSuggestion) {
    const key = ({ PAN: 'panNumber', UAN: 'uanNumber', BANK_ACCOUNT: 'bankAccountNumber', IFSC: 'ifscCode', BANK_NAME: 'bankName' } as any)[sg.field];
    if (key) this.details[key] = sg.value;
  }

  rejectSuggestion(sg: PayDetailSuggestion) {
    this.payroll.rejectPaySuggestion(sg.id).subscribe({
      next: () => { this.toast.success('Suggestion removed'); this.load(); },
      error: (e) => this.toast.error(e?.error?.message || 'Failed'),
    });
  }

  verify(detail: 'PAN' | 'UAN' | 'BANK') {
    const pick = (k: string) => this.details[k] ?? null;
    const body =
      detail === 'PAN' ? { detail, panNumber: pick('panNumber') }
      : detail === 'UAN' ? { detail, uanNumber: pick('uanNumber') }
      : { detail, bankAccountNumber: pick('bankAccountNumber'), ifscCode: pick('ifscCode'), bankName: pick('bankName') };
    this.verifying.set(detail);
    this.payroll.verifyPayDetail(this.employeeId, body).subscribe({
      next: () => { this.verifying.set(null); this.toast.success(`${detail === 'BANK' ? 'Bank account' : detail} verified`); this.load(); },
      error: (e) => { this.verifying.set(null); this.toast.error(e?.error?.message || 'Failed to verify'); },
    });
  }

  // ── New version ──
  formOpen = signal(false);
  form: any = null;
  preview = signal<SalaryCalculationResult | null>(null);
  previewing = signal(false);
  saving = signal(false);

  /** Salary groups that fit the chosen worker type's "pays as". */
  groupChoices = computed(() => {
    const wt = this.workerTypes().find((w) => w.value === this.formWorkerType());
    const kind = (t: string) => (t === 'CONTRACTOR' ? 'CONSULTANT' : t === 'INTERN' ? 'TRAINEE' : t);
    return this.groups().filter((g) => !wt?.['paysAs' as keyof typeof wt] || kind(g.payeeType) === (wt as any).paysAs);
  });
  formWorkerType = signal<string | null>(null);

  /** Lines in the chosen group that may be overridden. */
  overridableLines = computed(() => {
    const g = this.groups().find((x) => x.code === this.formGroupCode());
    return (g?.lines || []).filter((l) => l.overrideAllowed);
  });
  formGroupCode = signal<string | null>(null);

  ngOnInit() {
    this.employeeId = Number(this.route.snapshot.paramMap.get('employeeId'));
    this.load();
    this.payroll.getPayrollSalaryGroups().subscribe({ next: (g) => this.groups.set(g), error: () => {} });
    this.payroll.getPayrollDropdowns().subscribe({ next: (d) => this.dropdowns.set(d), error: () => {} });
  }

  load() {
    this.loading.set(true);
    this.payroll.getPayProfile(this.employeeId).subscribe({
      next: (d) => {
        this.data.set(d);
        const e = d.employee;
        this.details = {
          panNumber: e.panNumber, uanNumber: e.uanNumber, pfNumber: e.pfNumber, esiNumber: e.esiNumber,
          bankName: e.bankName, bankAccountNumber: e.bankAccountNumber, ifscCode: e.ifscCode,
        };
        this.loading.set(false);
      },
      error: (e) => { this.loading.set(false); this.toast.error(e?.error?.message || 'Failed to load the pay profile'); },
    });
  }

  back() {
    this.router.navigate(['/payroll/pay-profiles']);
  }

  saveDetails() {
    this.savingDetails.set(true);
    this.payroll.updatePayDetails(this.employeeId, this.details).subscribe({
      next: () => { this.savingDetails.set(false); this.toast.success('Details saved'); this.load(); },
      error: (e) => { this.savingDetails.set(false); this.toast.error(e?.error?.message || 'Failed to save details'); },
    });
  }

  openNewVersion() {
    const cur = this.current();
    this.form = {
      salaryGroupCode: cur?.salaryGroupCode ?? null,
      annualCtc: cur?.annualCtc ?? null,
      effectiveFrom: this.firstOfNextMonth(),
      workerType: cur?.workerType ?? null,
      paymentMethod: cur?.paymentMethod ?? null,
      overrides: { ...(cur?.overrides || {}) } as Record<string, number | null>,
      reason: '',
    };
    this.formWorkerType.set(this.form.workerType);
    this.formGroupCode.set(this.form.salaryGroupCode);
    this.preview.set(null);
    this.formOpen.set(true);
    this.runPreview();
  }

  onWorkerTypeChange(v: string | null) {
    this.form.workerType = v;
    this.formWorkerType.set(v);
    if (this.form.salaryGroupCode && !this.groupChoices().some((g) => g.code === this.form.salaryGroupCode)) {
      this.form.salaryGroupCode = null;
      this.formGroupCode.set(null);
    }
    this.runPreview();
  }

  onGroupChange(v: string | null) {
    this.form.salaryGroupCode = v;
    this.formGroupCode.set(v);
    this.form.overrides = {};
    this.runPreview();
  }

  private cleanOverrides(): Record<string, number> | undefined {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.form?.overrides || {})) {
      if (v !== null && v !== undefined && (v as any) !== '') out[k] = Number(v);
    }
    return Object.keys(out).length ? out : undefined;
  }

  /** Breakup for what's in the form, from the same engine the profile will use. */
  runPreview() {
    if (!this.form?.salaryGroupCode || !(Number(this.form.annualCtc) > 0)) { this.preview.set(null); return; }
    this.previewing.set(true);
    this.payroll.calculateSalary({
      groupCode: this.form.salaryGroupCode,
      annualCtc: Number(this.form.annualCtc),
      overrides: this.cleanOverrides(),
    }).subscribe({
      next: (r) => { this.preview.set(r); this.previewing.set(false); },
      error: (e) => { this.previewing.set(false); this.preview.set(null); this.toast.error(e?.error?.message || 'Could not calculate'); },
    });
  }

  saveVersion() {
    const f = this.form;
    if (!f.salaryGroupCode) { this.toast.error('Pick a salary group'); return; }
    if (!(Number(f.annualCtc) > 0)) { this.toast.error('Enter the annual CTC'); return; }
    if (!f.effectiveFrom) { this.toast.error('Pick the date it takes effect from'); return; }
    const overrides = this.cleanOverrides();
    if (overrides && !f.reason.trim()) { this.toast.error('Give a reason for the overrides'); return; }
    this.saving.set(true);
    this.payroll.addPayProfileVersion(this.employeeId, {
      salaryGroupCode: f.salaryGroupCode,
      annualCtc: Number(f.annualCtc),
      effectiveFrom: f.effectiveFrom,
      workerType: f.workerType || null,
      paymentMethod: f.paymentMethod || null,
      overrides: overrides ?? null,
      reason: f.reason.trim() || null,
      source: this.data()?.versions.length ? 'REVISION' : 'MANUAL',
    }).subscribe({
      next: (r) => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.toast.success(`Version ${r.profile.version} saved`);
        this.load();
      },
      error: (e) => { this.saving.set(false); this.toast.error(e?.error?.message || 'Failed to save'); },
    });
  }

  /** Breakup lines grouped the way a payslip reads. */
  sections(b: SalaryCalculationResult | null) {
    if (!b) return [];
    const by = (cat: string) => b.lines.filter((l) => l.category === cat && l.monthly !== 0);
    return [
      { title: 'Earnings', lines: by('EARNING'), total: b.grossMonthly, totalLabel: 'Gross' },
      { title: 'Deductions', lines: by('EMPLOYEE_DEDUCTION'), total: b.totalDeductionsMonthly, totalLabel: 'Total deductions' },
      { title: 'Paid by the company (in CTC)', lines: by('EMPLOYER_CONTRIBUTION'), total: b.totalEmployerContributionsMonthly, totalLabel: 'Employer contributions' },
    ].filter((s) => s.lines.length);
  }

  optionLabel(list: { value: string; label: string }[], v: string | null) {
    return v ? list.find((o) => o.value === v)?.label ?? v : '—';
  }

  isUpcoming(v: PayProfileVersion) {
    return new Date(v.effectiveFrom) > new Date();
  }

  money(n: number | null | undefined) {
    return n == null ? '—' : '₹' + Math.round(n).toLocaleString('en-IN');
  }

  private firstOfNextMonth() {
    const d = new Date();
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
  }
}
