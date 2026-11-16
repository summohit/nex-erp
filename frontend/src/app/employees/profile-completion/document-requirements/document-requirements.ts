import { Component, EventEmitter, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { DocumentRule, EmployeeService } from '../../../services/employee.service';

/**
 * HR / Super Admin decide which documents are required (16 Nov 2026): per
 * type, whether it is required (everyone / not interns or first job / no),
 * how many files make it complete, and the hint the employee sees. The same
 * list drives onboarding, the profile reminder and every upload dropdown.
 */
@Component({
  selector: 'app-document-requirements',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './document-requirements.html',
  styleUrls: ['./document-requirements.css'],
})
export class DocumentRequirementsComponent implements OnInit {
  @Output() closed = new EventEmitter<boolean>();

  private employees = inject(EmployeeService);
  private toast = inject(HotToastService);

  rules = signal<DocumentRule[]>([]);
  loading = signal(true);
  saving = signal(false);
  newType = '';

  ngOnInit() {
    this.employees.getDocumentTypes().subscribe({
      next: (r) => { this.rules.set((r.rules || []).map(x => ({ ...x }))); this.loading.set(false); },
      error: () => { this.loading.set(false); this.toast.error('Could not load the document rules'); },
    });
  }

  requiredCount(): number {
    return this.rules().filter(r => r.active && r.required !== 'OPTIONAL').length;
  }

  addType() {
    const type = this.newType.trim();
    if (type.length < 2) { this.toast.error('Type the document name'); return; }
    if (type.toLowerCase() === 'other' || this.rules().some(r => r.type.toLowerCase() === type.toLowerCase())) {
      this.toast.error('That document type already exists'); return;
    }
    this.rules.set([...this.rules(), { type, required: 'ALL', count: 1, active: true }]);
    this.newType = '';
  }

  move(i: number, dir: -1 | 1) {
    const list = [...this.rules()];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.rules.set(list);
  }

  save() {
    this.saving.set(true);
    const clean = this.rules().map(r => ({ ...r, count: Math.min(10, Math.max(1, Math.floor(Number(r.count) || 1))) }));
    this.employees.saveDocumentPolicy(clean).subscribe({
      next: () => { this.saving.set(false); this.toast.success('Document requirements saved'); this.closed.emit(true); },
      error: (e) => { this.saving.set(false); this.toast.error(e?.error?.message || 'Could not save'); },
    });
  }
}
