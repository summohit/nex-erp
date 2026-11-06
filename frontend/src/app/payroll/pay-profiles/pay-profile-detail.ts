import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
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
  PayProfileRow,
} from '../../services/payroll.service';
import {
  LucideArrowLeft,
  LucideChevronDown,
  LucidePlus,
  LucideSave,
  LucideCheck,
  LucideCheckCircle2,
  LucideAlertCircle,
  LucideFileText,
  LucideBuilding,
  LucideCreditCard,
  LucideShieldCheck,
  LucideReceipt,
  LucideCalculator,
  LucideCalendarDays,
  LucideSparkles,
  LucideCopy,
  LucideEye,
  LucideHistory,
  LucideX,
  LucideRefreshCw,
  LucideChevronRight,
} from '@lucide/angular';

/**
 * One employee's pay profile (Payroll plan W9): today's breakup from the
 * engine, every version, statutory details, and adding a new version.
 */
@Component({
  selector: 'app-pay-profile-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucideChevronDown,
    LucideArrowLeft,
    LucidePlus,
    LucideSave,
    LucideCheck,
    LucideCheckCircle2,
    LucideAlertCircle,
    LucideFileText,
    LucideBuilding,
    LucideCreditCard,
    LucideShieldCheck,
    LucideReceipt,
    LucideCalculator,
    LucideCalendarDays,
    LucideSparkles,
    LucideCopy,
    LucideEye,
    LucideHistory,
    LucideX,
    LucideRefreshCw,
    LucideChevronRight,
  ],
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

  // ── Person switcher (5 Nov 2026) ──
  people = signal<PayProfileRow[]>([]);
  switcherOpen = signal(false);
  switcherQuery = signal('');
  switcherList = computed(() => {
    const q = this.switcherQuery().trim().toLowerCase();
    const all = this.people();
    return q ? all.filter((p) => `${p.name} ${p.email ?? ''} ${p.employeeCode ?? ''}`.toLowerCase().includes(q)) : all;
  });
  currentPerson = computed(() => this.people().find((p) => p.employeeId === this.data()?.employee?.id) ?? null);
  switchTo(p: PayProfileRow) {
    this.switcherOpen.set(false);
    this.switcherQuery.set('');
    if (p.employeeId !== this.employeeId) this.router.navigate(['/payroll/pay-profiles', p.employeeId]);
  }
  initialsOf(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase(); }
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
  details: Record<string, any> = {};
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
    return ({ VERIFIED: '✓ Verified', UNVERIFIED: 'Entered, not verified', SUGGESTED: 'Suggested — check and verify', DOCUMENT: 'Document only', MISSING: 'Missing' } as any)[s];
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
  /** Field errors show after the first Save, then update as the form is fixed. */
  submitted = signal(false);
  serverError = signal<string | null>(null);

  /** Salary groups that fit the chosen worker type's "pays as". */
  groupChoices = computed(() => {
    const wt = this.workerTypes().find((w) => w.value === this.formWorkerType());
    const kind = (t: string) => (t === 'CONTRACTOR' ? 'CONSULTANT' : t === 'INTERN' ? 'TRAINEE' : t);
    return this.groups().filter((g) => !wt?.['paysAs' as keyof typeof wt] || kind(g.payeeType) === (wt as any).paysAs);
  });
  formWorkerType = signal<string | null>(null);

  /** Lines in the chosen group that may be overridden. */
  /** Per-person amounts the group allows, except Basic and reimbursements (they have their own fields). */
  overridableLines = computed(() => {
    const g = this.groups().find((x) => x.code === this.formGroupCode());
    return (g?.lines || []).filter((l) => l.overrideAllowed && !/_REIMB$/.test(l.component?.code || '') && l.component?.code !== 'BASIC');
  });
  /** The group lets Basic be set per person. */
  basicOverridable = computed(() => {
    const g = this.groups().find((x) => x.code === this.formGroupCode());
    return !!(g?.lines || []).find((l) => l.overrideAllowed && l.component?.code === 'BASIC');
  });
  /** Basic the group's rule gives: 50% of the monthly CTC. */
  ruleBasic(): number | null {
    const ctc = Number(this.form?.annualCtc);
    return ctc > 0 ? Math.round(ctc / 12 / 2) : null;
  }
  defaultBasic(): number | null { return this.ruleBasic(); }

  /** Gross and CTC are both typed (5 Nov 2026); gross only applies to employee groups. */
  grossApplies(): boolean {
    const g = this.groups().find((x) => x.code === this.form?.salaryGroupCode);
    return !g || g.payeeType === 'EMPLOYEE';
  }
  amountsChanged() { this.runPreview(); }
  /** '2026-27' for a date (April–March); today when empty. */
  private fyOf(date?: string): string {
    const d = date ? new Date(date) : new Date();
    const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  }
  /** Gross + employer PF/ESI over the CTC is allowed (5 Nov 2026) but flagged. */
  grossWarning(): string | null {
    const gross = Number(this.form?.grossMonthly), monthly = Number(this.form?.annualCtc) / 12;
    if (!this.grossApplies() || !(gross > 0) || !(monthly > 0)) return null;
    const employer = (this.preview()?.lines || []).filter((l: any) => l.category === 'EMPLOYER_CONTRIBUTION' && l.code !== 'OTHER_EMPLOYER_COST').reduce((a: number, l: any) => a + l.monthly, 0);
    return gross + employer > monthly + 0.5 ? `Gross + employer PF/ESI (${this.money(gross + employer)}) is more than the monthly CTC (${this.money(monthly)}). You can still save.` : null;
  }

  /** Scroll to and focus the first field with an error. */
  private focusFirstError(errors: Record<string, string>) {
    const order = ['salaryGroupCode', 'annualCtc', 'grossMonthly', 'override:BASIC', 'effectiveFrom', 'reason'];
    const key = order.find((k) => errors[k]) ?? Object.keys(errors)[0];
    const id = 'f-' + key.replace(':', '-');
    setTimeout(() => {
      const el = document.getElementById(id) as HTMLElement | null;
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); }
    });
  }

  /** Custom Basic is off (hidden) by default; on shows the Basic field for this person. */
  customBasic = false;
  onCustomBasic(on: boolean) {
    if (!on) { delete this.form.overrides['BASIC']; this.runPreview(); }
  }
  /** The group's Other Reimbursement line, if it has one. */
  reimbursementLine = computed(() => {
    const g = this.groups().find((x) => x.code === this.formGroupCode());
    return (g?.lines || []).find((l) => l.overrideAllowed && l.component?.code === 'OTHER_REIMB') ?? null;
  });

  /** GST toggle: on shows GSTIN + GST % (default 18); off clears both. */
  gstOn = false;
  onGstToggle(on: boolean) {
    if (on) { if (this.details['gstPct'] == null || this.details['gstPct'] === '') this.details['gstPct'] = 18; }
    else { this.details['gstin'] = null; this.details['gstPct'] = null; }
  }
  formGroupCode = signal<string | null>(null);

  ngOnInit() {
    // Re-load when the person changes through the switcher (same component, new route param).
    this.route.paramMap.subscribe((pm) => {
      const id = Number(pm.get('employeeId'));
      if (!id || id === this.employeeId) return;
      this.employeeId = id;
      this.formOpen.set(false);
      this.data.set(null);
      this.load();
    });
    this.payroll.getPayProfiles().subscribe({ next: (rows) => this.people.set(rows), error: () => {} });
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
          gstin: (e as any).gstin ?? null,
          gstPct: (e as any).gstPct ?? null,
          panNumber: e.panNumber, uanNumber: e.uanNumber, pfNumber: e.pfNumber, esiNumber: e.esiNumber,
          bankName: e.bankName, bankAccountNumber: e.bankAccountNumber, ifscCode: e.ifscCode,
        };
        this.gstOn = (e as any).gstPct != null;
        this.loading.set(false);
      },
      error: (e) => { this.loading.set(false); this.toast.error(e?.error?.message || 'Failed to load the pay profile'); },
    });
  }

  back() {
    this.router.navigate(['/payroll/pay-profiles']);
  }

  saveDetails() {
    // GST: the % is required when GST registered is on; the GSTIN is optional.
    if (this.gstOn) {
      const pct = this.details['gstPct'];
      if (pct === null || pct === undefined || pct === '' || !(Number(pct) > 0 && Number(pct) <= 28)) {
        this.toast.error('Enter the GST % (1–28) — it is required when GST registered is on');
        return;
      }
      this.details['gstPct'] = Number(pct);
      this.details['gstin'] = String(this.details['gstin'] || '').trim().toUpperCase() || null;
    } else {
      this.details['gstin'] = null;
      this.details['gstPct'] = null;
    }
    this.savingDetails.set(true);
    this.payroll.updatePayDetails(this.employeeId, this.details).subscribe({
      next: () => { this.savingDetails.set(false); this.toast.success('Details saved'); this.load(); },
      error: (e) => { this.savingDetails.set(false); this.toast.error(e?.error?.message || 'Failed to save details'); },
    });
  }

  openNewVersion() {
    // Latest salary groups, so a per-person field added in Settings shows up without a page reload.
    this.payroll.getPayrollSalaryGroups().subscribe({ next: (g) => this.groups.set(g), error: () => {} });
    const cur = this.current();
    this.form = {
      salaryGroupCode: cur?.salaryGroupCode ?? null,
      annualCtc: cur?.annualCtc ?? null,
      effectiveFrom: this.firstOfNextMonth(),
      workerType: cur?.workerType ?? null,
      paymentMethod: cur?.paymentMethod ?? null,
      taxRegime: cur?.taxRegime === 'OLD' ? 'OLD' : 'NEW',
      overrides: { ...(cur?.overrides || {}) } as Record<string, number | null>,
      reason: '',
    };
    this.formWorkerType.set(this.form.workerType);
    this.formGroupCode.set(this.form.salaryGroupCode);
    this.customBasic = !!(cur?.overrides && (cur.overrides as any)['BASIC'] != null);
    this.form.grossMonthly = (cur as any)?.grossMonthly ?? ((this.data() as any)?.breakup?.grossMonthly ? Math.round((this.data() as any).breakup.grossMonthly) : null);
    this.preview.set(null);
    this.submitted.set(false);
    this.serverError.set(null);
    this.formOpen.set(true);
    this.runPreview();
  }

  closeForm() {
    if (this.saving()) return;
    this.formOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.formOpen()) this.closeForm();
  }

  /** Every problem with the form, by field. Empty = OK to save. */
  validate(): Record<string, string> {
    const f = this.form;
    const e: Record<string, string> = {};
    if (!f) return e;
    if (!f.salaryGroupCode) e['salaryGroupCode'] = 'Pick a salary group.';
    else if (!this.groupChoices().some((g) => g.code === f.salaryGroupCode)) e['salaryGroupCode'] = "This group doesn't pay the chosen worker type.";
    const ctc = Number(f.annualCtc);
    if (f.annualCtc === null || f.annualCtc === undefined || f.annualCtc === '') e['annualCtc'] = 'Enter the annual CTC.';
    else if (!Number.isFinite(ctc) || ctc <= 0) e['annualCtc'] = 'Annual CTC must be more than ₹0.';
    else if (ctc < 12000) e['annualCtc'] = 'That is under ₹1,000 a month — enter the yearly amount, not monthly.';
    else if (ctc > 50000000) e['annualCtc'] = 'More than ₹5 crore a year — check the amount.';
    if (!f.effectiveFrom) e['effectiveFrom'] = 'Pick the date it takes effect from.';
    else {
      const d = new Date(f.effectiveFrom + 'T00:00:00');
      const joinedOn = this.data()?.employee?.joiningDate;
      const joined = joinedOn ? new Date(joinedOn) : null;
      const latest = new Date(); latest.setFullYear(latest.getFullYear() + 1);
      if (isNaN(d.getTime())) e['effectiveFrom'] = 'Not a valid date.';
      else if (joined && d < new Date(joined.toISOString().slice(0, 10) + 'T00:00:00')) e['effectiveFrom'] = `Can't start before they joined (${joined.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}).`;
      else if (d > latest) e['effectiveFrom'] = 'More than a year ahead — pick a nearer date.';
      else if ((this.data()?.versions || []).some((v: any) => String(v.effectiveFrom).slice(0, 10) === f.effectiveFrom)) e['effectiveFrom'] = 'A version already starts on this date — pick another or revise from a later date.';
    }
    const monthly = ctc > 0 ? ctc / 12 : 0;
    const basic = f.overrides?.['BASIC'];
    if (this.customBasic && basic !== null && basic !== undefined && basic !== '') {
      const min = this.ruleBasic() ?? 0;
      if (Number(basic) < min) e['override:BASIC'] = `Basic can't be below 50% of CTC (₹${min.toLocaleString('en-IN')} a month).`;
    }
    let overrideTotal = 0;
    for (const [code, v] of Object.entries(f.overrides || {})) {
      if (v === null || v === undefined || (v as any) === '') continue;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) e['override:' + code] = "Can't be negative.";
      else overrideTotal += n;
    }
    if (this.grossApplies()) {
      const gross = Number(f.grossMonthly);
      if (f.grossMonthly === null || f.grossMonthly === undefined || f.grossMonthly === '' || !(gross > 0)) e['grossMonthly'] = 'Enter the monthly gross.';
      else if (monthly > 0 && gross > monthly) e['grossMonthly'] = `Gross is more than the monthly CTC (${this.money(monthly)}).`;
    }
    if (monthly > 0 && overrideTotal > monthly) e['annualCtc'] = e['annualCtc'] || `Overrides add up to ${this.money(overrideTotal)}/month — more than the monthly CTC (${this.money(monthly)}).`;
    if (this.cleanOverrides() && !String(f.reason || '').trim()) e['reason'] = 'Give a reason for the overrides.';
    return e;
  }

  err(field: string): string | null {
    return this.submitted() ? this.validate()[field] ?? null : null;
  }

  /** Not wrong, but worth a second look before saving. */
  ctcWarning(): string | null {
    const ctc = Number(this.form?.annualCtc);
    const cur = this.current()?.annualCtc;
    if (ctc > 10000000) return 'Over ₹1 crore a year — make sure this is the yearly CTC.';
    if (cur && ctc > 0 && (ctc > cur * 2 || ctc < cur / 2)) return `Big change from the current ${this.money(cur)} — check it.`;
    return null;
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
    this.customBasic = false;
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
      onDate: this.form.effectiveFrom || undefined,
      regimeCode: this.form.taxRegime === 'OLD' ? 'OLD' : 'NEW',
      financialYear: this.fyOf(this.form.effectiveFrom),
      grossMonthly: this.grossApplies() && Number(this.form.grossMonthly) > 0 ? Number(this.form.grossMonthly) : undefined,
      overrides: this.cleanOverrides(),
    } as any).subscribe({
      next: (r) => { this.preview.set(r); this.previewing.set(false); },
      error: (e) => { this.previewing.set(false); this.preview.set(null); this.toast.error(e?.error?.message || 'Could not calculate'); },
    });
  }

  saveVersion() {
    const f = this.form;
    this.submitted.set(true);
    this.serverError.set(null);
    const errors = this.validate();
    const problems = Object.values(errors);
    if (problems.length) {
      this.toast.error(problems.length === 1 ? problems[0] : `Fix the ${problems.length} highlighted fields`);
      this.focusFirstError(errors);
      return;
    }
    const overrides = this.cleanOverrides();
    this.saving.set(true);
    this.payroll.addPayProfileVersion(this.employeeId, {
      salaryGroupCode: f.salaryGroupCode,
      annualCtc: Number(f.annualCtc),
      grossMonthly: this.grossApplies() ? Number(f.grossMonthly) : null,
      effectiveFrom: f.effectiveFrom,
      workerType: f.workerType || null,
      paymentMethod: f.paymentMethod || null,
      taxRegime: f.taxRegime === 'OLD' ? 'OLD' : 'NEW',
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
      error: (e) => {
        this.saving.set(false);
        const m = e?.error?.message;
        this.serverError.set(Array.isArray(m) ? m.join(' · ') : m || 'Could not save — try again.');
      },
    });
  }

  /** Breakup lines grouped the way a payslip reads. */
  /**
   * GST on top of a consultant's fee (GST registered on the pay profile):
   * fee × their GST %. Not part of CTC; TDS stays on the fee.
   */
  gstOf(b: SalaryCalculationResult | null): { pct: number; amount: number } | null {
    const e: any = this.data()?.employee;
    const fee = b?.lines.find((l) => l.code === 'CONSULTANT_FEE')?.monthly ?? 0;
    if (e?.gstPct == null || !(fee > 0)) return null;
    const pct = Number(e.gstPct);
    return { pct, amount: Math.round(fee * pct) / 100 };
  }
  /** Take-home including GST, when there is GST. */
  payout(b: SalaryCalculationResult | null): number {
    return (b?.netPayMonthly ?? 0) + (this.gstOf(b)?.amount ?? 0);
  }

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

  getSalaryGroupName(code: string | null | undefined): string {
    if (!code) return '—';
    const found = this.groups().find((g) => g.code === code);
    return found?.name || code;
  }

  getInitials(name: string): string {
    if (!name) return '??';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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

  getMonthlyEquivalent(annual: number | null | undefined): string {
    if (!annual) return '—';
    return '₹' + Math.round(Number(annual) / 12).toLocaleString('en-IN') + ' / mo';
  }

  private firstOfNextMonth() {
    const d = new Date();
    const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
  }
}
