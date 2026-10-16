import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { EmployeeService, ProfileCompletenessReport } from '../../services/employee.service';

/**
 * HR's view of the profile-completion drive (16 Oct 2026): who still has
 * documents or details missing, what exactly, and their reporting manager,
 * so HR can follow up. Exempt accounts are not listed.
 */
@Component({
  selector: 'app-profile-completion',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './profile-completion.html',
  styleUrl: './profile-completion.css',
})
export class ProfileCompletionComponent implements OnInit {
  private employees = inject(EmployeeService);

  report = signal<ProfileCompletenessReport | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  filter = signal<'INCOMPLETE' | 'COMPLETE' | 'ALL'>('INCOMPLETE');
  query = signal('');

  rows = computed(() => {
    const r = this.report();
    if (!r) return [];
    const q = this.query().trim().toLowerCase();
    return r.rows.filter((row) => {
      if (this.filter() === 'INCOMPLETE' && row.complete) return false;
      if (this.filter() === 'COMPLETE' && !row.complete) return false;
      if (!q) return true;
      const e = row.employee;
      return `${e.firstName} ${e.lastName ?? ''} ${e.employeeCode ?? ''} ${e.department ?? ''} ${row.manager ?? ''}`.toLowerCase().includes(q);
    });
  });

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.employees.getProfileCompletenessReport().subscribe({
      next: (r) => { this.report.set(r); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.message || 'Could not load profile completion'); this.loading.set(false); },
    });
  }

  /** CSV for HR to share with managers. */
  download() {
    const rows = this.rows();
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Employee', 'Code', 'Email', 'Department', 'Manager', 'Status', 'Missing'].map(esc).join(','),
      ...rows.map((r) => [
        `${r.employee.firstName} ${r.employee.lastName ?? ''}`.trim(), r.employee.employeeCode, r.employee.email,
        r.employee.department, r.manager, r.complete ? 'Complete' : 'Incomplete', r.missing.join('; '),
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
