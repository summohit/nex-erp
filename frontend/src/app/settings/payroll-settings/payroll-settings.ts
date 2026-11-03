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

type ActiveSettingsTab = 'components' | 'groups' | 'statutory' | 'tax' | 'setup' | 'calculator' | 'audit';

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
  groupErrors = signal<{ code?: string; name?: string }>({});
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

  clearGroupError(field: 'code' | 'name') {
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
    this.groupErrors.set({});
    this.groupForm = {
      code: group.code,
      name: group.name,
      description: group.description || '',
      payeeType: group.payeeType,
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
  }

  saveSalaryGroup() {
    const errors: { code?: string; name?: string } = {};
    if (!this.groupForm.code || !this.groupForm.code.trim()) {
      errors.code = 'Salary group code is required (e.g. REGULAR_CUSTOM)';
    }
    if (!this.groupForm.name || !this.groupForm.name.trim()) {
      errors.name = 'Salary group name is required (e.g. Regular Staff Structure)';
    }
    this.groupErrors.set(errors);

    if (Object.keys(errors).length > 0) {
      this.toast.error('Please enter the required group code and name');
      return;
    }

    if (!this.groupForm.lines || this.groupForm.lines.length === 0) {
      this.toast.error('At least one component line is required');
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
        if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('code')) {
          this.groupErrors.set({ code: msg });
        }
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

  openEditTaxRegimeModal(regime: MasterTaxRegime) {
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
  }

  addSurchargeBand() {
    const last = this.taxRegimeForm.surcharge[this.taxRegimeForm.surcharge.length - 1];
    this.taxRegimeForm.surcharge.push({ fromIncome: last ? last.fromIncome * 2 : 5000000, ratePct: last ? last.ratePct + 5 : 10 });
  }

  removeSurchargeBand(index: number) {
    this.taxRegimeForm.surcharge.splice(index, 1);
  }

  saveTaxRegime() {
    if (!this.taxRegimeForm.id) return;
    this.payrollService.updatePayrollTaxRegime(this.taxRegimeForm.id, this.taxRegimeForm).subscribe({
      next: () => {
        this.toast.success('Tax regime and slabs updated');
        this.closeTaxRegimeModal();
        this.loadAllMasters();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update tax regime'),
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
