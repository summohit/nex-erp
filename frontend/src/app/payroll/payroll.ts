import { Component, OnInit, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { HotToastService } from '@ngneat/hot-toast';
import { PayrollService, Payslip, ExpenseClaim, SalaryComponent, SalaryStructureItem, EmployeeSalaryRow, PayrollPreview } from '../services/payroll.service';
import { EmployeeService } from '../services/employee.service';
import { AuthService } from '../services/auth.service';
import { ProjectsService } from '../services/projects';
import { ActionCellRendererComponent } from '../shared/components/action-cell-renderer.component';
import { ExpenseActionCellRendererComponent } from '../shared/components/expense-action-cell-renderer.component';
import { SearchableSelectComponent, SearchableSelectOption } from '../shared/components/searchable-select/searchable-select.component';
import { UploadService } from '../services/upload.service';
import { 
  LucideFilter, 
  LucideMoreHorizontal,
  LucideChevronDown,
  LucideChevronRight,
  LucideUploadCloud,
  LucideX
} from '@lucide/angular';
import { MatMenuModule } from '@angular/material/menu';

@Component({
  selector: 'app-payroll',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AgGridModule,
    LucideFilter,
    LucideUploadCloud,
    LucideX,
    MatMenuModule,
    SearchableSelectComponent
  ],
  templateUrl: './payroll.html',
  styleUrls: ['./payroll.css']
})
export class PayrollComponent implements OnInit {
  activeTab = signal<string>('processing');

  // Month & Year selection
  selectedMonth = signal<number>(new Date().getMonth() + 1);
  selectedYear = signal<number>(new Date().getFullYear());

  months = [
    { id: 1, name: 'January' },
    { id: 2, name: 'February' },
    { id: 3, name: 'March' },
    { id: 4, name: 'April' },
    { id: 5, name: 'May' },
    { id: 6, name: 'June' },
    { id: 7, name: 'July' },
    { id: 8, name: 'August' },
    { id: 9, name: 'September' },
    { id: 10, name: 'October' },
    { id: 11, name: 'November' },
    { id: 12, name: 'December' }
  ];

  years = [2024, 2025, 2026, 2027];

  // Data signals
  payslips = signal<Payslip[]>([]);
  myPayslips = signal<Payslip[]>([]);
  expenseClaims = signal<ExpenseClaim[]>([]);
  myExpenseClaims = signal<ExpenseClaim[]>([]);
  components = signal<SalaryComponent[]>([]);
  employees = signal<any[]>([]);
  projects = signal<any[]>([]);

  // Structure tab state
  selectedEmployeeId = signal<number | null>(null);
  currentStructure = signal<SalaryStructureItem[]>([]);
  salaryTableData = signal<EmployeeSalaryRow[]>([]);
  isLoadingSalaryTable = signal<boolean>(true);
  salaryViewMode = signal<'table' | 'grid'>('table');
  isSalaryDrawerOpen = signal<boolean>(false);
  selectedSalaryEmployee = signal<EmployeeSalaryRow | null>(null);
  isSavingStructure = signal<boolean>(false);

  // Table filters & sorting
  salaryTableSearchQuery = signal<string>('');
  salaryTableDeptFilter = signal<string>('ALL');
  salaryTableDesigFilter = signal<string>('ALL');
  salaryTableStatusFilter = signal<string>('ALL');
  // Joining date, not name: the table opens on the longest-serving staff
  // rather than on whoever is alphabetically first. Clicking a column header
  // still switches it as before.
  salaryTableSortColumn = signal<string>('joined');
  salaryTableSortDirection = signal<'asc' | 'desc'>('asc');

  // Salary Processing (Tab 1) Filter & Search State
  isLoadingPayslips = signal<boolean>(false);
  processingSearchQuery = signal<string>('');
  processingDeptFilter = signal<string>('ALL');
  processingDesigFilter = signal<string>('ALL');
  processingStatusFilter = signal<string>('ALL');
  processingLopFilter = signal<'ALL' | 'WITH_LOP' | 'ZERO_LOP'>('ALL');
  processingSortColumn = signal<string>('name');
  processingSortDirection = signal<'asc' | 'desc'>('asc');

  // Payslips (Tab 2) Admin Filter & Search State
  payslipSearchQuery = signal<string>('');
  payslipDeptFilter = signal<string>('ALL');
  payslipDesigFilter = signal<string>('ALL');
  payslipStatusFilter = signal<string>('ALL');
  payslipSortColumn = signal<string>('name');
  payslipSortDirection = signal<'asc' | 'desc'>('asc');

  private uploadService = inject(UploadService);

  // Drawer / Modal states
  isAdjustModalOpen = signal<boolean>(false);
  selectedPayslipToAdjust = signal<Payslip | null>(null);
  adjustForm = { lossOfPay: 0, totalEarnings: 0, totalDeductions: 0, expenseAmount: 0 };

  get adjustedNetPay(): number {
    const raw = (this.adjustForm.totalEarnings || 0) - (this.adjustForm.totalDeductions || 0) - (this.adjustForm.lossOfPay || 0) + (this.adjustForm.expenseAmount || 0);
    return Math.max(0, raw);
  }

  isExpenseModalOpen = signal<boolean>(false);
  expenseForm = { title: '', description: '', amount: 0, category: 'OTHER', receiptUrl: '', receipts: [] as string[], purchaseDate: '', purchasedFrom: '', projectCode: '', projectName: '', projectId: null as number | null };
  
  // Image Lightbox Viewer states
  previewImages = signal<string[]>([]);
  activeImageIndex = signal<number>(0);

  // Rejection Modal
  isRejectModalOpen = signal(false);
  rejectingClaimId = signal<number | null>(null);
  rejectionReason = signal('');

  // File Upload
  selectedFile = signal<File | null>(null);
  isUploading = signal(false);

  // Lightbox Navigation Methods
  openImageViewer(images: string[], index = 0) {
    if (!images || images.length === 0) return;
    this.previewImages.set(images);
    this.activeImageIndex.set(index);
  }

  closeImageViewer() {
    this.previewImages.set([]);
    this.activeImageIndex.set(0);
  }

  prevImage() {
    if (this.activeImageIndex() > 0) {
      this.activeImageIndex.update(i => i - 1);
    }
  }

  nextImage() {
    if (this.activeImageIndex() < this.previewImages().length - 1) {
      this.activeImageIndex.update(i => i + 1);
    }
  }

