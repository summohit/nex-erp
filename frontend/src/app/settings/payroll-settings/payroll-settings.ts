import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideSliders,
  LucideLayers,
  LucideReceipt,
  LucideShieldCheck,
  LucideCalculator,
  LucideHistory,
  LucideSearch,
  LucideX,
  LucidePlus,
  LucidePencil,
  LucideCheck,
  LucideAlertCircle,
  LucideInfo,
  LucideEye,
  LucideEyeOff,
  LucideRefreshCw,
  LucideChevronRight,
  LucideArrowRight,
  LucideCoins,
  LucideSparkles,
  LucideFilter,
  LucideFileText,
  LucideTrendingUp,
  LucideZap,
  LucideTrash2,
  LucideCalendarDays,
  LucideLock,
  LucideCopy,
  LucideScale,
  LucideCheckCircle2,
  LucideSave,
  LucideHelpCircle,
} from '@lucide/angular';
import {
  PayrollService,
  MasterComponent,
  MasterSalaryGroup,
  MasterStatutoryRate,
  MasterTaxRegime,
  SalaryCalculationResult,
  PayrollYearSetting,
  PayrollCompanyConfig,
  PayrollDropdownList,
} from '../../services/payroll.service';

type ActiveSettingsTab = 'components' | 'groups' | 'statutory' | 'tax' | 'setup' | 'calculator' | 'audit' | 'help';

@Component({
  selector: 'app-payroll-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideSliders,
    LucideLayers,
    LucideReceipt,
    LucideShieldCheck,
    LucideCalculator,
    LucideHistory,
    LucideSearch,
    LucideX,
    LucidePlus,
    LucidePencil,
    LucideCheck,
    LucideAlertCircle,
    LucideInfo,
    LucideEye,
    LucideEyeOff,
    LucideRefreshCw,
    LucideChevronRight,
    LucideArrowRight,
    LucideCoins,
    LucideSparkles,
    LucideFilter,
    LucideFileText,
    LucideTrendingUp,
    LucideZap,
    LucideTrash2,
    LucideCalendarDays,
    LucideLock,
    LucideCopy,
    LucideScale,
    LucideCheckCircle2,
    LucideSave,
    LucideHelpCircle,
  ],
  templateUrl: './payroll-settings.html',
  styleUrls: ['./payroll-settings.css'],
})
export class PayrollSettingsComponent implements OnInit {
  /**
   * The style family for a payee type. Takes a plain string so the older
   * spellings (CONTRACTOR, INTERN) that may still be on some groups read the
   * same as CONSULTANT and TRAINEE.
   */
  payeeKind(type?: string | null): 'employee' | 'consultant' | 'intern' {
    if (type === 'CONSULTANT' || type === 'CONTRACTOR') return 'consultant';
    if (type === 'TRAINEE' || type === 'INTERN') return 'intern';
    return 'employee';
  }

  payeeLabel(type?: string | null, employeeLabel = 'Employee'): string {
    const kind = this.payeeKind(type);
    return kind === 'consultant' ? 'Consultant' : kind === 'intern' ? 'Trainee' : employeeLabel;
  }

  private payrollService = inject(PayrollService);
  private toast = inject(HotToastService);

  activeTab = signal<ActiveSettingsTab>('components');
  isLoading = signal<boolean>(false);

  // Components state (W1, W2)
  components = signal<MasterComponent[]>([]);
  componentSearch = signal<string>('');
  componentCategoryFilter = signal<string>('ALL');
  componentErrors = signal<{ code?: string; name?: string }>({});
  isComponentModalOpen = signal<boolean>(false);
  componentForm: any = {
    id: null,
    code: '',
    name: '',
    category: 'EARNING',
    partOfCtc: true,
    partOfGross: true,
    taxable: true,
    reduceForLop: true,
    showOnPayslip: true,
    showOnAnnexure: true,
    displayOrder: 10,
    description: '',
  };
  formulaTestResult = signal<{ valid: boolean; sampleResult?: number; error?: string } | null>(null);

