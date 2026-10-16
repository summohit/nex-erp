import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { EmployeeService, ProfileCompletenessReport } from '../../services/employee.service';
import {
  LucideArrowLeft,
  LucideRefreshCw,
  LucideDownload,
  LucideUsers,
  LucideCheckCircle2,
  LucideAlertCircle,
  LucideSparkles,
  LucideSearch,
  LucideX,
  LucideChevronDown,
  LucideChevronUp,
  LucideFileQuestion,
  LucideBuilding,
  LucideUserCheck
} from '@lucide/angular';

/**
 * HR's view of the profile-completion drive (16 Oct 2026): who still has
 * documents or details missing, what exactly, and their reporting manager,
 * so HR can follow up. Exempt accounts are not listed.
 */
@Component({
  selector: 'app-profile-completion',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    LucideArrowLeft,
    LucideRefreshCw,
    LucideDownload,
    LucideUsers,
    LucideCheckCircle2,
    LucideAlertCircle,
    LucideSparkles,
    LucideSearch,
    LucideX,
    LucideChevronDown,
    LucideChevronUp,
    LucideFileQuestion,
    LucideBuilding,
    LucideUserCheck
  ],
  templateUrl: './profile-completion.html',
  styleUrl: './profile-completion.css',
})
export class ProfileCompletionComponent implements OnInit {
  private employees = inject(EmployeeService);

  report = signal<ProfileCompletenessReport | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  filter = signal<'INCOMPLETE' | 'COMPLETE' | 'ALL'>('INCOMPLETE');
  selectedDepartment = signal<string>('ALL');
  query = signal('');
  expandedRows = signal<Set<number>>(new Set<number>());
  allExpanded = signal<boolean>(false);

  departments = computed(() => {
    const r = this.report();
    if (!r) return [];
    const depts = new Set<string>();
    for (const row of r.rows) {
      if (row.employee.department) depts.add(row.employee.department);
    }
    return Array.from(depts).sort();
  });

  completionRate = computed(() => {
    const r = this.report();
    if (!r || !r.total) return 0;
    return Math.round((r.complete / r.total) * 100);
  });

  incompleteRate = computed(() => {
    const r = this.report();
    if (!r || !r.total) return 0;
    return Math.round((r.incomplete / r.total) * 100);
  });

  rows = computed(() => {
    const r = this.report();
    if (!r) return [];
    const q = this.query().trim().toLowerCase();
    const dept = this.selectedDepartment();

    return r.rows.filter((row) => {
      if (this.filter() === 'INCOMPLETE' && row.complete) return false;
      if (this.filter() === 'COMPLETE' && !row.complete) return false;
      if (dept !== 'ALL' && row.employee.department !== dept) return false;
      if (!q) return true;
      const e = row.employee;
      const missingStr = row.missing ? row.missing.join(' ') : '';
      const searchable = `${e.firstName || ''} ${e.lastName || ''} ${e.employeeCode || ''} ${e.email || ''} ${e.department || ''} ${e.designation || ''} ${row.manager || ''} ${missingStr}`.toLowerCase();
      return searchable.includes(q);
    });
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.employees.getProfileCompletenessReport().subscribe({
      next: (r) => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(e?.error?.message || 'Could not load profile completion report.');
        this.loading.set(false);
      },
    });
  }

  isRowExpanded(employeeId: number): boolean {
    if (this.allExpanded()) return true;
    return this.expandedRows().has(employeeId);
  }

  toggleRow(employeeId: number) {
    if (this.allExpanded()) {
      const current = new Set<number>();
      const r = this.report();
      if (r) {
        for (const row of r.rows) {
          if (row.employee.id !== employeeId) current.add(row.employee.id);
        }
      }
      this.allExpanded.set(false);
      this.expandedRows.set(current);
      return;
    }
    const current = new Set(this.expandedRows());
    if (current.has(employeeId)) {
      current.delete(employeeId);
    } else {
      current.add(employeeId);
    }
    this.expandedRows.set(current);
  }

  toggleAllExpanded() {
    const next = !this.allExpanded();
    this.allExpanded.set(next);
    if (!next) {
      this.expandedRows.set(new Set());
    }
  }

  getDisplayMissing(row: ProfileCompletenessReport['rows'][number]): string[] {
    if (!row.missing) return [];
    if (this.isRowExpanded(row.employee.id)) {
      return row.missing;
    }
    return row.missing.slice(0, 3);
  }

  getInitials(firstName: string, lastName?: string | null): string {
    const f = firstName?.trim() ? firstName.trim()[0].toUpperCase() : '';
    const l = lastName?.trim() ? lastName.trim()[0].toUpperCase() : '';
    return (f + l) || 'EM';
  }

  getAvatarBg(id: number): string {
    const colors = [
      '#3b82f6', // blue
      '#8b5cf6', // violet
      '#10b981', // emerald
      '#f59e0b', // amber
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#6366f1', // indigo
      '#14b8a6', // teal
    ];
    return colors[Math.abs(id) % colors.length];
  }

  clearFilters() {
    this.query.set('');
    this.selectedDepartment.set('ALL');
    this.filter.set('INCOMPLETE');
  }

  /** CSV for HR to share with managers. */
  download() {
    const rows = this.rows();
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Employee', 'Code', 'Email', 'Department', 'Manager', 'Status', 'Missing Items Count', 'Missing', 'Files in Other'].map(esc).join(','),
      ...rows.map((r) => [
        `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim(),
        r.employee.employeeCode ?? '',
        r.employee.email ?? '',
        r.employee.department ?? '',
        r.manager ?? '',
        r.complete ? 'Complete' : 'Incomplete',
        r.missing ? r.missing.length : 0,
        r.missing ? r.missing.join('; ') : '',
        r.uploadedAsOther ?? 0,
      ].map(esc).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `profile-completion-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
