import { Component, computed, inject, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { LifecycleService, LcOverview, LcPip, LcPipDetail } from '../../services/lifecycle.service';
import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';

/**
 * Probation, notice period and PIPs (19 Oct 2026), the Performance tab.
 * HR and admins see everyone and set probation; a reporting manager sees
 * their direct reports and can run a PIP for them; everyone sees their own PIP.
 */
@Component({
  selector: 'app-people-watch',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './people-watch.html',
  styleUrls: ['./people-watch.css'],
})
export class PeopleWatchComponent implements OnInit {
  private api = inject(LifecycleService);
  private toast = inject(HotToastService);
  profile = inject(ProfileModalService);

  @Input() initialSection: 'probation' | 'notice' | 'pip' = 'probation';

  data = signal<LcOverview | null>(null);
  myPips = signal<LcPip[]>([]);
  history = signal<LcPip[]>([]);
  loading = signal(true);
  section = signal<'probation' | 'notice' | 'pip'>('probation');
  showHistory = signal(false);
  busy = signal(false);

  canSee = computed(() => {
    const d = this.data();
    return !!d && (d.canManageProbation || d.isManager);
  });

  // ---- Probation dialog
  probOpen = signal(false);
  probMode: 'months' | 'date' = 'months';
  probEmployeeId: number | null = null;
  probEmployeeName = '';
  probMonths = 6;
  probDate = '';
  probQuery = signal('');
  probMatches = computed(() => {
    const q = this.probQuery().trim().toLowerCase();
    const d = this.data();
    if (!q || !d) return [];
    const on = new Set(d.probation.map((p) => p.employeeId));
    return d.people
      .filter((p) => !on.has(p.id))
      .filter((p) => `${p.name} ${p.employeeCode ?? ''} ${p.designation ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  });

  // ---- PIP dialogs
  pipOpen = signal(false);
  pipForm = { employeeId: null as number | null, employeeName: '', reason: '', goals: '', startDate: '', endDate: '' };
  pipQuery = signal('');
  pipMatches = computed(() => {
    const q = this.pipQuery().trim().toLowerCase();
    const d = this.data();
    if (!q || !d) return [];
    const open = new Set(d.pips.map((p) => p.employeeId));
    return d.people
      .filter((p) => !open.has(p.id))
      .filter((p) => `${p.name} ${p.employeeCode ?? ''} ${p.designation ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  });
  detail = signal<LcPipDetail | null>(null);
  checkInNote = '';
  closeAction: '' | 'EXTEND' | 'COMPLETED' | 'FAILED' | 'CANCELLED' = '';
  closeNote = '';
  extendDate = '';

  ngOnInit() {
    this.section.set(this.initialSection);
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.overview().subscribe({
      next: (d) => { this.data.set(d); this.loading.set(false); },
      error: () => { this.data.set(null); this.loading.set(false); },
    });
    this.api.myPips().subscribe({ next: (l) => this.myPips.set(l), error: () => this.myPips.set([]) });
  }

  loadHistory() {
    this.showHistory.set(!this.showHistory());
    if (this.showHistory()) this.api.pipHistory().subscribe({ next: (l) => this.history.set(l), error: () => this.history.set([]) });
  }

  today(): string {
    return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  }
  addMonths(iso: string | null, months: number): string {
    const base = iso ? new Date(iso) : new Date(`${this.today()}T00:00:00Z`);
    const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()));
    return d.toISOString().slice(0, 10);
  }
  dueText(days: number | null): string {
    if (days === null) return '—';
    if (days === 0) return 'Today';
    if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
    return `${days} day${days === 1 ? '' : 's'} left`;
  }
  dueClass(days: number | null): string {
    if (days === null) return '';
    if (days < 0) return 'due-over';
    if (days <= 7) return 'due-soon';
    if (days <= 30) return 'due-near';
    return 'due-ok';
  }
  initials(name: string) { return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }
  statusLabel(s: string) {
    return ({ ACTIVE: 'Active', EXTENDED: 'Extended', COMPLETED: 'Completed', FAILED: 'Not improved', CANCELLED: 'Cancelled', PENDING: 'Pending approval', APPROVED: 'Approved' } as any)[s] ?? s;
  }

  // ---- Probation
  openProbation(row?: { employeeId: number; name: string; endDate: string }) {
    this.probEmployeeId = row?.employeeId ?? null;
    this.probEmployeeName = row?.name ?? '';
    this.probQuery.set('');
    this.probMode = row ? 'date' : 'months';
    this.probMonths = 6;
    this.probDate = row ? row.endDate.slice(0, 10) : '';
    this.probOpen.set(true);
  }
  pickProbPerson(p: { id: number; name: string }) {
    this.probEmployeeId = p.id;
    this.probEmployeeName = p.name;
    this.probQuery.set('');
  }
  probPreview(): string {
    if (this.probMode === 'date') return this.probDate;
    const person = this.data()?.people.find((p) => p.id === this.probEmployeeId);
    return this.addMonths(person?.joiningDate ?? null, Number(this.probMonths) || 0);
  }
  saveProbation() {
    if (!this.probEmployeeId) { this.toast.error('Choose the employee'); return; }
    const body = this.probMode === 'date' ? { endDate: this.probDate } : { months: Number(this.probMonths) };
    if (this.probMode === 'date' && !this.probDate) { this.toast.error('Choose the end date'); return; }
    this.busy.set(true);
    this.api.setProbation(this.probEmployeeId, body).subscribe({
      next: () => { this.busy.set(false); this.probOpen.set(false); this.toast.success('Probation saved'); this.load(); },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not save probation'); },
    });
  }
  confirmProbation(row: { employeeId: number; name: string }) {
    if (!confirm(`Confirm ${row.name}? Their probation ends and they move to confirmed staff.`)) return;
    this.api.confirmProbation(row.employeeId).subscribe({
      next: () => { this.toast.success(`${row.name} confirmed`); this.load(); },
      error: (e) => this.toast.error(e.error?.message || 'Could not confirm'),
    });
  }
  clearProbation(row: { employeeId: number; name: string }) {
    if (!confirm(`Take ${row.name} off probation? Use this only if they were added by mistake.`)) return;
    this.api.clearProbation(row.employeeId).subscribe({
      next: () => { this.toast.success('Removed from probation'); this.load(); },
      error: (e) => this.toast.error(e.error?.message || 'Could not change probation'),
    });
  }

  // ---- PIP
  openPipForm() {
    this.pipForm = { employeeId: null, employeeName: '', reason: '', goals: '', startDate: this.today(), endDate: this.addMonths(this.today(), 1) };
    this.pipQuery.set('');
    this.pipOpen.set(true);
  }
  pickPipPerson(p: { id: number; name: string }) {
    this.pipForm.employeeId = p.id;
    this.pipForm.employeeName = p.name;
    this.pipQuery.set('');
  }
  savePip() {
    const f = this.pipForm;
    if (!f.employeeId) { this.toast.error('Choose the employee'); return; }
    if (!f.reason.trim() || !f.goals.trim()) { this.toast.error('Write the reason and the goals'); return; }
    if (!f.startDate || !f.endDate || f.endDate <= f.startDate) { this.toast.error('The end date must be after the start date'); return; }
    this.busy.set(true);
    this.api.createPip({ employeeId: f.employeeId, reason: f.reason, goals: f.goals, startDate: f.startDate, endDate: f.endDate }).subscribe({
      next: (d) => { this.busy.set(false); this.pipOpen.set(false); this.toast.success('PIP started'); this.load(); this.detail.set(d); },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not start the PIP'); },
    });
  }
  openPip(id: number) {
    this.checkInNote = ''; this.closeAction = ''; this.closeNote = ''; this.extendDate = '';
    this.api.getPip(id).subscribe({ next: (d) => this.detail.set(d), error: (e) => this.toast.error(e.error?.message || 'Could not open the PIP') });
  }
  addCheckIn() {
    const d = this.detail();
    if (!d || !this.checkInNote.trim()) return;
    this.busy.set(true);
    this.api.addCheckIn(d.id, this.checkInNote).subscribe({
      next: (r) => { this.busy.set(false); this.checkInNote = ''; this.detail.set(r); this.load(); },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not add the check-in'); },
    });
  }
  applyAction() {
    const d = this.detail();
    if (!d || !this.closeAction) return;
    if (this.closeAction === 'EXTEND' && !this.extendDate) { this.toast.error('Choose the new end date'); return; }
    if ((this.closeAction === 'COMPLETED' || this.closeAction === 'FAILED') && !this.closeNote.trim()) { this.toast.error('Write the outcome'); return; }
    this.busy.set(true);
    this.api.updatePip(d.id, { action: this.closeAction, endDate: this.extendDate || undefined, note: this.closeNote || undefined }).subscribe({
      next: (r) => { this.busy.set(false); this.closeAction = ''; this.closeNote = ''; this.extendDate = ''; this.detail.set(r); this.load(); this.toast.success('PIP updated'); },
      error: (e) => { this.busy.set(false); this.toast.error(e.error?.message || 'Could not update the PIP'); },
    });
  }
  acknowledge() {
    const d = this.detail();
    if (!d) return;
    this.api.acknowledge(d.id).subscribe({
      next: (r) => { this.detail.set(r); this.load(); this.toast.success('Acknowledged'); },
      error: (e) => this.toast.error(e.error?.message || 'Could not acknowledge'),
    });
  }
}
