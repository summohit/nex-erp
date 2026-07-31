import { Component, EventEmitter, Output, Input, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MasterDataService, Department, Designation, Branch } from '../../services/master-data.service';
import { EmployeeService } from '../../services/employee.service';
import { ShiftsService } from '../../services/shifts.service';
import { AuthService } from '../../services/auth.service';
import { Shift } from '../../services/attendance';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideX } from '@lucide/angular';

@Component({
  selector: 'app-employee-drawer',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, LucideX],
  templateUrl: './employee-drawer.html',
  styleUrls: ['./employee-drawer.css']
})
export class EmployeeDrawerComponent implements OnInit {
  @Input() isOpen = false;
  @Input() employeeData: any = null; // if null, it's create mode
  @Output() closeDrawer = new EventEmitter<void>();
  @Output() saveSuccess = new EventEmitter<void>();

  private fb = inject(FormBuilder);
  private masterDataService = inject(MasterDataService);
  private employeeService = inject(EmployeeService);
  private shiftsService = inject(ShiftsService);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);

  form: FormGroup;
  departments: Department[] = [];
  designations: Designation[] = [];
  filteredDesignations: Designation[] = [];
  branches: Branch[] = [];
  shifts: Shift[] = [];
  employees: any[] = [];
  isSaving = false;

  constructor() {
    this.form = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      phone: [''],
      departmentId: [null, Validators.required],
      designationId: [null, Validators.required],
      branchId: [null, Validators.required],
      shiftId: [null, Validators.required],
      managerId: [null],
      role: ['EMPLOYEE', Validators.required]
    });
  }

  ngOnInit() {
    this.loadMasterData();

    this.form.get('departmentId')?.valueChanges.subscribe(deptId => {
      if (deptId) {
        this.filteredDesignations = this.designations.filter(d => d.departmentId === Number(deptId) && d.isActive !== false);
        // Reset designation if not in new list
        const currentDesig = this.form.get('designationId')?.value;
        if (currentDesig && !this.filteredDesignations.find(d => d.id === currentDesig)) {
          this.form.patchValue({ designationId: null });
        }
      } else {
        this.filteredDesignations = [];
        this.form.patchValue({ designationId: null });
      }
    });
  }

  ngOnChanges() {
    if (this.isOpen) {
      // Permission check: only SUPERADMIN and ADMIN can change roles
      const currentUserRole = this.authService.currentUser()?.role;
      if (currentUserRole !== 'SUPERADMIN' && currentUserRole !== 'ADMIN') {
        this.form.get('role')?.disable();
      } else {
        this.form.get('role')?.enable();
      }

      if (this.employeeData) {
        this.form.patchValue({
          firstName: this.employeeData.firstName,
          lastName: this.employeeData.lastName,
          email: this.employeeData.user?.email,
          phone: this.employeeData.phone,
          departmentId: this.employeeData.departmentId,
          designationId: this.employeeData.designationId,
          branchId: this.employeeData.branchId,
          shiftId: this.employeeData.shiftId,
          managerId: this.employeeData.managerId,
          role: this.employeeData.user?.role || 'EMPLOYEE'
        });
        if (this.employeeData.id) {
          // Disable email field on edit since we don't want to change User email easily right now
          this.form.get('email')?.disable();
        }
      } else {
        this.form.reset({ role: 'EMPLOYEE' });
        this.form.get('email')?.enable();
      }
    }
  }

  loadMasterData() {
    this.masterDataService.getDepartments(true).subscribe(data => {
      this.departments = data;
    });
    this.masterDataService.getDesignations(true).subscribe(data => {
      this.designations = data;
      // Trigger filter if department already selected
      const currentDept = this.form.get('departmentId')?.value;
      if (currentDept) {
        this.filteredDesignations = this.designations.filter(d => d.departmentId === Number(currentDept));
      }
    });
    this.masterDataService.getBranches().subscribe(data => {
      this.branches = data;
    });
    this.shiftsService.getShifts().subscribe(res => this.shifts = res);
    this.employeeService.getEmployees().subscribe(data => {
      // Don't let an employee be their own manager
      if (this.employeeData?.id) {
        this.employees = data.filter(e => e.id !== this.employeeData.id);
      } else {
        this.employees = data;
      }
    });
  }

  close() {
    this.closeDrawer.emit();
  }

  save() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSaving = true;
    const data = this.form.getRawValue(); // gets disabled fields too

    if (this.employeeData && this.employeeData.id) {
      this.employeeService.updateEmployee(this.employeeData.id, data).subscribe({
        next: () => {
          this.toast.success('Employee updated successfully');
          this.isSaving = false;
          this.saveSuccess.emit();
          this.close();
        },
        error: (err) => {
          this.isSaving = false;
          this.toast.error(err.error?.message || 'Failed to update employee');
        }
      });
    } else {
      this.employeeService.createEmployee(data).subscribe({
        next: () => {
          this.toast.success('Employee created. Default password: Welcome@123');
          this.isSaving = false;
          this.saveSuccess.emit();
          this.close();
        },
        error: (err) => {
          this.isSaving = false;
          this.toast.error(err.error?.message || 'Failed to create employee');
        }
      });
    }
  }
}
