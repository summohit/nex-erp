import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { HotToastService } from '@ngneat/hot-toast';
import { PayrollService, Payslip, ExpenseClaim, SalaryComponent, SalaryStructureItem } from '../services/payroll.service';
import { EmployeeService } from '../services/employee.service';
import { AuthService } from '../services/auth.service';
import { ActionCellRendererComponent } from '../shared/components/action-cell-renderer.component';
import { ExpenseActionCellRendererComponent } from '../shared/components/expense-action-cell-renderer.component';
import { 
  LucideFilter, 
  LucideMoreHorizontal,
  LucideChevronDown,
  LucideChevronRight
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
    LucideMoreHorizontal,
    LucideChevronDown,
    LucideChevronRight,
    MatMenuModule
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

  // Structure tab state
  selectedEmployeeId = signal<number | null>(null);
  currentStructure = signal<SalaryStructureItem[]>([]);

  // Drawer / Modal states
  isAdjustModalOpen = signal<boolean>(false);
  selectedPayslipToAdjust = signal<Payslip | null>(null);
  adjustForm = { lossOfPay: 0, totalEarnings: 0, totalDeductions: 0, expenseAmount: 0 };

  isExpenseModalOpen = signal<boolean>(false);
  expenseForm = { title: '', description: '', amount: 0, category: 'OTHER', receiptUrl: '' };
  
  // Rejection Modal
  isRejectModalOpen = signal(false);
  rejectingClaimId = signal<number | null>(null);
  rejectionReason = signal('');

  // File Upload
  selectedFile = signal<File | null>(null);
  isUploading = signal(false);

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

  // Computed Pinned Bottom Total Rows
  processingPinnedBottomRow = computed(() => {
    const list = this.payslips();
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

  // AG Grid columns for Salary Processing
  processingColDefs: ColDef[] = [
    {
      field: 'employee',
      headerName: 'Employee',
      minWidth: 170,
      flex: 1.5,
      pinned: 'left',
      valueFormatter: (params: ValueFormatterParams) => {
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        return emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
      }
    },
    {
      field: 'employee.department.name',
      headerName: 'Department',
      minWidth: 150,
      flex: 1.2,
      valueFormatter: (params: ValueFormatterParams) => params.data?.isSummaryRow ? '' : (params.data?.employee?.department?.name || 'N/A')
    },
    { field: 'workingDays', headerName: 'Working Days', minWidth: 130, flex: 1, valueFormatter: (params) => params.data?.isSummaryRow ? '' : params.value },
    { field: 'presentDays', headerName: 'Present', minWidth: 110, flex: 0.9, valueFormatter: (params) => params.data?.isSummaryRow ? '' : params.value },
    {
      field: 'absentDays',
      headerName: 'Absent',
      minWidth: 110,
      flex: 0.9,
      valueFormatter: (params) => params.data?.isSummaryRow ? '' : params.value,
      cellStyle: (params) => {
        if (!params.data?.isSummaryRow && params.value > 0) return { color: '#EF4444', fontWeight: 'bold' };
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
      minWidth: 150,
      flex: 1.2,
      cellStyle: (params) => {
        if (!params.data?.isSummaryRow && params.value > 0) return { color: '#F59E0B', fontWeight: 'bold' };
        return null;
      },
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'expenseAmount',
      headerName: 'Expenses Reimbursed',
      minWidth: 180,
      flex: 1.4,
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'netPay',
      headerName: 'Net Pay',
      minWidth: 130,
      flex: 1.1,
      cellStyle: { fontWeight: 'bold', color: '#10B981' },
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'status',
      headerName: 'Status',
      minWidth: 120,
      flex: 1,
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return '';
        const status = params.value;
        let badgeClass = 'badge-secondary';
        if (status === 'DRAFT') badgeClass = 'badge-warning';
        if (status === 'FINALIZED') badgeClass = 'badge-info';
        if (status === 'PAID') badgeClass = 'badge-success';
        return `<span class="badge ${badgeClass}">${status}</span>`;
      }
    },
    {
      headerName: 'Actions',
      minWidth: 150,
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
      flex: 1.2,
      pinned: 'left',
      valueFormatter: (params: ValueFormatterParams) => {
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        return emp.lastName ? `${emp.firstName} ${emp.lastName}` : emp.firstName;
      }
    },
    { field: 'title', headerName: 'Title', flex: 1.3, valueFormatter: (params) => params.data?.isSummaryRow ? params.value : params.value },
    { field: 'category', headerName: 'Category', flex: 1 },
    {
      field: 'amount',
      headerName: 'Amount',
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => `₹${(params.value || 0).toLocaleString('en-IN')}`
    },
    {
      field: 'status',
      headerName: 'Status',
      flex: 1,
      cellRenderer: (params: any) => {
        if (params.data?.isSummaryRow) return '';
        const status = params.value;
        let badgeClass = 'badge-warning';
        if (status === 'APPROVED') badgeClass = 'badge-success';
        if (status === 'REJECTED') badgeClass = 'badge-danger';
        return `<span class="badge ${badgeClass}">${status}</span>`;
      }
    },
    {
      headerName: 'Actions',
      width: 140,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: ExpenseActionCellRendererComponent,
      cellRendererParams: {
        onApprove: (data: any) => this.updateExpenseStatus(data.id, 'APPROVED'),
        onReject: (data: any) => this.openRejectModal(data.id)
      }
    }
  ];

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 100,
    sortable: true,
    filter: true
  };

  constructor(
    private payrollService: PayrollService,
    private employeeService: EmployeeService,
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

    // Unconditionally fetch components and employees so structure & dropdown are ready immediately on page load
    this.payrollService.getComponents().subscribe(res => this.components.set(res));
    this.employeeService.getEmployees().subscribe(res => {
      this.employees.set(res);
      if (res.length > 0 && !this.selectedEmployeeId()) {
        this.selectEmployeeForStructure(res[0].id);
      }
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
    } else if (tab === 'payslips') {
      this.loadPayslips();
      this.loadMyPayslips();
    } else if (tab === 'expenses') {
      this.payrollService.getAllExpenseClaims().subscribe(res => this.expenseClaims.set(res));
      this.payrollService.getMyExpenseClaims().subscribe(res => this.myExpenseClaims.set(res));
    } else if (tab === 'structure') {
      this.payrollService.getComponents().subscribe(res => this.components.set(res));
      if (this.employees().length === 0) {
        this.employeeService.getEmployees().subscribe(res => {
          this.employees.set(res);
          if (res.length > 0 && !this.selectedEmployeeId()) {
            this.selectEmployeeForStructure(res[0].id);
          }
        });
      }
    }
  }

  loadPayslips() {
    this.payrollService.getPayslips(this.selectedMonth(), this.selectedYear()).subscribe(res => {
      this.payslips.set(res);
    });
  }

  loadMyPayslips() {
    this.payrollService.getMyPayslips().subscribe(res => {
      this.myPayslips.set(res);
    });
  }

  onPeriodChange() {
    this.loadPayslips();
  }

  generatePayslips() {
    const toastRef = this.toast.loading('Generating payslips based on attendance...');
    this.payrollService.generatePayslips(this.selectedMonth(), this.selectedYear()).subscribe({
      next: (res) => {
        toastRef.close();
        this.payslips.set(res);
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

  openPayslipDetail(payslip: Payslip) {
    this.selectedPayslipDetail.set(payslip);
    this.isPayslipDetailModalOpen.set(true);
  }

  closePayslipDetail() {
    this.isPayslipDetailModalOpen.set(false);
    this.selectedPayslipDetail.set(null);
  }

  // Salary Structure Tab
  selectEmployeeForStructure(empId: number) {
    this.selectedEmployeeId.set(empId);
    this.payrollService.getSalaryStructure(empId).subscribe(res => {
      // Map components with current amounts
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
    });
  }

  saveSalaryStructure() {
    const empId = this.selectedEmployeeId();
    if (!empId) return;

    const payload = this.currentStructure().map(s => ({
      componentId: s.componentId,
      amount: s.amount
    }));

    this.payrollService.updateSalaryStructure(empId, payload).subscribe({
      next: () => this.toast.success('Salary structure saved successfully'),
      error: (err) => this.toast.error(err.error?.message || 'Failed to save salary structure')
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
  openExpenseModal() {
    this.expenseForm = { title: '', description: '', amount: 0, category: 'OTHER', receiptUrl: '' };
    this.selectedFile.set(null);
    this.isExpenseModalOpen.set(true);
  }

  closeExpenseModal() {
    this.isExpenseModalOpen.set(false);
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        this.toast.error('File size should not exceed 5MB');
        return;
      }
      this.selectedFile.set(file);
    }
  }

  submitExpenseClaim() {
    if (this.selectedFile()) {
      this.isUploading.set(true);
      this.payrollService.uploadFile(this.selectedFile()!).subscribe({
        next: (res) => {
          this.isUploading.set(false);
          this.expenseForm.receiptUrl = res.url;
          this.createExpenseClaimApi();
        },
        error: (err) => {
          this.isUploading.set(false);
          this.toast.error('Failed to upload receipt');
        }
      });
    } else {
      this.createExpenseClaimApi();
    }
  }

  private createExpenseClaimApi() {
    this.payrollService.createExpenseClaim(this.expenseForm).subscribe({
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

  viewReceipt(url: string) {
    if (url) window.open(url, '_blank');
  }

  deleteMyExpense(id: number) {
    if (!confirm('Cancel this pending expense claim?')) return;
    this.payrollService.deleteExpenseClaim(id).subscribe({
      next: () => {
        this.toast.success('Expense claim cancelled');
        this.payrollService.getMyExpenseClaims().subscribe(res => this.myExpenseClaims.set(res));
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to cancel claim')
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
}