  onExpenseFilesSelected(event: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      if (file.size > 5 * 1024 * 1024) {
        this.toast.error('File size should not exceed 5MB');
        return;
      }
      this.uploadService.uploadFile(file).subscribe({
        next: (res: any) => {
          if (res?.url) {
            this.expenseForm.receipts.push(res.url);
            this.toast.success('Receipt uploaded');
          }
        },
        error: () => this.toast.error('Failed to upload receipt')
      });
    });
  }

  removeExpenseReceipt(index: number) {
    this.expenseForm.receipts.splice(index, 1);
  }

  // Draft Generation States
  isPayslipModalOpen = signal(false);
  isGenerating = signal(false);
  isAdjusting = signal(false);

  // Helper methods for rendering Payslip Items
  cleanComponentName(name: string): string {
    return name ? name.replace(' [Statutory]', '') : '';
  }

  isStatutory(name: string): boolean {
    return name ? name.includes('[Statutory]') : false;
  }

  // Expense Filtering & Grouping
  expenseFilterMonth = signal<number | ''>(new Date().getMonth() + 1);
  expenseFilterYear = signal<number | ''>(new Date().getFullYear());
  expandedEmployeeIds = signal<number[]>([]);

  groupedExpenseClaims = computed(() => {
    const claims = this.expenseClaims();
    const filterMonth = this.expenseFilterMonth();
    const filterYear = this.expenseFilterYear();

    const filtered = claims.filter(c => {
      if (!c.createdAt) return true;
      const d = new Date(c.createdAt);
      const matchMonth = filterMonth === '' || (d.getMonth() + 1) === Number(filterMonth);
      const matchYear = filterYear === '' || d.getFullYear() === Number(filterYear);
      return matchMonth && matchYear;
    });

    const groupsMap = new Map<number, {
      employeeId: number;
      employeeName: string;
      departmentName: string;
      claims: ExpenseClaim[];
      totalAmount: number;
      pendingCount: number;
      approvedCount: number;
      rejectedCount: number;
    }>();

    for (const claim of filtered) {
      const empId = claim.employeeId;
      const empName = claim.employee?.lastName 
        ? `${claim.employee.firstName} ${claim.employee.lastName}` 
        : (claim.employee?.firstName || 'Unknown Employee');
      const deptName = claim.employee?.department?.name || 'General';

      if (!groupsMap.has(empId)) {
        groupsMap.set(empId, {
          employeeId: empId,
          employeeName: empName,
          departmentName: deptName,
          claims: [],
          totalAmount: 0,
          pendingCount: 0,
          approvedCount: 0,
          rejectedCount: 0
        });
      }

      const grp = groupsMap.get(empId)!;
      grp.claims.push(claim);
      grp.totalAmount += claim.amount;
      if (claim.status === 'PENDING') grp.pendingCount++;
      if (claim.status === 'APPROVED') grp.approvedCount++;
      if (claim.status === 'REJECTED') grp.rejectedCount++;
    }

    return Array.from(groupsMap.values());
  });

  toggleEmployeeGroup(empId: number) {
    const current = this.expandedEmployeeIds();
    if (current.includes(empId)) {
      this.expandedEmployeeIds.set(current.filter(id => id !== empId));
    } else {
      this.expandedEmployeeIds.set([...current, empId]);
    }
  }

  isEmployeeExpanded(empId: number): boolean {
    return this.expandedEmployeeIds().includes(empId);
  }

  isComponentModalOpen = signal<boolean>(false);
  componentForm = { name: '', type: 'EARNING', description: '' };

  selectedPayslipDetail = signal<Payslip | null>(null);
  isPayslipDetailModalOpen = signal<boolean>(false);

  // User role helper
  isAdmin = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN' || role === 'FINANCE';
  });

  companyLogoUrl = computed(() => {
    return this.authService.currentUser()?.company?.logoUrl || '/logo.png';
  });

  companyName = computed(() => {
    return this.authService.currentUser()?.company?.name || 'CES Tech ERP';
  });

  selectedEmployee = computed(() => {
    const id = this.selectedEmployeeId();
    return this.employees().find(e => Number(e.id) === Number(id)) || null;
  });

  // Employee Searchable Dropdown State
  isEmpDropdownOpen = signal<boolean>(false);
  empSearchQuery = signal<string>('');

  filteredEmployees = computed(() => {
    const query = this.empSearchQuery().toLowerCase().trim();
    const list = this.employees();
    if (!query) return list;
    return list.filter(e => {
      const fullName = `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase();
      const dept = (e.department?.name || '').toLowerCase();
      const desig = (e.designation?.name || '').toLowerCase();
      return fullName.includes(query) || dept.includes(query) || desig.includes(query);
    });
  });

  toggleEmpDropdown() {
    this.isEmpDropdownOpen.set(!this.isEmpDropdownOpen());
    if (!this.isEmpDropdownOpen()) {
      this.empSearchQuery.set('');
    }
  }

  closeEmpDropdown() {
    this.isEmpDropdownOpen.set(false);
    this.empSearchQuery.set('');
  }

  selectEmpFromDropdown(empId: number) {
    this.selectEmployeeForStructure(empId);
    this.closeEmpDropdown();
  }

  earningStructureItems = computed(() => {
    return this.currentStructure().filter(i => i.component?.type === 'EARNING');
  });

  deductionStructureItems = computed(() => {
    return this.currentStructure().filter(i => i.component?.type === 'DEDUCTION');
  });

  // Salary Table View Filters & Sorting Computeds
  availableDepartments = computed(() => {
    const depts = new Set<string>();
    for (const e of this.salaryTableData()) {
      if (e.department?.name) depts.add(e.department.name);
    }
    return Array.from(depts).sort();
  });

  availableDesignations = computed(() => {
    const desigs = new Set<string>();
    for (const e of this.salaryTableData()) {
      if (e.designation?.name) desigs.add(e.designation.name);
    }
    return Array.from(desigs).sort();
  });

  designationOptions = computed<SearchableSelectOption[]>(() => {
    return [
      { id: 'ALL', name: 'All Designations' },
      ...this.availableDesignations().map(d => ({ id: d, name: d }))
    ];
  });

  departmentOptions = computed<SearchableSelectOption[]>(() => {
    return [
      { id: 'ALL', name: 'All Departments' },
      ...this.availableDepartments().map(d => ({ id: d, name: d }))
    ];
  });

  statusOptions: SearchableSelectOption[] = [
    { id: 'ALL', name: 'All Status' },
    { id: 'CONFIGURED', name: 'Salary Set' },
    { id: 'NOT_CONFIGURED', name: 'Needs Setup' }
  ];

  filteredSalaryRows = computed(() => {
    let rows = [...this.salaryTableData()];
    const query = this.salaryTableSearchQuery().toLowerCase().trim();
    const dept = this.salaryTableDeptFilter();
    const desig = this.salaryTableDesigFilter();
    const status = this.salaryTableStatusFilter();

    if (query) {
      rows = rows.filter(e => {
        const fullName = `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase();
        const dName = (e.department?.name || '').toLowerCase();
        const desName = (e.designation?.name || '').toLowerCase();
        const code = (e.employeeCode || '').toLowerCase();
        const group = (e.salaryGroup || '').toLowerCase();
        return fullName.includes(query) || dName.includes(query) || desName.includes(query) || code.includes(query) || group.includes(query);
      });
    }

    if (dept !== 'ALL') {
      rows = rows.filter(e => e.department?.name === dept);
    }

    if (desig !== 'ALL') {
      rows = rows.filter(e => e.designation?.name === desig);
    }

    if (status === 'CONFIGURED') {
      rows = rows.filter(e => e.hasStructure || (e.netSalary > 0));
    } else if (status === 'NOT_CONFIGURED') {
      rows = rows.filter(e => !e.hasStructure && (!e.netSalary || e.netSalary === 0));
    }

    const sortCol = this.salaryTableSortColumn();
    const dir = this.salaryTableSortDirection() === 'asc' ? 1 : -1;

    /**
     * Suspended people sink, whatever the table is sorted by.
     *
     * Forty of the ninety-seven have left, and alphabetical order scattered
     * them through the list — three of the first four rows were ex-staff with
     * nothing to configure. Sorting is for arranging the people you might act
     * on; someone who has left is not one of them, so they go below the fold
     * rather than being removed, since their history still needs reaching.
     */
    const gone = (e: any) => (e.user?.status === 'SUSPENDED' ? 1 : 0);

    /** Epoch millis, with no joining date sorting last among the active. */
    const joined = (e: any) => {
      const t = e.joiningDate ? new Date(e.joiningDate).getTime() : NaN;
      return Number.isNaN(t) ? Infinity : t;
    };

    rows.sort((a, b) => {
      const away = gone(a) - gone(b);
      if (away) return away;

      let valA: any = '';
      let valB: any = '';

      if (sortCol === 'joined') {
        // The default: earliest joiner first, so the people who built the
        // company read from the top. Ties fall back to name so the order is
        // stable rather than whatever the API happened to return.
        const d = (joined(a) - joined(b)) * dir;
        if (d) return d;
        return `${a.firstName} ${a.lastName || ''}`.localeCompare(`${b.firstName} ${b.lastName || ''}`);
      } else if (sortCol === 'name') {
        valA = `${a.firstName} ${a.lastName || ''}`.toLowerCase();
        valB = `${b.firstName} ${b.lastName || ''}`.toLowerCase();
      } else if (sortCol === 'cycle') {
        valA = (a.salaryCycle || '').toLowerCase();
        valB = (b.salaryCycle || '').toLowerCase();
      } else if (sortCol === 'group') {
        valA = (a.salaryGroup || '').toLowerCase();
        valB = (b.salaryGroup || '').toLowerCase();
      } else if (sortCol === 'allowPayroll') {
        valA = (a.allowPayrollGenerate || '').toLowerCase();
        valB = (b.allowPayrollGenerate || '').toLowerCase();
      } else if (sortCol === 'netSalary') {
        valA = a.netSalary || 0;
        valB = b.netSalary || 0;
      }

      if (typeof valA === 'number' && typeof valB === 'number') {
        return (valA - valB) * dir;
      }
      return String(valA).localeCompare(String(valB)) * dir;
    });

    return rows;
  });

  /**
   * What the period on screen actually adds up to.
   *
   * The KPI strip above the Payslips and Salary Processing tabs used to show
   * `currentStructure()` — one selected employee's salary — under the headings
   * "Gross Payroll" and "Net Take-Home". With August's payslips listed
   * underneath it, the header read ₹17,500 while the cards below totalled
   * ₹30 lakh, and the obvious reading was that the import had gone wrong. It
   * had not: the header was answering a different question from the one its
   * labels asked.
   */
  periodGross = computed(() =>
    this.payslips().reduce((t, p) => t + (p.totalEarnings || 0), 0));
  periodDeductions = computed(() =>
    this.payslips().reduce((t, p) => t + (p.totalDeductions || 0), 0));
  periodLossOfPay = computed(() =>
    this.payslips().reduce((t, p) => t + (p.lossOfPay || 0), 0));
  periodNet = computed(() =>
    this.payslips().reduce((t, p) => t + (p.netPay || 0), 0));
  periodLabel = computed(() => {
    const m = this.months.find((x) => Number(x.id) === Number(this.selectedMonth()));
    return `${m?.name ?? ''} ${this.selectedYear()}`.trim();
  });

  totalCompanyGross = computed(() => {
    return this.salaryTableData().reduce((sum, e) => sum + (e.grossEarnings || 0), 0);
  });

  totalCompanyNet = computed(() => {
    return this.salaryTableData().reduce((sum, e) => sum + (e.netSalary || 0), 0);
  });

  totalCompanyDeductions = computed(() => {
    return this.salaryTableData().reduce((sum, e) => sum + (e.totalDeductions || 0), 0);
  });

  configuredEmployeesCount = computed(() => {
    return this.salaryTableData().filter(e => e.hasStructure || (e.netSalary > 0)).length;
  });

  toggleSalarySort(col: string) {
    if (this.salaryTableSortColumn() === col) {
      this.salaryTableSortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      this.salaryTableSortColumn.set(col);
      this.salaryTableSortDirection.set('asc');
    }
  }

  getSalaryGroupBadgeClass(group: string | undefined): string {
    const g = (group || '').toLowerCase();
    if (g.includes('technical consultant')) return 'badge-group-tech';
    if (g.includes('trainee')) return 'badge-group-trainee';
    if (g.includes('non technical') || g.includes('operations')) return 'badge-group-ops';
    return 'badge-group-default';
  }

  exportSalaryTableToCsv() {
    const rows = this.filteredSalaryRows();
    if (!rows || rows.length === 0) {
      this.toast.info('No data available to export');
      return;
    }

    const headers = [
      'Employee Code',
      'First Name',
      'Last Name',
      'Email',
      'Department',
      'Designation',
      'Salary Cycle',
      'Salary Group',
      'Allow Payroll Generate',
      'Gross Earnings (INR)',
      'Total Deductions (INR)',
      'Net Salary (INR)'
    ];

    const csvLines = [headers.join(',')];

    for (const r of rows) {
      const line = [
        `"${r.employeeCode || ''}"`,
        `"${r.firstName || ''}"`,
        `"${r.lastName || ''}"`,
        `"${r.user?.email || ''}"`,
        `"${r.department?.name || ''}"`,
        `"${r.designation?.name || ''}"`,
        `"${r.salaryCycle || 'Monthly'}"`,
        `"${r.salaryGroup || 'Employee Salary Group'}"`,
        `"${r.allowPayrollGenerate || 'Yes'}"`,
        r.grossEarnings || 0,
        r.totalDeductions || 0,
        r.netSalary || 0
      ];
      csvLines.push(line.join(','));
    }

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `employee-salary-structures-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    this.toast.success('Salary structures exported to CSV');
  }

  // Deactivated staff are shown for history but visually stood down.
  payrollRowClassRules = {
    'payroll-row-inactive': (p: any) =>
      !p.data?.isSummaryRow && p.data?.employee?.user?.status === 'SUSPENDED',
  };

  // Salary Processing (Tab 1) Options, Filtering & Totals
  processingAvailableDepartments = computed(() => {
    const depts = new Set<string>();
    for (const p of this.payslips()) {
      if (p.employee?.department?.name) depts.add(p.employee.department.name);
    }
    return Array.from(depts).sort();
  });

  processingDepartmentOptions = computed<SearchableSelectOption[]>(() => [
    { id: 'ALL', name: 'All Departments' },
    ...this.processingAvailableDepartments().map(d => ({ id: d, name: d }))
  ]);

  processingAvailableDesignations = computed(() => {
    const desigs = new Set<string>();
    for (const p of this.payslips()) {
      if (p.employee?.designation?.name) desigs.add(p.employee.designation.name);
    }
    return Array.from(desigs).sort();
  });

  processingDesignationOptions = computed<SearchableSelectOption[]>(() => [
    { id: 'ALL', name: 'All Designations' },
    ...this.processingAvailableDesignations().map(d => ({ id: d, name: d }))
  ]);

  processingStatusOptions: SearchableSelectOption[] = [
    { id: 'ALL', name: 'All Status' },
    { id: 'DRAFT', name: 'Draft' },
    { id: 'FINALIZED', name: 'Finalized' },
    { id: 'PAID', name: 'Paid' }
  ];

  processingCounts = computed(() => {
    const all = this.payslips();
    let draft = 0, finalized = 0, paid = 0, withLop = 0, zeroLop = 0;
    for (const p of all) {
      const st = p.status || 'DRAFT';
      if (st === 'DRAFT') draft++;
      else if (st === 'FINALIZED') finalized++;
      else if (st === 'PAID') paid++;
      if ((p.lossOfPay || 0) > 0) withLop++;
      else zeroLop++;
    }
    return { total: all.length, draft, finalized, paid, withLop, zeroLop };
  });

  hasActiveProcessingFilters = computed(() => {
    return this.processingSearchQuery().trim() !== '' ||
      this.processingDeptFilter() !== 'ALL' ||
      this.processingDesigFilter() !== 'ALL' ||
      this.processingStatusFilter() !== 'ALL' ||
      this.processingLopFilter() !== 'ALL';
  });

  clearProcessingFilters() {
    this.processingSearchQuery.set('');
    this.processingDeptFilter.set('ALL');
    this.processingDesigFilter.set('ALL');
    this.processingStatusFilter.set('ALL');
    this.processingLopFilter.set('ALL');
  }

  toggleProcessingSort(col: string) {
    if (this.processingSortColumn() === col) {
      this.processingSortDirection.set(this.processingSortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.processingSortColumn.set(col);
      this.processingSortDirection.set('asc');
    }
  }

  filteredProcessingPayslips = computed(() => {
    let list = [...this.payslips()];
    const query = this.processingSearchQuery().toLowerCase().trim();
    const dept = this.processingDeptFilter();
    const desig = this.processingDesigFilter();
    const status = this.processingStatusFilter();
    const lop = this.processingLopFilter();

    if (query) {
      list = list.filter(p => {
        const emp = p.employee;
        const name = `${emp?.firstName || ''} ${emp?.lastName || ''}`.toLowerCase();
        const dName = (emp?.department?.name || '').toLowerCase();
        const desName = (emp?.designation?.name || '').toLowerCase();
        return name.includes(query) || dName.includes(query) || desName.includes(query);
      });
    }

    if (dept !== 'ALL') {
      list = list.filter(p => p.employee?.department?.name === dept);
    }

    if (desig !== 'ALL') {
      list = list.filter(p => p.employee?.designation?.name === desig);
    }

    if (status !== 'ALL') {
      list = list.filter(p => (p.status || 'DRAFT') === status);
    }

    if (lop === 'WITH_LOP') {
      list = list.filter(p => (p.lossOfPay || 0) > 0);
    } else if (lop === 'ZERO_LOP') {
      list = list.filter(p => (p.lossOfPay || 0) === 0);
    }

    const col = this.processingSortColumn();
    const dir = this.processingSortDirection() === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      const ia = a.employee?.user?.status === 'SUSPENDED' ? 1 : 0;
      const ib = b.employee?.user?.status === 'SUSPENDED' ? 1 : 0;
      if (ia !== ib && col === 'name') return ia - ib;

      let valA: any = 0;
      let valB: any = 0;

      if (col === 'name') {
        valA = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`.toLowerCase();
        valB = `${b.employee?.firstName || ''} ${b.employee?.lastName || ''}`.toLowerCase();
        return valA.localeCompare(valB) * dir;
      } else if (col === 'workingDays') {
        valA = a.workingDays || 0;
        valB = b.workingDays || 0;
      } else if (col === 'present') {
        valA = a.presentDays || 0;
        valB = b.presentDays || 0;
      } else if (col === 'absent') {
        valA = a.absentDays || 0;
        valB = b.absentDays || 0;
      } else if (col === 'gross') {
        valA = a.totalEarnings || 0;
        valB = b.totalEarnings || 0;
      } else if (col === 'lop') {
        valA = a.lossOfPay || 0;
        valB = b.lossOfPay || 0;
      } else if (col === 'expenses') {
        valA = a.expenseAmount || 0;
        valB = b.expenseAmount || 0;
      } else if (col === 'net') {
        valA = a.netPay || 0;
        valB = b.netPay || 0;
      } else if (col === 'status') {
        valA = a.status || 'DRAFT';
        valB = b.status || 'DRAFT';
        return valA.localeCompare(valB) * dir;
      }

      return (valA - valB) * dir;
    });

    return list;
  });

  processingTotals = computed(() => {
    const list = this.filteredProcessingPayslips();
    let totalGross = 0;
    let totalLop = 0;
    let totalExpenses = 0;
    let totalNet = 0;

    for (const p of list) {
      totalGross += p.totalEarnings || 0;
      totalLop += p.lossOfPay || 0;
      totalExpenses += p.expenseAmount || 0;
      totalNet += p.netPay || 0;
    }

    return { totalGross, totalLop, totalExpenses, totalNet };
  });

  // Computed Pinned Bottom Total Rows
  processingPinnedBottomRow = computed(() => {
    const list = this.filteredProcessingPayslips();
    if (!list || list.length === 0) return [];
    
    let totalGross = 0;
    let totalLop = 0;
    let totalExpenses = 0;
    let totalNet = 0;

    for (const p of list) {
      totalGross += p.totalEarnings || 0;
      totalLop += p.lossOfPay || 0;
      totalExpenses += p.expenseAmount || 0;
      totalNet += p.netPay || 0;
    }

    return [{
      isSummaryRow: true,
      employee: { firstName: `TOTAL (${list.length})`, lastName: '' },
      totalEarnings: totalGross,
      lossOfPay: totalLop,
      expenseAmount: totalExpenses,
      netPay: totalNet,
      status: ''
    }];
  });

  expensePinnedBottomRow = computed(() => {
    const list = this.expenseClaims();
    if (!list || list.length === 0) return [];
    
    const totalAmount = list.reduce((sum, e) => sum + (e.amount || 0), 0);

    return [{
      isSummaryRow: true,
      employee: { firstName: `TOTAL (${list.length})`, lastName: '' },
      title: 'Total Claims',
      amount: totalAmount,
      status: ''
    }];
  });

  // ==========================================
  // TAB 2: PAYSLIPS ADMIN FILTER & SORT COMPUTED
  // ==========================================
  payslipDepartmentOptions = computed<SearchableSelectOption[]>(() => [
    { id: 'ALL', name: 'All Departments' },
    ...this.processingAvailableDepartments().map(d => ({ id: d, name: d }))
  ]);

  payslipDesignationOptions = computed<SearchableSelectOption[]>(() => [
    { id: 'ALL', name: 'All Designations' },
    ...this.processingAvailableDesignations().map(d => ({ id: d, name: d }))
  ]);

  payslipStatusOptions: SearchableSelectOption[] = [
    { id: 'ALL', name: 'All Status' },
    { id: 'PAID', name: 'Paid' },
    { id: 'FINALIZED', name: 'Finalized' },
    { id: 'DRAFT', name: 'Draft' }
  ];

  hasActivePayslipFilters = computed(() => {
    return this.payslipSearchQuery().trim() !== '' ||
      this.payslipDeptFilter() !== 'ALL' ||
      this.payslipDesigFilter() !== 'ALL' ||
      this.payslipStatusFilter() !== 'ALL';
  });

  clearPayslipFilters() {
    this.payslipSearchQuery.set('');
    this.payslipDeptFilter.set('ALL');
    this.payslipDesigFilter.set('ALL');
    this.payslipStatusFilter.set('ALL');
  }

  togglePayslipSort(col: string) {
    if (this.payslipSortColumn() === col) {
      this.payslipSortDirection.set(this.payslipSortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.payslipSortColumn.set(col);
      this.payslipSortDirection.set('asc');
    }
  }

  filteredPayslipsList = computed(() => {
    let list = [...this.payslips()];
    const query = this.payslipSearchQuery().toLowerCase().trim();
    const dept = this.payslipDeptFilter();
    const desig = this.payslipDesigFilter();
    const status = this.payslipStatusFilter();

    if (query) {
      list = list.filter(p => {
        const emp = p.employee;
        const name = `${emp?.firstName || ''} ${emp?.lastName || ''}`.toLowerCase();
        const dName = (emp?.department?.name || '').toLowerCase();
        const desName = (emp?.designation?.name || '').toLowerCase();
        return name.includes(query) || dName.includes(query) || desName.includes(query);
      });
    }

    if (dept !== 'ALL') {
      list = list.filter(p => p.employee?.department?.name === dept);
    }

    if (desig !== 'ALL') {
      list = list.filter(p => p.employee?.designation?.name === desig);
    }

    if (status !== 'ALL') {
      list = list.filter(p => (p.status || 'DRAFT') === status);
    }

    const col = this.payslipSortColumn();
    const dir = this.payslipSortDirection() === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      const ia = a.employee?.user?.status === 'SUSPENDED' ? 1 : 0;
      const ib = b.employee?.user?.status === 'SUSPENDED' ? 1 : 0;
      if (ia !== ib && col === 'name') return ia - ib;

      let valA: any = 0;
      let valB: any = 0;

      if (col === 'name') {
        valA = `${a.employee?.firstName || ''} ${a.employee?.lastName || ''}`.toLowerCase();
        valB = `${b.employee?.firstName || ''} ${b.employee?.lastName || ''}`.toLowerCase();
        return valA.localeCompare(valB) * dir;
      } else if (col === 'workingDays') {
        valA = a.workingDays || 0;
        valB = b.workingDays || 0;
      } else if (col === 'present') {
        valA = a.presentDays || 0;
        valB = b.presentDays || 0;
      } else if (col === 'absent') {
        valA = a.absentDays || 0;
        valB = b.absentDays || 0;
      } else if (col === 'gross') {
        valA = a.totalEarnings || 0;
        valB = b.totalEarnings || 0;
      } else if (col === 'lop') {
        valA = a.lossOfPay || 0;
        valB = b.lossOfPay || 0;
      } else if (col === 'expenses') {
        valA = a.expenseAmount || 0;
        valB = b.expenseAmount || 0;
      } else if (col === 'net') {
        valA = a.netPay || 0;
        valB = b.netPay || 0;
      } else if (col === 'status') {
        valA = a.status || 'DRAFT';
        valB = b.status || 'DRAFT';
        return valA.localeCompare(valB) * dir;
      }

      return (valA - valB) * dir;
    });

    return list;
  });

  payslipsTabTotals = computed(() => {
    const list = this.filteredPayslipsList();
    let totalGross = 0;
    let totalLop = 0;
    let totalExpenses = 0;
    let totalNet = 0;

    for (const p of list) {
      totalGross += p.totalEarnings || 0;
      totalLop += p.lossOfPay || 0;
      totalExpenses += p.expenseAmount || 0;
      totalNet += p.netPay || 0;
    }

    return { totalGross, totalLop, totalExpenses, totalNet };
  });

  payslipsTabCounts = computed(() => {
    const all = this.payslips();
    let draft = 0, finalized = 0, paid = 0;
    for (const p of all) {
      const st = p.status || 'DRAFT';
      if (st === 'DRAFT') draft++;
      else if (st === 'FINALIZED') finalized++;
      else if (st === 'PAID') paid++;
    }
    return { total: all.length, draft, finalized, paid };
  });

  // AG Grid columns for Salary Processing
  processingColDefs: ColDef[] = [
    {
      field: 'employee',
      headerName: 'Employee',
      valueFormatter: (p) => p.value ? (p.value.lastName ? `${p.value.firstName} ${p.value.lastName}` : p.value.firstName) : (p.data?.isSummaryRow ? 'TOTAL' : ''),
      minWidth: 200,
      flex: 1.6,
      pinned: 'left',
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return `<strong>${params.data.employee?.firstName || 'TOTAL'}</strong>`;
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        const name = emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
        const dept = emp.department?.name || 'General';
        const initial = (emp.firstName || 'E').charAt(0);
        // Real photo where we have one; the initial stays as the fallback.
        const avatar = emp.avatarUrl
          ? `<img src="${emp.avatarUrl}" class="avatar-circle-sm avatar-img" alt="" />`
          : `<div class="avatar-circle-sm">${initial}</div>`;
        const inactive = emp.user?.status === 'SUSPENDED';
        const badge = inactive ? `<span class="inactive-tag">Inactive</span>` : '';
        return `
          <div class="cell-user-avatar-row${inactive ? ' is-inactive' : ''}">
            ${avatar}
            <div class="cell-stacked">
              <div class="cell-title-bold">${name}${badge}</div>
              <div class="user-text-stack text-secondary">${dept}</div>
            </div>
          </div>
        `;
      }
    },
    { field: 'workingDays', headerName: 'Working Days', minWidth: 120, flex: 0.9, valueFormatter: (params) => params.data?.isSummaryRow ? '' : params.value },
    { field: 'presentDays', headerName: 'Present', minWidth: 100, flex: 0.8, valueFormatter: (params) => params.data?.isSummaryRow ? '' : params.value },
    {
      field: 'absentDays',
      headerName: 'Absent',
      minWidth: 100,
      flex: 0.8,
      valueFormatter: (params) => params.data?.isSummaryRow ? '' : params.value,
      cellStyle: (params) => {
        if (!params.data?.isSummaryRow && params.value > 0) return { color: '#DC2626', fontWeight: 'bold' };
        return null;
      }
    },
    {
      field: 'totalEarnings',
      headerName: 'Gross Pay',
      minWidth: 130,
      flex: 1.1,
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'lossOfPay',
      headerName: 'LOP (Deducted)',
      minWidth: 140,
      flex: 1.1,
      cellStyle: (params) => {
        if (!params.data?.isSummaryRow && params.value > 0) return { color: '#D97706', fontWeight: 'bold' };
        return null;
      },
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'expenseAmount',
      headerName: 'Expenses Reimbursed',
      minWidth: 160,
      flex: 1.3,
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'netPay',
      headerName: 'Net Pay',
      minWidth: 130,
      flex: 1.1,
      cellStyle: { fontWeight: 'bold', color: '#059669' },
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'status',
      headerName: 'Status',
      minWidth: 130,
      flex: 1,
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return '';
        const status = params.value || 'DRAFT';
        let statusClass = 'status-pending';
        if (status === 'DRAFT') statusClass = 'status-draft';
        if (status === 'FINALIZED') statusClass = 'status-approved';
        if (status === 'PAID') statusClass = 'status-paid';
        return `
          <span class="status-round ${statusClass}">
            <span class="status-dot"></span>
            ${status}
          </span>
        `;
      }
    },
    {
      headerName: 'Actions',
      minWidth: 140,
      flex: 1,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onView: (data: any) => this.openPayslipDetail(data),
        onEdit: (data: any) => this.openAdjustModal(data),
        editLabel: 'Adjust Salary',
        onFinalize: (data: any) => data.status === 'DRAFT' ? this.finalizeIndividual(data) : this.toast.info(`Payslip is already ${data.status.toLowerCase()}`),
        onMarkPaid: (data: any) => data.status !== 'PAID' ? this.markIndividualPaid(data) : this.toast.info('Payslip is already marked as PAID')
      }
    }
  ];

  // AG Grid columns for Expense Claims (Admin)
  expenseColDefs: ColDef[] = [
    {
      field: 'employee',
      headerName: 'Employee',
      valueFormatter: (p) => p.value ? (p.value.lastName ? `${p.value.firstName} ${p.value.lastName}` : p.value.firstName) : (p.data?.isSummaryRow ? 'TOTAL' : ''),
      minWidth: 200,
      flex: 1.5,
      pinned: 'left',
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return `<strong>${params.data.employee?.firstName || 'TOTAL'}</strong>`;
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        const name = emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
        const dept = emp.department?.name || 'General';
        const initial = (emp.firstName || 'E').charAt(0);
        // Real photo where we have one; the initial stays as the fallback.
        const avatar = emp.avatarUrl
          ? `<img src="${emp.avatarUrl}" class="avatar-circle-sm avatar-img" alt="" />`
          : `<div class="avatar-circle-sm">${initial}</div>`;
        const inactive = emp.user?.status === 'SUSPENDED';
        const badge = inactive ? `<span class="inactive-tag">Inactive</span>` : '';
        return `
          <div class="cell-user-avatar-row${inactive ? ' is-inactive' : ''}">
            ${avatar}
            <div class="cell-stacked">
              <div class="cell-title-bold">${name}${badge}</div>
              <div class="user-text-stack text-secondary">${dept}</div>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'title',
      headerName: 'Title & Category',
      flex: 1.8,
      minWidth: 200,
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return `<strong>${params.value || ''}</strong>`;
        const title = params.data?.title || 'Expense Claim';
        const vendor = params.data?.purchasedFrom ? `Vendor: ${params.data.purchasedFrom}` : '';
        const category = params.data?.category || 'OTHER';
        return `
          <div class="cell-stacked">
            <div class="cell-title-bold">${title}</div>
            <div class="cell-subtitle-row">
              <span class="cat-badge cat-laptop">${category}</span>
              <span>${vendor}</span>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'purchaseDate',
      headerName: 'Purchase Date',
      flex: 1.1,
      minWidth: 130,
      valueFormatter: (params: any) => {
        if (!params.value) return '-';
        return new Date(params.value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    },
    {
      field: 'amount',
      headerName: 'Amount',
      flex: 1.1,
      minWidth: 120,
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`,
      cellStyle: { fontWeight: 'bold' }
    },
    {
      field: 'receiptUrl',
      headerName: 'Receipts',
      flex: 1.1,
      minWidth: 130,
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return '';
        let imgs: string[] = [];
        if (params.value) {
          try {
            imgs = typeof params.value === 'string' && params.value.startsWith('[') ? JSON.parse(params.value) : [params.value];
          } catch (e) { imgs = [params.value]; }
        }
        if (!imgs || imgs.length === 0 || !imgs[0]) return '<span style="color: #94A3B8; font-size: 12px;">No receipt</span>';
        return `
          <div class="cell-user-avatar-row" style="cursor: pointer;" title="Click to view receipt">
            <img src="${imgs[0]}" style="width: 30px; height: 30px; border-radius: 6px; object-fit: cover; border: 1px solid #CBD5E1;" />
            <span style="font-size: 11px; font-weight: 600; color: #2563EB;">${imgs.length} receipt(s)</span>
          </div>
        `;
      },
      onCellClicked: (params: any) => {
        let imgs: string[] = [];
        if (params.value) {
          try {
            imgs = typeof params.value === 'string' && params.value.startsWith('[') ? JSON.parse(params.value) : [params.value];
          } catch (e) { imgs = [params.value]; }
        }
        if (imgs && imgs.length > 0 && imgs[0]) {
          this.openImageViewer(imgs, 0);
        }
      }
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 1.2,
      minWidth: 130,
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return '';
        const s = params.value || 'PENDING';
        let statusClass = 'status-pending';
        if (s === 'APPROVED') statusClass = 'status-approved';
        if (s === 'REJECTED') statusClass = 'status-rejected';
        if (s === 'PAID') statusClass = 'status-paid';
        const reasonHtml = s === 'REJECTED' && params.data?.rejectionReason
          ? `<div style="font-size: 10px; color: #DC2626; font-weight: 500; line-height: 1.2; margin-top: 3px;">Reason: ${params.data.rejectionReason}</div>`
          : '';
        return `
          <div class="cell-stacked">
            <span class="status-round ${statusClass}">
              <span class="status-dot"></span>
              ${s}
            </span>
            ${reasonHtml}
          </div>
        `;
      }
    },
    {
      headerName: 'Actions',
      width: 110,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: ExpenseActionCellRendererComponent,
      cellRendererParams: {
        onApprove: (data: any) => this.updateExpenseStatus(data.id, 'APPROVED'),
        onReject: (data: any) => this.openRejectModal(data.id),
        onMarkPaid: (data: any) => this.markExpensePaid(data)
      }
    }
  ];

  // Column definitions for employee's own submitted claims - NO approve/reject, but CAN cancel
  myExpenseColDefs: ColDef[] = this.expenseColDefs.slice(0, -1).concat([
    {
      headerName: 'Actions',
      width: 110,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: ExpenseActionCellRendererComponent,
      cellRendererParams: {
        // No onApprove or onReject — employees cannot approve/reject their own claims
        onDelete: (data: any) => this.deleteMyExpense(data.id)
      }
    }
  ]);

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 100,
    sortable: true,
    filter: true
  };

  constructor(
    private payrollService: PayrollService,
    private employeeService: EmployeeService,
    private projectsService: ProjectsService,
    public authService: AuthService,
    private toast: HotToastService,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab) {
        this.activeTab.set(tab);
      }
      this.loadTabContent();
    });

    // When auth user profile arrives, re-evaluate tab content
    this.authService.getMe().subscribe(() => {
      this.loadTabContent();
    });

    // Unconditionally fetch components, employees, and salary table so all views are ready immediately
    this.payrollService.getComponents().subscribe(res => this.components.set(res));
    this.employeeService.getEmployees().subscribe(res => {
      this.employees.set(res);
      if (res.length > 0 && !this.selectedEmployeeId()) {
        this.selectEmployeeForStructure(res[0].id, false);
      }
    });
    this.loadSalaryStructuresTable();
    this.projectsService.getProjects().subscribe(res => {
      this.projects.set(res);
    });
  }

  setTab(tab: string) {
    this.activeTab.set(tab);
    this.router.navigate(['/payroll', tab]);
    this.loadTabContent();
  }

  loadTabContent() {
    const tab = this.activeTab();
    if (tab === 'processing') {
      this.loadPayslips();
      this.loadPayrollPreview();
    } else if (tab === 'payslips') {
      this.loadPayslips();
      this.loadMyPayslips();
    } else if (tab === 'expenses') {
      this.payrollService.getAllExpenseClaims().subscribe(res => this.expenseClaims.set(res));
      this.payrollService.getMyExpenseClaims().subscribe(res => this.myExpenseClaims.set(res));
    } else if (tab === 'structure') {
      this.payrollService.getComponents().subscribe(res => this.components.set(res));
      this.loadSalaryStructuresTable();
    }
  }

  loadPayslips() {
    this.isLoadingPayslips.set(true);
    this.payrollService.getPayslips(this.selectedMonth(), this.selectedYear()).subscribe({
      next: (res) => {
        this.isLoadingPayslips.set(false);
        this.payslips.set(this.sortPayrollRows(res));
      },
      error: () => {
        this.isLoadingPayslips.set(false);
      }
    });
  }

  loadMyPayslips() {
    this.payrollService.getMyPayslips().subscribe(res => {
      this.myPayslips.set(res);
    });
  }

  /**
   * Deactivated staff sink to the bottom of the payroll grid. They no longer
   * receive new drafts, but historic payslips stay visible and auditable.
   */
  private sortPayrollRows(rows: any[]): any[] {
    return [...(rows || [])].sort((a, b) => {
      const ia = a.employee?.user?.status === 'SUSPENDED' ? 1 : 0;
      const ib = b.employee?.user?.status === 'SUSPENDED' ? 1 : 0;
      if (ia !== ib) return ia - ib;
      return (a.employee?.firstName || '').localeCompare(b.employee?.firstName || '');
    });
  }

  onPeriodChange() {
    this.loadPayslips();
    this.loadPayrollPreview();
  }

  // ─── Pre-flight ───────────────────────────────────────────────────────────
  //
  // Payroll reads attendance and deducts a day's pay for every working day it
  // cannot account for. That is right when attendance is right. For September
  // 2026 it was not: about 60% of working days were recorded, and generating
  // would have taken ₹15.1 lakh — 46% of gross — off people who had worked.
  // The arithmetic was never the problem, and it was only visible afterwards,
  // on payslips that had already been shown to somebody.
  //
  // So the damage is now computed first and put on screen next to the button.
  payrollPreview = signal<PayrollPreview | null>(null);
  isPreviewing = signal(false);

  loadPayrollPreview() {
    this.isPreviewing.set(true);
    this.payrollService.previewPayroll(Number(this.selectedMonth()), Number(this.selectedYear()))
      .subscribe({
        next: (p) => { this.payrollPreview.set(p); this.isPreviewing.set(false); },
        // A preview that fails must not block the run, only stop reassuring.
        error: () => { this.payrollPreview.set(null); this.isPreviewing.set(false); },
      });
  }

  /** Loss of pay big enough that the attendance record is the likelier culprit. */
  previewIsAlarming = computed(() => {
    const p = this.payrollPreview();
    return !!p && (p.lossOfPayShare > 0.1 || p.severelyAffected > 0 || p.noAttendance > 0);
  });

  generatePayslips(skipLossOfPay = false) {
    const p = this.payrollPreview();
    if (skipLossOfPay) {
      const amount = p ? `₹${Math.round(p.totalLossOfPay).toLocaleString('en-IN')}` : 'the loss of pay';
      if (!confirm(
        `Generate without loss of pay?\n\n${amount} that would have been deducted for `
        + `unrecorded days will not be. Everyone is paid as though present all month.\n\n`
        + `Attendance itself is unchanged — this affects these payslips only.`,
      )) return;
    } else if (this.previewIsAlarming()) {
      const pct = p ? Math.round(p.lossOfPayShare * 100) : 0;
      if (!confirm(
        `${pct}% of gross pay would be deducted as loss of pay, and `
        + `${p?.severelyAffected ?? 0} people would lose over half their salary.\n\n`
        + `That usually means attendance is incomplete rather than that people were away.\n\n`
        + `Generate anyway?`,
      )) return;
    }

    const toastRef = this.toast.loading('Generating payslips based on attendance...');
    this.payrollService.generatePayslips(this.selectedMonth(), this.selectedYear(), skipLossOfPay).subscribe({
      next: (res) => {
        toastRef.close();
        this.payslips.set(this.sortPayrollRows(res));
        this.toast.success(`Payslips generated for ${res.length} employees`);
      },
      error: (err) => {
        toastRef.close();
        this.toast.error(err.error?.message || 'Failed to generate payslips');
      }
    });
  }

  batchFinalize() {
    if (!confirm('Are you sure you want to finalize all DRAFT payslips for this period? Employees will be able to view their finalized payslips.')) return;
    this.payrollService.batchFinalizePayslips(Number(this.selectedMonth()), Number(this.selectedYear())).subscribe({
      next: () => {
        this.toast.success('All draft payslips finalized successfully');
        this.loadPayslips();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to finalize payslips')
    });
  }

  markPaid() {
    if (!confirm('Mark all finalized payslips as PAID for this period?')) return;
    this.payrollService.markPayslipsPaid(Number(this.selectedMonth()), Number(this.selectedYear())).subscribe({
      next: () => {
        this.toast.success('Payslips marked as PAID');
        this.loadPayslips();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update payslips')
    });
  }

  sendBulkPayslipEmails() {
    if (!confirm('Send payslip PDF emails to all employees for this period?')) return;
    const toastRef = this.toast.loading('Dispatching payslip emails...');
    this.payrollService.sendPayslipEmails(Number(this.selectedMonth()), Number(this.selectedYear())).subscribe({
      next: (res) => {
        toastRef.close();
        this.toast.success(`Dispatched ${res.sentCount} emails (${res.failedCount} failed) out of ${res.totalCount}`);
      },
      error: (err) => {
        toastRef.close();
        this.toast.error(err.error?.message || 'Failed to dispatch emails');
      }
    });
  }

  markIndividualPaid(payslip: any) {
    const empName = payslip.employee ? `${payslip.employee.firstName} ${payslip.employee.lastName}` : 'employee';
    if (!confirm(`Mark payslip for ${empName} as PAID?`)) return;
    this.payrollService.updatePayslip(payslip.id, { status: 'PAID' }).subscribe({
      next: () => {
        this.toast.success(`Payslip for ${empName} marked as PAID`);
        this.loadPayslips();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update status')
    });
  }

  finalizeIndividual(payslip: any) {
    const empName = payslip.employee ? `${payslip.employee.firstName} ${payslip.employee.lastName}` : 'employee';
    if (!confirm(`Finalize payslip for ${empName}?`)) return;
    this.payrollService.updatePayslip(payslip.id, { status: 'FINALIZED' }).subscribe({
      next: () => {
        this.toast.success(`Payslip for ${empName} finalized successfully`);
        this.loadPayslips();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to finalize payslip')
    });
  }

  // Adjust Payslip Modal
  openAdjustModal(payslip: Payslip) {
    this.selectedPayslipToAdjust.set(payslip);
    this.adjustForm = {
      lossOfPay: payslip.lossOfPay,
      totalEarnings: payslip.totalEarnings,
      totalDeductions: payslip.totalDeductions,
      expenseAmount: payslip.expenseAmount
    };
    this.isAdjustModalOpen.set(true);
  }

  closeAdjustModal() {
    this.isAdjustModalOpen.set(false);
    this.selectedPayslipToAdjust.set(null);
  }

  saveAdjustedPayslip() {
    const p = this.selectedPayslipToAdjust();
    if (!p) return;

    this.payrollService.updatePayslip(p.id, this.adjustForm).subscribe({
      next: () => {
        this.toast.success('Payslip adjusted successfully');
        this.closeAdjustModal();
        this.loadPayslips();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to adjust payslip')
    });
  }

  isPayslipBusy = signal(false);

  openPayslipDetail(payslip: Payslip) {
    // Show what the grid already has straight away, then replace it with the
    // full record. The list query does not carry items, so opening from a card
    // used to show a payslip with an empty breakdown for as long as it stayed
    // open — the figures were right and the lines that explain them missing.
    this.selectedPayslipDetail.set(payslip);
    this.isPayslipDetailModalOpen.set(true);
    this.payrollService.getPayslipDetail(payslip.id).subscribe({
      next: (full) => {
        if (this.selectedPayslipDetail()?.id === full.id) this.selectedPayslipDetail.set(full);
      },
      error: () => { /* keep the summary; it is not wrong, only thinner */ },
    });
  }

  // ─── Editing a payslip by its components ──────────────────────────────────
  //
  // The old adjust dialog edited three totals — earnings, deductions, loss of
  // pay — which is enough to change what somebody is paid and not enough to
  // say why. This edits the lines, the way the payslip is written, and lets
  // the server derive the totals from them.
  isPayslipEditOpen = signal(false);
  editingPayslip = signal<Payslip | null>(null);
  editDays = signal<number>(0);
  editItems = signal<{ componentName: string; type: string; amount: number; fixed: boolean }[]>([]);

  /** The lines every payslip has a slot for, in the order the slip prints them. */
  private static readonly STANDARD: { name: string; type: string }[] = [
    { name: 'Basic Salary', type: 'EARNING' },
    { name: 'House Rent Allowance (HRA)', type: 'EARNING' },
    { name: 'Travel Allowance', type: 'EARNING' },
    { name: 'Medical Allowance', type: 'EARNING' },
    { name: 'Special Allowance', type: 'EARNING' },
    { name: 'Provident Fund (EPF)', type: 'DEDUCTION' },
    { name: 'Employee State Insurance (ESI)', type: 'DEDUCTION' },
    { name: 'Tax Deducted at Source (TDS)', type: 'DEDUCTION' },
    { name: 'Advance Salary', type: 'DEDUCTION' },
    { name: 'Unpaid Days Deduction', type: 'DEDUCTION' },
  ];

  openPayslipEdit(p: Payslip) {
    const existing = (p.items || []).map((i) => ({
      componentName: i.componentName,
      type: i.type,
      amount: i.amount,
      fixed: false,
    }));

    // A generated payslip carries loss of pay in its own field, and the server
    // folds it into a line on save. Surfacing it here means the editor shows
    // every rupee being deducted rather than silently carrying one.
    if ((p.lossOfPay || 0) > 0 && !existing.some((i) => /unpaid days/i.test(i.componentName))) {
      existing.push({
        componentName: 'Unpaid Days Deduction', type: 'DEDUCTION',
        amount: p.lossOfPay, fixed: false,
      });
    }

    const rows = PayrollComponent.STANDARD.map((std) => {
      const found = existing.find((i) => i.componentName === std.name);
      return {
        componentName: std.name,
        type: std.type,
        amount: found ? found.amount : 0,
        fixed: true,
      };
    });
    // Anything the slip has that is not one of the standard ten — a custom
    // line — is kept and stays removable.
    for (const i of existing) {
      if (!PayrollComponent.STANDARD.some((s) => s.name === i.componentName)) rows.push(i);
    }

    this.editingPayslip.set(p);
    this.editItems.set(rows);
    this.editDays.set(p.workingDays || 0);
    this.isPayslipEditOpen.set(true);
  }

  closePayslipEdit() {
    this.isPayslipEditOpen.set(false);
    this.editingPayslip.set(null);
    this.editItems.set([]);
  }

  addEditRow(type: 'EARNING' | 'DEDUCTION') {
    this.editItems.update((rows) => [...rows, { componentName: '', type, amount: 0, fixed: false }]);
  }

  removeEditRow(row: any) {
    this.editItems.update((rows) => rows.filter((r) => r !== row));
  }

  editRowsOf(type: 'EARNING' | 'DEDUCTION') {
    return this.editItems().filter((r) => r.type === type);
  }

  editTotal(type: 'EARNING' | 'DEDUCTION'): number {
    return this.editItems()
      .filter((r) => r.type === type)
      .reduce((t, r) => t + (Number(r.amount) || 0), 0);
  }

  get editNet(): number {
    return Math.max(0, this.editTotal('EARNING') - this.editTotal('DEDUCTION'));
  }

  /**
   * Derived, not stored: NEX has no slip-number column, and inventing one that
   * looked like the payslip app's would imply the two were the same sequence.
   */
  slipNumber(p: Payslip | null): string {
    if (!p) return '—';
    return `${p.year}/${String(p.month).padStart(2, '0')}/${p.employee?.id ?? p.id}`;
  }

  savePayslipEdit() {
    const p = this.editingPayslip();
    if (!p) return;

    const items = this.editItems()
      .filter((r) => r.componentName.trim() && Number(r.amount) > 0)
      .map((r) => ({ componentName: r.componentName.trim(), type: r.type, amount: Number(r.amount) }));

    if (!items.length) { this.toast.error('A payslip needs at least one line'); return; }
    if (p.status === 'PAID' &&
        !confirm(`This payslip is marked PAID — ${p.employee?.firstName ?? 'the employee'} may already have it.\n\nSave changes anyway?`)) {
      return;
    }

    this.isPayslipBusy.set(true);
    this.payrollService.updatePayslipItems(p.id, {
      items,
      workingDays: this.editDays() || undefined,
      presentDays: this.editDays() || undefined,
    }).subscribe({
      next: (updated) => {
        this.isPayslipBusy.set(false);
        this.toast.success('Payslip updated');
        this.selectedPayslipDetail.set(updated);
        this.payslips.update((list) => list.map((x) => (x.id === updated.id ? updated : x)));
        this.closePayslipEdit();
      },
      error: (err) => {
        this.isPayslipBusy.set(false);
        this.toast.error(err.error?.message || 'Could not save that payslip');
      },
    });
  }

  /** Save the PDF the server renders, rather than printing the browser's view. */
  downloadPayslip(p: Payslip) {
    this.isPayslipBusy.set(true);
    this.payrollService.downloadPayslip(p.id).subscribe({
      next: (blob) => {
        this.isPayslipBusy.set(false);
        const name = `${p.employee?.firstName ?? 'payslip'}-${this.getMonthName(p.month)}-${p.year}`
          .replace(/[^A-Za-z0-9-]/g, '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${name}.pdf`;
        a.click();
        // Revoking immediately can cancel the download in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      },
      error: () => { this.isPayslipBusy.set(false); this.toast.error('Could not download that payslip'); },
    });
  }

  /** Re-send to one person. The bulk button would mail the whole company. */
  resendPayslip(p: Payslip) {
    const who = `${p.employee?.firstName ?? ''} ${p.employee?.lastName ?? ''}`.trim();
    if (!confirm(`Email this payslip to ${who} again?`)) return;
    this.isPayslipBusy.set(true);
    this.payrollService.sendOnePayslipEmail(p.id).subscribe({
      next: (r) => { this.isPayslipBusy.set(false); this.toast.success(`Sent to ${r.email}`); },
      error: (err) => {
        this.isPayslipBusy.set(false);
        this.toast.error(err.error?.message || 'Could not send that payslip');
      },
    });
  }

  /**
   * "One Lakh Twenty Nine Thousand Three Hundred and Sixty Eight Rupees Only".
   *
   * Indian grouping, not thousands: after the first thousand the groups are
   * two digits — lakh, crore — so a Western converter renders 1,29,368 as
   * "one hundred twenty nine thousand", which is not what a payslip says.
   */
  amountInWords(amount: number): string {
    const n = Math.floor(Math.abs(amount || 0));
    if (n === 0) return 'Zero Rupees Only';

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
      'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
      'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    const under100 = (v: number): string =>
      v < 20 ? ones[v] : `${tens[Math.floor(v / 10)]}${v % 10 ? ' ' + ones[v % 10] : ''}`;
    const under1000 = (v: number): string => {
      const h = Math.floor(v / 100);
      const r = v % 100;
      return [h ? `${ones[h]} Hundred` : '', r ? (h ? 'and ' : '') + under100(r) : '']
        .filter(Boolean).join(' ');
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

  closePayslipDetail() {
    this.isPayslipDetailModalOpen.set(false);
    this.selectedPayslipDetail.set(null);
  }

  /**
   * Switch someone on or off payroll, and save it.
   *
   * The dropdown used to be bound with [(ngModel)] and nothing else: it
   * changed the row in memory, saved nothing, and was back to its old value on
   * the next refresh. Worse, generation ignored the setting entirely, so even
   * a value that had stuck would not have kept anybody off a payslip.
   *
   * The row is updated first so the select does not sit on the old value
   * while the request is in flight, and put back if the request fails —
   * a control that silently disagrees with the server is what this is
   * replacing.
   */
  setAllowPayroll(emp: EmployeeSalaryRow, value: string) {
    const previous = emp.allowPayrollGenerate;
    if (previous === value) return;
    emp.allowPayrollGenerate = value;

    this.payrollService.setAllowPayrollGenerate(emp.id, value === 'Yes').subscribe({
      next: () => {
        this.toast.success(
          value === 'Yes'
            ? `${emp.firstName} will be included in payroll`
            : `${emp.firstName} will be left out of payroll`,
        );
      },
      error: () => {
        emp.allowPayrollGenerate = previous;
        this.toast.error('Could not save that — the setting is unchanged');
      },
    });
  }

  // Salary Structure Tab
  loadSalaryStructuresTable() {
    this.isLoadingSalaryTable.set(true);
    this.payrollService.getAllSalaryStructures().subscribe({
      next: (res) => {
        this.isLoadingSalaryTable.set(false);
        this.salaryTableData.set(res);
        // The row the drawer opens on has to be the row the eye lands on.
        // Picking res[0] took the API's own order, which is alphabetical and
        // includes people who have left — so the table showed the longest-
        // serving employee at the top while the drawer was configuring a
        // suspended Aaditya Sondhi.
        const first = this.filteredSalaryRows()[0];
        if (first && !this.selectedEmployeeId()) {
          this.selectEmployeeForStructure(first.id, false);
        }
      },
      error: () => {
        this.isLoadingSalaryTable.set(false);
        // Fallback from employees() if API call fails
        const emps = this.employees();
        if (emps && emps.length > 0) {
          const mapped: EmployeeSalaryRow[] = emps.map(e => ({
            id: e.id,
            firstName: e.firstName,
            lastName: e.lastName,
            avatarUrl: e.avatarUrl,
            employeeCode: e.employeeCode,
            department: e.department,
            designation: e.designation,
            user: e.user,
            salaryCycle: 'Monthly',
            salaryGroup: e.designation?.name?.toLowerCase().includes('consultant')
              ? 'Technical Consultant'
              : (e.designation?.name?.toLowerCase().includes('trainee') ? 'Trainee Stipend' : (e.department?.name || 'Employee Salary Group')),
            allowPayrollGenerate: e.user?.status !== 'SUSPENDED' ? 'Yes' : 'No',
            grossEarnings: 0,
            totalDeductions: 0,
            netSalary: 0,
            hasStructure: false
          }));
          this.salaryTableData.set(mapped);
          if (mapped.length > 0 && !this.selectedEmployeeId()) {
            this.selectEmployeeForStructure(mapped[0].id, false);
          }
        }
      }
    });
  }

  selectEmployeeForStructure(empId: number, openDrawer = false) {
    this.selectedEmployeeId.set(empId);
    const empRow = this.salaryTableData().find(e => e.id === empId);
    if (empRow) {
      this.selectedSalaryEmployee.set(empRow);
    }
    if (openDrawer) {
      this.isSalaryDrawerOpen.set(true);
    }

    this.payrollService.getSalaryStructure(empId).subscribe({
      next: (res) => {
        const allComp = this.components();
        const mapped: SalaryStructureItem[] = allComp.map(c => {
          const found = res.find(r => r.componentId === c.id);
          return {
            componentId: c.id,
            component: c,
            amount: found ? found.amount : 0
          };
        });
        this.currentStructure.set(mapped);
      },
      error: () => {
        if (empRow?.salaryStructures && empRow.salaryStructures.length > 0) {
          const allComp = this.components();
          const mapped: SalaryStructureItem[] = allComp.map(c => {
            const found = empRow.salaryStructures?.find(r => r.componentId === c.id);
            return {
              componentId: c.id,
              component: c,
              amount: found ? found.amount : 0
            };
          });
          this.currentStructure.set(mapped);
        }
      }
    });
  }

  openSalaryDrawer(emp: EmployeeSalaryRow) {
    this.selectEmployeeForStructure(emp.id, true);
  }

  closeSalaryDrawer() {
    this.isSalaryDrawerOpen.set(false);
  }

  saveSalaryStructure() {
    const empId = this.selectedEmployeeId();
    if (!empId) return;

    this.isSavingStructure.set(true);
    const payload = this.currentStructure().map(s => ({
      componentId: s.componentId,
      amount: Number(s.amount) || 0
    }));

    this.payrollService.updateSalaryStructure(empId, payload).subscribe({
      next: () => {
        this.isSavingStructure.set(false);
        this.toast.success('Salary structure saved successfully');

        // Recalculate amounts
        const gross = this.calculateTotalEarnings(this.currentStructure());
        const ded = this.calculateTotalDeductions(this.currentStructure());
        const net = Math.max(0, gross - ded);

        // Update local salaryTableData row
        this.salaryTableData.update(list => list.map(e => {
          if (e.id === empId) {
            return {
              ...e,
              grossEarnings: gross,
              totalDeductions: ded,
              netSalary: net,
              hasStructure: gross > 0
            };
          }
          return e;
        }));

        this.closeSalaryDrawer();
      },
      error: (err) => {
        this.isSavingStructure.set(false);
        this.toast.error(err.error?.message || 'Failed to save salary structure');
      }
    });
  }

  // Custom Salary Components
  openComponentModal() {
    this.componentForm = { name: '', type: 'EARNING', description: '' };
    this.isComponentModalOpen.set(true);
  }

  closeComponentModal() {
    this.isComponentModalOpen.set(false);
  }

  saveComponent() {
    this.payrollService.createComponent(this.componentForm).subscribe({
      next: () => {
        this.toast.success('Custom salary component created');
        this.closeComponentModal();
        this.payrollService.getComponents().subscribe(res => {
          this.components.set(res);
          if (this.selectedEmployeeId()) {
            this.selectEmployeeForStructure(this.selectedEmployeeId()!);
          }
        });
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to create component')
    });
  }

  deleteComponent(id: number) {
    if (!confirm('Are you sure you want to delete this custom component?')) return;
    this.payrollService.deleteComponent(id).subscribe({
      next: () => {
        this.toast.success('Component deleted');
        this.payrollService.getComponents().subscribe(res => this.components.set(res));
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to delete component')
    });
  }

  // Expense Claims
  projectOptions = computed(() => {
    return this.projects().map(p => ({
      id: p.id,
      name: `${p.name} (${p.key || p.code})`
    }));
  });

  onProjectSelected(projectId: any) {
    if (!projectId) {
      this.expenseForm.projectId = null;
      this.expenseForm.projectName = '';
      this.expenseForm.projectCode = '';
      return;
    }
    const project = this.projects().find(p => p.id === projectId);
    if (project) {
      this.expenseForm.projectId = project.id;
      this.expenseForm.projectName = project.name;
      this.expenseForm.projectCode = project.key || project.code || '';
    }
  }

  openExpenseModal() {
    this.expenseForm = { 
      title: '',
      description: '',
      amount: 0,
      category: 'OTHER',
      receiptUrl: '',
      receipts: [],
      purchaseDate: new Date().toISOString().split('T')[0],
      purchasedFrom: '',
      projectCode: '',
      projectName: '',
      projectId: null
    };
    this.selectedFile.set(null);
    this.isExpenseModalOpen.set(true);
  }

  closeExpenseModal() {
    this.isExpenseModalOpen.set(false);
  }

  submitExpenseClaim() {
    if (!this.expenseForm.title || !this.expenseForm.amount) {
      this.toast.error('Please fill in title and amount');
      return;
    }

    const amount = Number(this.expenseForm.amount);
    if (!amount || amount <= 0) {
      this.toast.error('Claim amount must be greater than zero');
      return;
    }

    const MAX_CLAIM_LIMIT = 100000;
    if (amount > MAX_CLAIM_LIMIT) {
      this.toast.error(`Expense limit exceeded. Maximum claim limit is ₹1,00,000. You entered ₹${amount.toLocaleString('en-IN')}.`);
      return;
    }

    const payload = {
      title: this.expenseForm.title,
      description: this.expenseForm.description,
      amount: amount,
      category: this.expenseForm.category,
      purchaseDate: this.expenseForm.purchaseDate,
      purchasedFrom: this.expenseForm.purchasedFrom,
      projectCode: this.expenseForm.projectCode || undefined,
      projectName: this.expenseForm.projectName || undefined,
      projectId: this.expenseForm.projectId || undefined,
      receiptUrl: this.expenseForm.receipts.length > 0 ? JSON.stringify(this.expenseForm.receipts) : ''
    };


    this.payrollService.createExpenseClaim(payload).subscribe({
      next: () => {
        this.toast.success('Expense claim submitted for approval');
        this.closeExpenseModal();
        this.payrollService.getMyExpenseClaims().subscribe(res => this.myExpenseClaims.set(res));
        if (this.isAdmin()) {
          this.payrollService.getAllExpenseClaims().subscribe(res => this.expenseClaims.set(res));
        }
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to submit expense claim')
    });
  }

  openRejectModal(id: number) {
    this.rejectingClaimId.set(id);
    this.rejectionReason.set('');
    this.isRejectModalOpen.set(true);
  }

  closeRejectModal() {
    this.isRejectModalOpen.set(false);
    this.rejectingClaimId.set(null);
    this.rejectionReason.set('');
  }

  confirmRejectClaim() {
    const id = this.rejectingClaimId();
    if (!id) return;
    if (!this.rejectionReason().trim()) {
      this.toast.error('Please provide a reason for rejection');
      return;
    }
    
    this.payrollService.updateExpenseClaimStatus(id, { status: 'REJECTED', rejectionReason: this.rejectionReason() }).subscribe({
      next: () => {
        this.toast.success('Expense claim rejected');
        this.closeRejectModal();
        this.payrollService.getAllExpenseClaims().subscribe(res => this.expenseClaims.set(res));
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to reject claim')
    });
  }

  updateExpenseStatus(id: number, status: 'APPROVED' | 'REJECTED') {
    this.payrollService.updateExpenseClaimStatus(id, { status }).subscribe({
      next: () => {
        this.toast.success(`Expense claim ${status.toLowerCase()}`);
        this.payrollService.getAllExpenseClaims().subscribe(res => this.expenseClaims.set(res));
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update expense claim')
    });
  }

  markExpensePaid(data: any) {
    if (!confirm(`Mark this expense claim as paid?`)) return;
    this.payrollService.updateExpenseClaimStatus(data.id, { status: 'PAID' }).subscribe({
      next: () => {
        this.toast.success('Expense claim marked as paid');
        this.payrollService.getAllExpenseClaims().subscribe(res => this.expenseClaims.set(res));
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to mark expense claim as paid')
    });
  }

  viewReceipt(url: string) {
    if (url) window.open(url, '_blank');
  }

  deleteMyExpense(id: number) {
    if (!confirm('Are you sure you want to delete this expense claim?')) return;
    this.payrollService.deleteExpenseClaim(id).subscribe({
      next: () => {
        this.toast.success('Expense claim deleted');
        this.payrollService.getMyExpenseClaims().subscribe(res => this.myExpenseClaims.set(res));
        if (this.isAdmin()) {
          this.payrollService.getAllExpenseClaims().subscribe(res => this.expenseClaims.set(res));
        }
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to delete claim')
    });
  }

  getMonthName(monthNum: number): string {
    const m = this.months.find(x => x.id === monthNum);
    return m ? m.name : '';
  }

  calculateTotalEarnings(items: SalaryStructureItem[]): number {
    return items
      .filter(i => i.component.type === 'EARNING')
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  }

  calculateTotalDeductions(items: SalaryStructureItem[]): number {
    return items
      .filter(i => i.component.type === 'DEDUCTION')
      .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
  }

  calculateNetPay(items: SalaryStructureItem[]): number {
    const gross = this.calculateTotalEarnings(items);
    const deductions = this.calculateTotalDeductions(items);
    return Math.max(0, gross - deductions);
  }
}
