import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LucideX, LucideExternalLink } from '@lucide/angular';
import { EmployeeProfileComponent } from '../../employees/employee-profile/employee-profile';
import { ProfileModalService } from './profile-modal.service';

@Component({
  selector: 'app-profile-modal',
  standalone: true,
  imports: [CommonModule, EmployeeProfileComponent, LucideX, LucideExternalLink],
  template: `
    <div class="pm-overlay" *ngIf="modal.employeeId() as id" (click)="modal.close()">
      <div class="pm-dialog" (click)="$event.stopPropagation()" role="dialog" aria-label="Employee profile">
        <div class="pm-head">
          <span class="pm-title">Employee profile</span>
          <button type="button" class="pm-btn" (click)="openPage(id)" title="Open as a page"><svg lucideExternalLink size="16"></svg></button>
          <button type="button" class="pm-btn" (click)="modal.close()" title="Close"><svg lucideX size="18"></svg></button>
        </div>
        <div class="pm-body">
          <!-- Loaded on first open, so the profile screens stay out of the main bundle. -->
          @defer {
            <app-employee-profile [employeeId]="id" [embedded]="true"></app-employee-profile>
          } @loading (minimum 150ms) {
            <div class="pm-loading">Loading profile…</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pm-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(15,23,42,.5); display: flex; align-items: center; justify-content: center; padding: 24px; }
    .pm-dialog { width: min(1100px, 100%); max-height: calc(100vh - 48px); background: #fff; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 24px 48px rgba(15,23,42,.25); }
    .pm-head { display: flex; align-items: center; gap: 6px; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; }
    .pm-title { flex: 1; font-weight: 700; color: #0f172a; font-size: 15px; }
    .pm-btn { border: 0; background: transparent; width: 34px; height: 34px; border-radius: 8px; color: #64748b; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
    .pm-btn:hover { background: #f1f5f9; color: #0f172a; }
    .pm-loading { padding: 40px; text-align: center; color: #64748b; }
    .pm-body { overflow: auto; padding: 16px 20px 24px; }
    @media (max-width: 640px) { .pm-overlay { padding: 0; } .pm-dialog { max-height: 100vh; height: 100vh; border-radius: 0; } .pm-body { padding: 12px 16px 20px; } }
  `],
})
export class ProfileModalComponent {
  modal = inject(ProfileModalService);
  private router = inject(Router);

  @HostListener('document:keydown.escape') onEsc() { this.modal.close(); }

  openPage(id: number) {
    this.modal.close();
    this.router.navigate(['/employees', id, 'profile']);
  }
}