  filteredComponents = computed(() => {
    const q = this.componentSearch().toLowerCase().trim();
    const cat = this.componentCategoryFilter();
    return this.components()
      .filter((c) => {
        const matchesQuery = !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.description || '').toLowerCase().includes(q);
        const matchesCat = cat === 'ALL' || c.category === cat;
        return matchesQuery && matchesCat;
      })
      .sort((a, b) => {
        // Newly created / added components on top (newest first by id or createdAt)
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;
        return b.id - a.id;
      });
  });

  componentStats = computed(() => {
    const list = this.components();
    return {
      total: list.length,
      earnings: list.filter((c) => c.category === 'EARNING').length,
      employeeDeductions: list.filter((c) => c.category === 'EMPLOYEE_DEDUCTION').length,
      employerContributions: list.filter((c) => c.category === 'EMPLOYER_CONTRIBUTION').length,
      reimbursements: list.filter((c) => c.category === 'REIMBURSEMENT').length,
      visibleOnPayslip: list.filter((c) => c.showOnPayslip).length,
      hiddenOnPayslip: list.filter((c) => !c.showOnPayslip).length,
    };
  });

  // Salary Groups state (W3)
  salaryGroups = signal<MasterSalaryGroup[]>([]);
  selectedGroup = signal<MasterSalaryGroup | null>(null);
  groupSearch = signal<string>('');
  groupErrors = signal<Record<string, string>>({});
  isGroupModalOpen = signal<boolean>(false);
  groupForm: any = {
    code: '',
    name: '',
    description: '',
    payeeType: 'EMPLOYEE',
    flatTdsPct: 0,
    gstApplicable: false,
    pfWageBasis: 'CAPPED',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    lines: [],
  };

  filteredSalaryGroups = computed(() => {
    const q = this.groupSearch().toLowerCase().trim();
    return this.salaryGroups().filter((g) => {
      return !q || g.code.toLowerCase().includes(q) || g.name.toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q);
    });
  });

  selectedGroupStats = computed(() => {
    const g = this.selectedGroup();
    if (!g || !g.lines) {
      return {
        total: 0,
        earnings: 0,
        deductions: 0,
        employerShares: 0,
        balancingComp: null,
      };
    }
    const lines = g.lines;
    const earnings = lines.filter((l) => l.component?.category === 'EARNING').length;
    const deductions = lines.filter((l) => l.component?.category === 'EMPLOYEE_DEDUCTION').length;
    const employerShares = lines.filter((l) => l.component?.category === 'EMPLOYER_CONTRIBUTION').length;
    const balancing = lines.find((l) => l.calcType === 'BALANCING');
    return {
      total: lines.length,
      earnings,
      deductions,
      employerShares,
      balancingComp: balancing?.component?.name || (balancing ? 'Balancing Figure' : null),
    };
  });

  // Statutory Rates state (W5)
  statutoryRates = signal<MasterStatutoryRate[]>([]);
  statutorySearch = signal<string>('');
  isStatutoryModalOpen = signal<boolean>(false);
  statutoryForm: any = {
    id: null,
    code: '',
    stateCode: '',
    ratePct: null,
    wageCeiling: null,
    eligibilityLimit: null,
    fixedAmount: null,
    notes: '',
  };

  filteredStatutoryRates = computed(() => {
    const q = this.statutorySearch().toLowerCase().trim();
    return this.statutoryRates().filter((r) => {
      return !q || r.code.toLowerCase().includes(q) || (r.stateCode || '').toLowerCase().includes(q) || (r.notes || '').toLowerCase().includes(q);
    });
  });

  // Tax Regimes state (W4)
  taxRegimes = signal<MasterTaxRegime[]>([]);
  selectedRegimeTab = signal<'NEW' | 'OLD'>('NEW');
  isTaxRegimeModalOpen = signal<boolean>(false);
  taxRegimeErrors = signal<Record<string, string>>({});
  taxRegimeForm: any = {
    id: null,
    code: '',
    name: '',
    standardDeduction: 0,
    rebateIncomeLimit: 0,
    rebateMaxAmount: 0,
    cessPct: 4,
    slabs: [],
    surcharge: [],
    sections: [],
  };

  // Salary Calculator state (W7)
  calcCtcType: 'monthly' | 'annual' = 'annual';
  calcCtcAmount = 600000;
  calcGroupId: number | null = null;
  calcRegimeCode: 'NEW' | 'OLD' = 'NEW';
  calcResult = signal<SalaryCalculationResult | null>(null);
  isCalculating = signal<boolean>(false);
  ctcPresets = [300000, 600000, 900000, 1200000, 1500000, 1800000, 2400000, 3600000];

  // Audit Log state (W13)
  auditLogs = signal<any[]>([]);
  auditEntityFilter = signal<string>('ALL');

  filteredAuditLogs = computed(() => {
    const ent = this.auditEntityFilter();
    return this.auditLogs().filter((l) => {
      return ent === 'ALL' || l.entity === ent;
    });
  });

  // Formula help: every name a formula/condition can use (tab + drawer in the editors)
  formulaHelp = signal<any | null>(null);
  isHelpDrawerOpen = signal<boolean>(false);

  loadFormulaHelp() {
    this.payrollService.getPayrollFormulaHelp().subscribe({
      next: (h) => this.formulaHelp.set(h),
      error: () => this.toast.error('Failed to load formula help'),
    });
  }

  openHelpDrawer() {
    if (!this.formulaHelp()) this.loadFormulaHelp();
    this.isHelpDrawerOpen.set(true);
  }

  // ── Autocomplete for formula / condition boxes ──
  /** Open suggestion list: which box, where to draw it, and the matches. */
  suggest = signal<{
    items: { name: string; insert: string; meaning: string; kind: string }[];
    index: number;
    top: number;
    left: number;
    width: number;
    target: HTMLInputElement;
    model: any;
    field: string;
  } | null>(null);
  private suggestCloseTimer: any = null;

  /** Everything a formula can name, from the help catalog (falls back to components until it loads). */
  private suggestionPool(): { name: string; insert: string; meaning: string; kind: string }[] {
    const h = this.formulaHelp();
    const pool: { name: string; insert: string; meaning: string; kind: string }[] = [];
    if (h) {
      for (const v of h.salary) pool.push({ name: v.name, insert: v.name, meaning: `${v.meaning} · ${v.when}`, kind: 'Salary' });
      for (const v of h.rates) pool.push({ name: v.name, insert: v.name, meaning: `${v.meaning}${v.value != null ? ` · today ${v.value}` : ''}`, kind: 'Rate' });
      for (const c of h.components) pool.push({ name: c.name, insert: c.name, meaning: `${c.meaning} · ${this.categoryLabel(c.category)}`, kind: 'Component' });
      for (const f of h.functions) {
        for (const fn of String(f.name).split('/').map((x: string) => x.trim().split('(')[0])) {
          pool.push({ name: fn, insert: `${fn}(`, meaning: `${f.meaning} — e.g. ${f.example}`, kind: 'Function' });
        }
      }
    } else {
      for (const c of this.components()) pool.push({ name: c.code, insert: c.code, meaning: c.name, kind: 'Component' });
    }
    for (const op of ['AND', 'OR', 'NOT']) pool.push({ name: op, insert: `${op} `, meaning: 'Combine tests in a condition', kind: 'Operator' });
    return pool;
  }

  /** The word being typed just before the caret. */
  private wordBeforeCaret(input: HTMLInputElement): { word: string; start: number } {
    const caret = input.selectionStart ?? input.value.length;
    const m = input.value.slice(0, caret).match(/[A-Za-z_][A-Za-z0-9_]*$/);
    return m ? { word: m[0], start: caret - m[0].length } : { word: '', start: caret };
  }

  onFormulaInput(event: Event, model: any, field: string) {
    const input = event.target as HTMLInputElement;
    const { word } = this.wordBeforeCaret(input);
    if (!word) { this.suggest.set(null); return; }
    const q = word.toUpperCase();
    const pool = this.suggestionPool();
    const starts = pool.filter((p) => p.name.toUpperCase().startsWith(q));
    const contains = pool.filter((p) => !p.name.toUpperCase().startsWith(q) && (p.name.toUpperCase().includes(q) || p.meaning.toUpperCase().includes(q)));
    const items = [...starts, ...contains].filter((p) => p.name.toUpperCase() !== q).slice(0, 8);
    if (!items.length) { this.suggest.set(null); return; }
    const r = input.getBoundingClientRect();
    this.suggest.set({ items, index: 0, top: r.bottom + 4, left: r.left, width: Math.max(r.width, 340), target: input, model, field });
  }

  onFormulaKey(event: KeyboardEvent) {
    const s = this.suggest();
    if (!s) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const n = s.items.length;
      this.suggest.set({ ...s, index: (s.index + (event.key === 'ArrowDown' ? 1 : n - 1)) % n });
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      this.applySuggestion(s.items[s.index]);
    } else if (event.key === 'Escape') {
      this.suggest.set(null);
    }
  }

  applySuggestion(item: { insert: string }) {
    const s = this.suggest();
    if (!s) return;
    clearTimeout(this.suggestCloseTimer);
    const input = s.target;
    const { start } = this.wordBeforeCaret(input);
    const caret = input.selectionStart ?? input.value.length;
    const value = input.value.slice(0, start) + item.insert + input.value.slice(caret);
    s.model[s.field] = value;
    input.value = value;
    const pos = start + item.insert.length;
    this.suggest.set(null);
    setTimeout(() => { input.focus(); input.setSelectionRange(pos, pos); });
  }

  /** Blur fires before a click on a suggestion lands — wait a moment before closing. */
  closeSuggestSoon() {
    clearTimeout(this.suggestCloseTimer);
    this.suggestCloseTimer = setTimeout(() => this.suggest.set(null), 150);
  }

  categoryLabel(cat: string): string {
    return ({ EARNING: 'Earning', EMPLOYEE_DEDUCTION: 'Deduction', EMPLOYER_CONTRIBUTION: 'Employer share', REIMBURSEMENT: 'Reimbursement' } as any)[cat] || cat;
  }

  // Component history (one component's audit entries)
  historyFor = signal<MasterComponent | null>(null);
  historyEntries = signal<any[]>([]);
  historyLoading = signal<boolean>(false);

  openComponentHistory(comp: MasterComponent) {
    this.historyFor.set(comp);
    this.historyEntries.set([]);
    this.historyLoading.set(true);
    this.payrollService.getPayrollAuditLog(50, 'PayrollComponent', comp.id).subscribe({
      next: (rows) => { this.historyEntries.set(rows); this.historyLoading.set(false); },
      error: () => { this.historyLoading.set(false); this.toast.error('Failed to load history'); },
    });
  }

  closeComponentHistory() {
    this.historyFor.set(null);
  }

  /** Fields that differ between two audit snapshots — what a history row shows. */
  changedFields(before: any, after: any): { field: string; from: any; to: any }[] {
    if (!before || !after) return [];
    const skip = new Set(['updatedAt', 'createdAt', 'id', 'companyId']);
    return Object.keys({ ...before, ...after })
      .filter((k) => !skip.has(k) && typeof after[k] !== 'object' && before[k] !== after[k])
      .map((k) => ({ field: k, from: before[k], to: after[k] }));
  }

  // Year & lists (Phase 1: year settings, company config, dropdowns)
  readonly setupFinancialYear = '2026-27';
  yearSetting = signal<PayrollYearSetting | null>(null);
  yearForm: any = null;
  companyConfig = signal<PayrollCompanyConfig | null>(null);
  configForm: any = null;
  dropdowns = signal<PayrollDropdownList[]>([]);
  /** listKey → the option being typed into that list's "add" box. */
  dropdownDraft: Record<string, string> = {};
  savingSetup = signal<string | null>(null);

  loadSetup() {
    this.payrollService.getPayrollYearSetting(this.setupFinancialYear).subscribe({
      next: (y) => {
        this.yearSetting.set(y);
        this.yearForm = {
          ...y,
          regimeLockDate: this.toDateInput(y.regimeLockDate),
          proofWindowStart: this.toDateInput(y.proofWindowStart),
          proofWindowEnd: this.toDateInput(y.proofWindowEnd),
        };
      },
      error: () => this.toast.error('Failed to load year settings'),
    });
    this.payrollService.getPayrollCompanyConfig().subscribe({
      next: (c) => { this.companyConfig.set(c); this.configForm = { ...c }; },
      error: () => this.toast.error('Failed to load payroll options'),
    });
    this.payrollService.getPayrollDropdowns().subscribe({
      next: (d) => this.dropdowns.set(d.map((l) => ({ ...l, options: [...l.options] }))),
      error: () => this.toast.error('Failed to load dropdown lists'),
    });
  }

  private toDateInput(v: string | null | undefined): string {
    return v ? String(v).slice(0, 10) : '';
  }

  saveYearSetting() {
    this.savingSetup.set('year');
    this.payrollService.savePayrollYearSetting(this.setupFinancialYear, {
      defaultRegimeCode: this.yearForm.defaultRegimeCode,
      regimeLockDate: this.yearForm.regimeLockDate,
      newJoinerChoiceDays: Number(this.yearForm.newJoinerChoiceDays),
      tdsMethod: this.yearForm.tdsMethod,
      proofWindowStart: this.yearForm.proofWindowStart || null,
      proofWindowEnd: this.yearForm.proofWindowEnd || null,
    }).subscribe({
      next: () => { this.savingSetup.set(null); this.toast.success(`FY ${this.setupFinancialYear} settings saved`); this.loadSetup(); this.loadAllMasters(); },
      error: (e) => { this.savingSetup.set(null); this.toast.error(e.error?.message || 'Failed to save year settings'); },
    });
  }

  saveCompanyConfig() {
    this.savingSetup.set('config');
    this.payrollService.savePayrollCompanyConfig({
      gradeBasis: this.configForm.gradeBasis,
      costingWorkingDays: Number(this.configForm.costingWorkingDays),
      costingHoursPerDay: Number(this.configForm.costingHoursPerDay),
      costingIncludeEmployer: !!this.configForm.costingIncludeEmployer,
    }).subscribe({
      next: () => { this.savingSetup.set(null); this.toast.success('Grades & costing saved'); this.loadSetup(); },
      error: (e) => { this.savingSetup.set(null); this.toast.error(e.error?.message || 'Failed to save'); },
    });
  }

  addDropdownOption(list: PayrollDropdownList) {
    const label = (this.dropdownDraft[list.listKey] || '').trim();
    if (!label) return;
    if (list.options.some((o) => o.label.toLowerCase() === label.toLowerCase())) {
      this.toast.error('That option is already in the list');
      return;
    }
    list.options.push({ value: '', label });
    this.dropdownDraft[list.listKey] = '';
  }

  removeDropdownOption(list: PayrollDropdownList, index: number) {
    list.options.splice(index, 1);
  }

  saveDropdown(list: PayrollDropdownList) {
    this.savingSetup.set(list.listKey);
    this.payrollService.savePayrollDropdown(list.listKey, list.options.map((o) => o.label)).subscribe({
      next: () => { this.savingSetup.set(null); this.toast.success(`${list.name} saved`); this.loadSetup(); },
      error: (e) => { this.savingSetup.set(null); this.toast.error(e.error?.message || 'Failed to save list'); },
    });
  }

  ngOnInit() {
    this.loadAllMasters();
  }

  setTab(tab: ActiveSettingsTab) {
    this.activeTab.set(tab);
    if (tab === 'calculator' && !this.calcResult()) {
      this.runCalculator();
    } else if (tab === 'audit' && this.auditLogs().length === 0) {
      this.loadAuditLogs();
    } else if (tab === 'setup' && !this.yearForm) {
      this.loadSetup();
    } else if (tab === 'help' && !this.formulaHelp()) {
      this.loadFormulaHelp();
    }
  }

  loadAllMasters() {
    this.isLoading.set(true);
    this.payrollService.getPayrollComponents().subscribe({
      next: (comps) => {
        this.components.set(comps);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Failed to load components', err);
        this.toast.error('Failed to load payroll components');
        this.isLoading.set(false);
      },
    });

    this.payrollService.getPayrollSalaryGroups().subscribe({
      next: (groups) => {
        this.salaryGroups.set(groups);
        if (groups.length > 0 && !this.calcGroupId) {
          this.calcGroupId = groups[0].id;
          this.selectedGroup.set(groups[0]);
        }
      },
      error: (err) => console.error('Failed to load salary groups', err),
    });

    this.payrollService.getPayrollStatutoryRates().subscribe({
      next: (rates) => this.statutoryRates.set(rates),
      error: (err) => console.error('Failed to load statutory rates', err),
    });

    this.payrollService.getPayrollTaxRegimes('2026-27').subscribe({
      next: (regimes) => this.taxRegimes.set(regimes),
      error: (err) => console.error('Failed to load tax regimes', err),
    });
  }

  // ═══════════════════════════════════════════
  // COMPONENT ACTIONS (W1, W2)
  // ═══════════════════════════════════════════

  clearComponentError(field: 'code' | 'name') {
    const cur = { ...this.componentErrors() };
    delete cur[field];
    this.componentErrors.set(cur);
  }

  clearGroupError(field: string) {
    const cur = { ...this.groupErrors() };
    delete cur[field];
    this.groupErrors.set(cur);
  }

  openCreateComponentModal() {
    this.componentForm = {
      id: null,
      code: '',
      name: '',
      category: 'EARNING',
      partOfCtc: true,
      partOfGross: true,
      taxable: true,
      reduceForLop: true,
      showOnPayslip: true,
      showOnAnnexure: true,
      displayOrder: (this.components().length + 1) * 10,
      description: '',
    };
    this.componentErrors.set({});
    this.formulaTestResult.set(null);
    this.isComponentModalOpen.set(true);
  }

  openEditComponentModal(comp: MasterComponent) {
    this.componentForm = { ...comp };
    this.componentErrors.set({});
    this.formulaTestResult.set(null);
    this.isComponentModalOpen.set(true);
  }

  closeComponentModal() {
    this.componentErrors.set({});
    this.isComponentModalOpen.set(false);
  }

  onCategoryChange() {
    if (this.componentForm.category === 'EMPLOYER_CONTRIBUTION') {
      this.componentForm.showOnPayslip = false; // Finance rule: hidden on payslip
      this.componentForm.partOfGross = false;
      this.componentForm.partOfCtc = true;
    } else if (this.componentForm.category === 'EMPLOYEE_DEDUCTION') {
      this.componentForm.showOnPayslip = true;
      this.componentForm.partOfGross = false;
      this.componentForm.partOfCtc = false;
    } else {
      this.componentForm.showOnPayslip = true;
      this.componentForm.partOfGross = true;
      this.componentForm.partOfCtc = true;
    }
  }

  saveComponent() {
    const errors: { code?: string; name?: string } = {};
    const code = (this.componentForm.code || '').trim();
    const name = (this.componentForm.name || '').trim();

    if (!code) {
      errors.code = 'Component code is required (e.g. SPECIAL_ALLOWANCE)';
    } else if (!/^[A-Z0-9_]+$/i.test(code)) {
      errors.code = 'Code must contain only uppercase letters, numbers, and underscores';
    }

    if (!name) {
      errors.name = 'Display name is required (e.g. Special Allowance)';
    }

    this.componentErrors.set(errors);

    if (Object.keys(errors).length > 0) {
      this.toast.error('Please enter the required component code and name');
      return;
    }

    if (this.componentForm.id) {
      this.payrollService.updatePayrollComponent(this.componentForm.id, this.componentForm).subscribe({
        next: () => {
          this.toast.success('Component updated');
          this.closeComponentModal();
          this.loadAllMasters();
        },
        error: (err) => {
          const msg = err.error?.message || 'Failed to update component';
          this.toast.error(msg);
          if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('code')) {
            this.componentErrors.set({ code: msg });
          }
        },
      });
    } else {
      this.payrollService.createPayrollComponent(this.componentForm).subscribe({
        next: () => {
          this.toast.success('Component created');
          this.closeComponentModal();
          this.loadAllMasters();
        },
        error: (err) => {
          const msg = err.error?.message || 'Failed to create component';
          this.toast.error(msg);
          if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('code')) {
            this.componentErrors.set({ code: msg });
          }
        },
      });
    }
  }

  deleteComponent(comp: MasterComponent) {
    if (comp.isSystem) {
      this.toast.error(`System component ${comp.code} cannot be deleted.`);
      return;
    }

    if (!confirm(`Are you sure you want to delete component "${comp.name}" (${comp.code})?`)) {
      return;
    }

    this.payrollService.deletePayrollComponent(comp.id).subscribe({
      next: (res) => {
        this.toast.success(res.message || `Component ${comp.code} deleted`);
        this.loadAllMasters();
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to delete component');
      },
    });
  }

  // ═══════════════════════════════════════════
  // SALARY GROUP ACTIONS (W3)
  // ═══════════════════════════════════════════

  openCreateGroupModal() {
    if (!this.formulaHelp()) this.loadFormulaHelp();
    this.groupErrors.set({});
    this.groupForm = {
      code: '',
      name: '',
      description: '',
      payeeType: 'EMPLOYEE',
      flatTdsPct: 0,
      gstApplicable: false,
      pfWageBasis: 'CAPPED',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      lines: this.components().map((c, i) => ({
        componentId: c.id,
        component: c,
        calcType: c.category === 'EARNING' ? 'FORMULA' : (c.code === 'OTHER_ALLOWANCE' ? 'BALANCING' : 'FORMULA'),
        formula: c.code === 'BASIC' ? 'MAX(CTC_MONTHLY * 0.5, BASIC_FLOOR)' : (c.code === 'HRA' ? 'BASIC * 0.4' : ''),
        amount: null,
        condition: '',
        overrideAllowed: false,
        displayOrder: i + 1,
      })),
    };
    this.isGroupModalOpen.set(true);
  }

  openEditGroupModal(group: MasterSalaryGroup) {
    if (!this.formulaHelp()) this.loadFormulaHelp();
    this.groupErrors.set({});
    this.groupForm = {
      code: group.code,
      name: group.name,
      description: group.description || '',
      // Older groups may say CONTRACTOR / INTERN — show them as the current options.
      payeeType: this.payeeKind(group.payeeType) === 'consultant' ? 'CONSULTANT' : this.payeeKind(group.payeeType) === 'intern' ? 'TRAINEE' : 'EMPLOYEE',
      flatTdsPct: group.flatTdsPct || 0,
      gstApplicable: group.gstApplicable || false,
      pfWageBasis: group.pfWageBasis || 'CAPPED',
      effectiveFrom: new Date().toISOString().slice(0, 10),
      lines: (group.lines || []).map((l) => ({
        componentId: l.componentId,
        calcType: l.calcType,
        formula: l.formula || '',
        amount: l.amount,
        condition: l.condition || '',
        overrideAllowed: l.overrideAllowed,
        displayOrder: l.displayOrder,
      })),
    };
    this.isGroupModalOpen.set(true);
  }

  closeGroupModal() {
    this.groupErrors.set({});
    this.isGroupModalOpen.set(false);
  }

  addGroupLine() {
    const firstComp = this.components()[0];
    this.groupForm.lines.push({
      componentId: firstComp ? firstComp.id : 1,
      calcType: 'FORMULA',
      formula: '',
      amount: null,
      condition: '',
      overrideAllowed: false,
      displayOrder: this.groupForm.lines.length + 1,
    });
  }

  removeGroupLine(index: number) {
    this.groupForm.lines.splice(index, 1);
    // Clear any residual line errors
    const cur = { ...this.groupErrors() };
    Object.keys(cur).forEach((k) => {
      if (k.startsWith('line_')) delete cur[k];
    });
    this.groupErrors.set(cur);
  }

  getComponentCategoryTag(componentId: number): { label: string; class: string } {
    const c = this.components().find((item) => item.id === Number(componentId));
    if (!c) return { label: 'CUSTOM', class: 'tag-gray' };
    switch (c.category) {
      case 'EARNING':
        return { label: 'EARNING', class: 'tag-green' };
      case 'EMPLOYEE_DEDUCTION':
        return { label: 'DEDUCTION', class: 'tag-amber' };
      case 'EMPLOYER_CONTRIBUTION':
        return { label: 'STATUTORY', class: 'tag-blue' };
      case 'REIMBURSEMENT':
        return { label: 'REIMB', class: 'tag-purple' };
      default:
        return { label: 'OTHER', class: 'tag-gray' };
    }
  }

  private validateFormulaSyntax(formula: string | undefined | null): string | null {
    if (!formula || !formula.trim()) {
      return 'Formula cannot be empty';
    }
    const s = formula.trim();

    // Check parentheses count and balance
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth < 0) return "Unexpected closing parenthesis ')'";
      }
    }
    if (depth > 0) {
      return `Unbalanced parentheses: missing ${depth} closing ')'`;
    }

    // Check trailing binary operator
    if (/(?:[\+\-\*\/%]|<=|>=|<|>|==|!=|\bAND\b|\bOR\b|\bNOT\b)\s*$/i.test(s)) {
      return 'Incomplete formula ending with operator';
    }

    // Check leading invalid operator
    if (/^[\*\/%]/.test(s)) {
      return 'Formula cannot start with this operator';
    }

    return null;
  }

  private validateConditionSyntax(condition: string | undefined | null): string | null {
    if (!condition || !condition.trim()) return null;
    const s = condition.trim();

    let depth = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth < 0) return "Unexpected closing parenthesis ')'";
      }
    }
    if (depth > 0) {
      return `Unbalanced parentheses in condition: missing ${depth} closing ')'`;
    }

    if (/(?:[\+\-\*\/%]|<=|>=|<|>|==|!=|\bAND\b|\bOR\b|\bNOT\b)\s*$/i.test(s)) {
      return 'Incomplete condition ending with operator';
    }

    return null;
  }

  scrollToErrorField(fieldKey: string) {
    setTimeout(() => {
      let el = document.getElementById(`group-field-${fieldKey}`) as HTMLElement | null;
      if (!el) {
        el = document.querySelector('.modal-dialog .input-error') as HTMLElement | null;
      }
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        el.focus();
        if (typeof (el as any).select === 'function') {
          (el as HTMLInputElement).select();
        }
      }
    }, 80);
  }

  saveSalaryGroup() {
    const errors: Record<string, string> = {};

    // 1. Group Code validation
    if (!this.groupForm.code || !this.groupForm.code.trim()) {
      errors['code'] = 'Salary group code is required (e.g. REGULAR_CUSTOM)';
    }

    // 2. Display Name validation
    if (!this.groupForm.name || !this.groupForm.name.trim()) {
      errors['name'] = 'Salary structure name is required (e.g. Regular Staff Structure)';
    }

    // 3. Effective From Date validation
    if (!this.groupForm.effectiveFrom || !String(this.groupForm.effectiveFrom).trim()) {
      errors['effectiveFrom'] = 'Effective from date is required';
    }

    // 4. Lines validation
    if (!this.groupForm.lines || this.groupForm.lines.length === 0) {
      errors['lines'] = 'At least one component line is required';
    } else {
      const seenComponents = new Map<number, number>();

      for (let i = 0; i < this.groupForm.lines.length; i++) {
        const line = this.groupForm.lines[i];

        // Component selection & duplicate check
        if (!line.componentId) {
          errors[`line_${i}_component`] = `Component is required for row #${i + 1}`;
        } else if (seenComponents.has(Number(line.componentId))) {
          const prevRow = seenComponents.get(Number(line.componentId))! + 1;
          errors[`line_${i}_component`] = `Duplicate component (already chosen in row #${prevRow})`;
        } else {
          seenComponents.set(Number(line.componentId), i);
        }

        // Calculation type checks
        if (line.calcType === 'FORMULA') {
          const formErr = this.validateFormulaSyntax(line.formula);
          if (formErr) {
            errors[`line_${i}_formula`] = formErr;
          }
        } else if (line.calcType === 'FIXED') {
          if (line.amount == null || line.amount === '' || isNaN(Number(line.amount))) {
            errors[`line_${i}_amount`] = 'Fixed ₹ amount is required';
          } else if (Number(line.amount) < 0) {
            errors[`line_${i}_amount`] = 'Amount cannot be negative';
          }
        }

        // Condition checks
        if (line.condition && line.condition.trim()) {
          const condErr = this.validateConditionSyntax(line.condition);
          if (condErr) {
            errors[`line_${i}_condition`] = condErr;
          }
        }
      }
    }

    this.groupErrors.set(errors);

    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const firstKey = errorKeys[0];
      const firstMsg = errors[firstKey];
      this.toast.error(firstMsg);
      this.scrollToErrorField(firstKey);
      return;
    }

    this.payrollService.savePayrollSalaryGroup(this.groupForm).subscribe({
      next: (saved) => {
        this.toast.success(`Salary structure ${saved.code} (v${saved.version}) saved`);
        this.closeGroupModal();
        this.loadAllMasters();
      },
      error: (err) => {
        const msg = err.error?.message || 'Failed to save salary group';
        this.toast.error(msg);

        const newErrors: Record<string, string> = {};
        let targetKey = 'code';

        if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('code')) {
          newErrors['code'] = msg;
          targetKey = 'code';
        } else if (msg.toLowerCase().includes('formula')) {
          let matchedLine = -1;
          for (let i = 0; i < this.groupForm.lines.length; i++) {
            const line = this.groupForm.lines[i];
            if (line.calcType === 'FORMULA' && line.formula) {
              if (msg.includes(line.formula) || this.components().some((c) => c.id === line.componentId && msg.includes(c.code))) {
                matchedLine = i;
                break;
              }
            }
          }
          if (matchedLine >= 0) {
            newErrors[`line_${matchedLine}_formula`] = msg;
            targetKey = `line_${matchedLine}_formula`;
          } else {
            newErrors['line_0_formula'] = msg;
            targetKey = 'line_0_formula';
          }
        } else {
          newErrors['name'] = msg;
          targetKey = 'name';
        }

        this.groupErrors.set(newErrors);
        this.scrollToErrorField(targetKey);
      },
    });
  }

  // ═══════════════════════════════════════════
  // STATUTORY RATE ACTIONS (W5)
  // ═══════════════════════════════════════════

  openEditStatutoryModal(rate: MasterStatutoryRate) {
    this.statutoryForm = { ...rate };
    this.isStatutoryModalOpen.set(true);
  }

  closeStatutoryModal() {
    this.isStatutoryModalOpen.set(false);
  }

  saveStatutoryRate() {
    if (!this.statutoryForm.id) return;
    this.payrollService.updatePayrollStatutoryRate(this.statutoryForm.id, this.statutoryForm).subscribe({
      next: () => {
        this.toast.success('Statutory rate updated');
        this.closeStatutoryModal();
        this.loadAllMasters();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update statutory rate'),
    });
  }

  // ═══════════════════════════════════════════
  // TAX REGIME ACTIONS (W4)
  // ═══════════════════════════════════════════

  clearRegimeError(field: string) {
    const cur = { ...this.taxRegimeErrors() };
    delete cur[field];
    this.taxRegimeErrors.set(cur);
  }

  scrollToRegimeErrorField(fieldKey: string) {
    setTimeout(() => {
      let el = document.getElementById(`regime-field-${fieldKey}`) as HTMLElement | null;
      if (!el) {
        el = document.querySelector('.modal-dialog .input-error') as HTMLElement | null;
      }
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        el.focus();
        if (typeof (el as any).select === 'function') {
          (el as HTMLInputElement).select();
        }
      }
    }, 80);
  }

  openEditTaxRegimeModal(regime: MasterTaxRegime) {
    this.taxRegimeErrors.set({});
    this.taxRegimeForm = {
      id: regime.id,
      code: regime.code,
      name: regime.name,
      standardDeduction: regime.standardDeduction,
      rebateIncomeLimit: regime.rebateIncomeLimit,
      rebateMaxAmount: regime.rebateMaxAmount,
      cessPct: regime.cessPct,
      slabs: (regime.slabs || []).map((s) => ({ ...s })),
      surcharge: ((regime as any).surcharge || []).map((b: any) => ({ ...b })),
      sections: (regime.sections || []).map((sec) => ({ ...sec, isActive: sec.isActive !== false })),
    };
    this.isTaxRegimeModalOpen.set(true);
  }

  closeTaxRegimeModal() {
    this.taxRegimeErrors.set({});
    this.isTaxRegimeModalOpen.set(false);
  }

  addTaxSlab() {
    const lastSlab = this.taxRegimeForm.slabs[this.taxRegimeForm.slabs.length - 1];
    const fromAmount = lastSlab ? (lastSlab.toAmount || lastSlab.fromAmount + 400000) : 0;
    this.taxRegimeForm.slabs.push({
      fromAmount,
      toAmount: fromAmount + 400000,
      ratePct: lastSlab ? Math.min(30, lastSlab.ratePct + 5) : 5,
      position: this.taxRegimeForm.slabs.length,
    });
  }

  removeTaxSlab(index: number) {
    this.taxRegimeForm.slabs.splice(index, 1);
    const cur = { ...this.taxRegimeErrors() };
    Object.keys(cur).forEach((k) => {
      if (k.startsWith('slab_')) delete cur[k];
    });
    this.taxRegimeErrors.set(cur);
  }

  addSurchargeBand() {
    const last = this.taxRegimeForm.surcharge[this.taxRegimeForm.surcharge.length - 1];
    this.taxRegimeForm.surcharge.push({ fromIncome: last ? last.fromIncome * 2 : 5000000, ratePct: last ? last.ratePct + 5 : 10 });
  }

  removeSurchargeBand(index: number) {
    this.taxRegimeForm.surcharge.splice(index, 1);
    const cur = { ...this.taxRegimeErrors() };
    Object.keys(cur).forEach((k) => {
      if (k.startsWith('surcharge_')) delete cur[k];
    });
    this.taxRegimeErrors.set(cur);
  }

  saveTaxRegime() {
    if (!this.taxRegimeForm.id) return;
    const errors: Record<string, string> = {};

    // 1. Standard Deduction validation
    if (this.taxRegimeForm.standardDeduction == null || this.taxRegimeForm.standardDeduction === '' || isNaN(Number(this.taxRegimeForm.standardDeduction))) {
      errors['standardDeduction'] = 'Standard Deduction is required';
    } else if (Number(this.taxRegimeForm.standardDeduction) < 0) {
      errors['standardDeduction'] = 'Standard Deduction cannot be negative';
    }

    // 2. Health & Education Cess validation
    if (this.taxRegimeForm.cessPct == null || this.taxRegimeForm.cessPct === '' || isNaN(Number(this.taxRegimeForm.cessPct))) {
      errors['cessPct'] = 'Health & Education Cess is required';
    } else if (Number(this.taxRegimeForm.cessPct) < 0 || Number(this.taxRegimeForm.cessPct) > 100) {
      errors['cessPct'] = 'Cess percentage must be between 0% and 100%';
    }

    // 3. Sec 87A Full Rebate Limit validation
    if (this.taxRegimeForm.rebateIncomeLimit == null || this.taxRegimeForm.rebateIncomeLimit === '' || isNaN(Number(this.taxRegimeForm.rebateIncomeLimit))) {
      errors['rebateIncomeLimit'] = 'Sec 87A Full Rebate Limit is required';
    } else if (Number(this.taxRegimeForm.rebateIncomeLimit) < 0) {
      errors['rebateIncomeLimit'] = 'Rebate limit cannot be negative';
    }

    // 4. Sec 87A Max Rebate Amount validation
    if (this.taxRegimeForm.rebateMaxAmount == null || this.taxRegimeForm.rebateMaxAmount === '' || isNaN(Number(this.taxRegimeForm.rebateMaxAmount))) {
      errors['rebateMaxAmount'] = 'Sec 87A Max Rebate Amount is required';
    } else if (Number(this.taxRegimeForm.rebateMaxAmount) < 0) {
      errors['rebateMaxAmount'] = 'Rebate amount cannot be negative';
    }

    // 5. Slabs validation
    if (!this.taxRegimeForm.slabs || this.taxRegimeForm.slabs.length === 0) {
      errors['slabs'] = 'At least one income tax slab is required';
    } else {
      for (let i = 0; i < this.taxRegimeForm.slabs.length; i++) {
        const slab = this.taxRegimeForm.slabs[i];
        const isLastSlab = i === this.taxRegimeForm.slabs.length - 1;

        // From Amount
        if (slab.fromAmount == null || slab.fromAmount === '' || isNaN(Number(slab.fromAmount))) {
          errors[`slab_${i}_from`] = `From amount is required for slab #${i + 1}`;
        } else if (Number(slab.fromAmount) < 0) {
          errors[`slab_${i}_from`] = `From amount cannot be negative for slab #${i + 1}`;
        }

        // Up to Amount
        if (slab.toAmount != null && slab.toAmount !== '') {
          if (isNaN(Number(slab.toAmount))) {
            errors[`slab_${i}_to`] = `Up to amount must be a number for slab #${i + 1}`;
          } else if (Number(slab.toAmount) <= Number(slab.fromAmount)) {
            errors[`slab_${i}_to`] = `Up to amount (₹${slab.toAmount}) must be greater than From amount (₹${slab.fromAmount})`;
          }
        } else if (!isLastSlab) {
          errors[`slab_${i}_to`] = `Only the final slab can leave the upper limit blank (unlimited)`;
        }

        // Slab continuity check with previous slab
        if (i > 0) {
          const prevSlab = this.taxRegimeForm.slabs[i - 1];
          if (prevSlab.toAmount != null && prevSlab.toAmount !== '' && !isNaN(Number(prevSlab.toAmount))) {
            if (Number(slab.fromAmount) !== Number(prevSlab.toAmount)) {
              errors[`slab_${i}_from`] = `Slab gap/overlap: Starts at ₹${slab.fromAmount}, but slab #${i} ended at ₹${prevSlab.toAmount}`;
            }
          }
        }

        // Tax Rate (%)
        if (slab.ratePct == null || slab.ratePct === '' || isNaN(Number(slab.ratePct))) {
          errors[`slab_${i}_rate`] = `Tax rate is required for slab #${i + 1}`;
        } else if (Number(slab.ratePct) < 0 || Number(slab.ratePct) > 100) {
          errors[`slab_${i}_rate`] = `Tax rate must be between 0% and 100%`;
        }
      }
    }

    // 6. Surcharge bands validation (if present)
    if (this.taxRegimeForm.surcharge && this.taxRegimeForm.surcharge.length > 0) {
      for (let i = 0; i < this.taxRegimeForm.surcharge.length; i++) {
        const band = this.taxRegimeForm.surcharge[i];
        if (band.fromIncome == null || band.fromIncome === '' || isNaN(Number(band.fromIncome)) || Number(band.fromIncome) <= 0) {
          errors[`surcharge_${i}_income`] = `Income threshold must be greater than ₹0`;
        }
        if (band.ratePct == null || band.ratePct === '' || isNaN(Number(band.ratePct)) || Number(band.ratePct) < 0 || Number(band.ratePct) > 100) {
          errors[`surcharge_${i}_rate`] = `Surcharge rate must be between 0% and 100%`;
        }
      }
    }

    this.taxRegimeErrors.set(errors);

    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      const firstKey = errorKeys[0];
      const firstMsg = errors[firstKey];
      this.toast.error(firstMsg);
      this.scrollToRegimeErrorField(firstKey);
      return;
    }

    this.payrollService.updatePayrollTaxRegime(this.taxRegimeForm.id, this.taxRegimeForm).subscribe({
      next: () => {
        this.toast.success('Tax regime and slabs updated');
        this.closeTaxRegimeModal();
        this.loadAllMasters();
      },
      error: (err) => {
        const msg = err.error?.message || 'Failed to update tax regime';
        this.toast.error(msg);
      },
    });
  }

  // ═══════════════════════════════════════════
  // SALARY CALCULATOR (W7)
  // ═══════════════════════════════════════════

  runCalculator() {
    if (!this.calcGroupId) return;

    this.isCalculating.set(true);
    const monthlyCtc = this.calcCtcType === 'monthly' ? this.calcCtcAmount : Math.round(this.calcCtcAmount / 12);
    const annualCtc = this.calcCtcType === 'annual' ? this.calcCtcAmount : this.calcCtcAmount * 12;

    this.payrollService.calculateSalary({
      monthlyCtc,
      annualCtc,
      groupId: Number(this.calcGroupId),
      regimeCode: this.calcRegimeCode,
      financialYear: '2026-27',
    }).subscribe({
      next: (res) => {
        this.calcResult.set(res);
        this.isCalculating.set(false);
      },
      error: (err) => {
        console.error('Calculation error', err);
        this.toast.error(err.error?.message || 'Calculation failed');
        this.isCalculating.set(false);
      },
    });
  }

  // ═══════════════════════════════════════════
  // AUDIT LOGS (W13)
  // ═══════════════════════════════════════════

  loadAuditLogs() {
    this.payrollService.getPayrollAuditLog(100).subscribe({
      next: (logs) => this.auditLogs.set(logs),
      error: (err) => console.error('Failed to load audit logs', err),
    });
  }

  setCtcPreset(amount: number) {
    this.calcCtcType = 'annual';
    this.calcCtcAmount = amount;
    this.runCalculator();
  }

  copyCode(code: string) {
    navigator.clipboard?.writeText(code);
    this.toast.success(`Copied "${code}" to clipboard`);
  }

  formatCurrency(val: number | null | undefined): string {
    if (val == null) return '₹0';
    return '₹' + Number(val).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  formatDate(d: string | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
}
