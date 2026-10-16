import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { EmployeeService, ProfileCompleteness, ProfileMissingItem } from '../../../services/employee.service';

/** How often the reminder comes back while anything is missing (HR, 16 Oct 2026). */
const REMIND_EVERY_MS = 15 * 60 * 1000;

/**
 * HR's profile-completion reminder.
 *
 * Shown when MIRA opens and again every 15 minutes, on whatever page the
 * person is on, until every required document and detail is on file; then
 * never again. "Remind me later" closes it until the next 15 minutes.
 * Documents upload straight from here, each under its own type; personal
 * details and the emergency contact link to the profile. The exempt
 * accounts and complete profiles never see it (the server decides).
 */
@Component({
  selector: 'app-profile-reminder',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-reminder.html',
  styleUrl: './profile-reminder.css',
})
export class ProfileReminderComponent implements OnInit, OnDestroy {
  private employees = inject(EmployeeService);
  private router = inject(Router);
  private toast = inject(HotToastService);

  status = signal<ProfileCompleteness | null>(null);
  open = signal(false);
  uploading = signal<string | null>(null);
  savingFirstJob = signal(false);
  retyping = signal<number | null>(null);
  private timer: any = null;

  ngOnInit() {
    this.check(true);
    this.timer = setInterval(() => this.check(true), REMIND_EVERY_MS);
  }

  ngOnDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Ask the server; open the reminder when something is still missing. */
  check(show: boolean) {
    this.employees.getMyProfileCompleteness().subscribe({
      next: (s) => {
        this.status.set(s);
        if (!s || s.exempt || s.complete) {
          this.open.set(false);
          if (s && (s.exempt || s.complete) && this.timer) { clearInterval(this.timer); this.timer = null; }
          return;
        }
        if (show) this.open.set(true);
      },
      error: () => undefined,
    });
  }

  later() {
    this.open.set(false);
  }

  documents(): ProfileMissingItem[] {
    return (this.status()?.missing ?? []).filter((m) => m.kind === 'document');
  }

  details(): ProfileMissingItem[] {
    return (this.status()?.missing ?? []).filter((m) => m.kind === 'details');
  }

  /** Previous-employment items are the ones "first job" removes. */
  asksPreviousEmployment(): boolean {
    return this.documents().some((m) => ['UAN', 'Relieving / Experience Letter', 'Payslips'].includes(m.key));
  }

  onFile(item: ProfileMissingItem, event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const s = this.status();
    if (!file || !s) return;
    if (file.size > 10 * 1024 * 1024) {
      this.toast.error('That file is over 10 MB. Please upload a smaller one.');
      input.value = '';
      return;
    }
    this.uploading.set(item.key);
    this.employees.uploadDocument(file).subscribe({
      next: (up) => {
        this.employees.addDocument(s.employeeId, { fileName: file.name, fileUrl: up.url, documentType: item.key }).subscribe({
          next: () => {
            this.uploading.set(null);
            this.toast.success(`${item.label} uploaded`);
            this.check(true);
          },
          error: (e) => { this.uploading.set(null); this.toast.error(e?.error?.message || 'Could not save the document'); },
        });
      },
      error: (e) => { this.uploading.set(null); this.toast.error(e?.error?.message || 'Upload failed'); },
    });
    input.value = '';
  }

  /** File an "Other" upload under its proper type — no re-upload needed. */
  retype(documentId: number, documentType: string) {
    const s = this.status();
    if (!s || !documentType) return;
    this.retyping.set(documentId);
    this.employees.updateDocumentType(s.employeeId, documentId, documentType).subscribe({
      next: () => {
        this.retyping.set(null);
        this.toast.success(`Saved as ${documentType}. Picked the wrong one? Change it on your profile's Documents tab.`, { duration: 6000 });
        this.check(true);
      },
      error: (e) => { this.retyping.set(null); this.toast.error(e?.error?.message || 'Could not change the type'); },
    });
  }

  setFirstJob(value: boolean) {
    this.savingFirstJob.set(true);
    this.employees.setMyFirstJob(value).subscribe({
      next: (s) => { this.savingFirstJob.set(false); this.status.set(s); if (s?.complete) this.open.set(false); },
      error: () => { this.savingFirstJob.set(false); this.toast.error('Could not save'); },
    });
  }

  goToProfile() {
    const id = this.status()?.employeeId;
    this.open.set(false);
    if (id) this.router.navigate(['/employees', id, 'profile']);
  }
}
