import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface ExpenseStatusCellParams extends ICellRendererParams {
  canEdit?: boolean;
  onStatusChange?: (data: any, newStatus: string) => void;
  onReject?: (data: any) => void;
  onMarkPaid?: (data: any) => void;
}

@Component({
  selector: 'app-expense-status-cell-renderer',
  standalone: true,
  imports: [CommonModule, MatMenuModule],
  template: `
    <div class="status-cell-container" *ngIf="!params.data?.isSummaryRow" (click)="$event.stopPropagation()">
      <!-- Interactive status button for admins -->
      <button 
        *ngIf="canEdit; else staticBadge" 
        type="button" 
        class="status-round status-interactive" 
        [ngClass]="statusClass"
        [matMenuTriggerFor]="statusMenu"
        title="Click to change status">
        <span class="status-dot"></span>
        <span class="status-text">{{ currentStatus }}</span>
        <svg class="chevron-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      </button>

      <!-- Static badge for non-editable rows -->
      <ng-template #staticBadge>
        <span class="status-round" [ngClass]="statusClass">
          <span class="status-dot"></span>
          <span class="status-text">{{ currentStatus }}</span>
        </span>
      </ng-template>

      <!-- Rejection reason note if rejected -->
      <div *ngIf="currentStatus === 'REJECTED' && params.data?.rejectionReason" class="status-reason-sub" [title]="params.data.rejectionReason">
        Reason: {{ params.data.rejectionReason }}
      </div>

      <!-- Styled Status Material Menu -->
      <mat-menu #statusMenu="matMenu" class="custom-status-menu" panelClass="expense-status-menu-panel">
        <div class="menu-header-label">Update Claim Status</div>

        <button mat-menu-item class="status-menu-item" (click)="setStatus('PENDING')" [class.active-item]="currentStatus === 'PENDING'">
          <span class="menu-status-dot dot-pending"></span>
          <span class="menu-item-name">Pending Review</span>
          <span class="check-mark" *ngIf="currentStatus === 'PENDING'">✓</span>
        </button>

        <button mat-menu-item class="status-menu-item" (click)="setStatus('APPROVED')" [class.active-item]="currentStatus === 'APPROVED'">
          <span class="menu-status-dot dot-approved"></span>
          <span class="menu-item-name">Approved</span>
          <span class="check-mark" *ngIf="currentStatus === 'APPROVED'">✓</span>
        </button>

        <button mat-menu-item class="status-menu-item" (click)="rejectClaim()" [class.active-item]="currentStatus === 'REJECTED'">
          <span class="menu-status-dot dot-rejected"></span>
          <span class="menu-item-name">Reject Claim...</span>
          <span class="check-mark" *ngIf="currentStatus === 'REJECTED'">✓</span>
        </button>

        <button mat-menu-item class="status-menu-item" (click)="markPaid()" [class.active-item]="currentStatus === 'PAID'">
          <span class="menu-status-dot dot-paid"></span>
          <span class="menu-item-name">Mark as Paid</span>
          <span class="check-mark" *ngIf="currentStatus === 'PAID'">✓</span>
        </button>
      </mat-menu>
    </div>
  `,
  styles: [`
    .status-cell-container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      height: 100%;
      user-select: none;
    }
    .status-interactive {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      border: 1px solid transparent;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.03em;
      transition: all 0.15s ease-in-out;
      outline: none;
      background: inherit;
    }
    .status-interactive:hover {
      filter: brightness(0.95);
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      transform: translateY(-1px);
    }
    .chevron-icon {
      margin-left: 2px;
      opacity: 0.7;
      transition: transform 0.15s ease;
    }
    .status-interactive:hover .chevron-icon {
      opacity: 1;
    }
    .status-reason-sub {
      font-size: 10px;
      color: #DC2626;
      font-weight: 500;
      line-height: 1.2;
      margin-top: 3px;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .menu-header-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94A3B8;
      padding: 8px 16px 4px 16px;
    }
    .status-menu-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 500;
      padding: 8px 16px;
      min-height: 38px;
    }
    .menu-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .dot-pending { background-color: #F59E0B; }
    .dot-approved { background-color: #10B981; }
    .dot-rejected { background-color: #EF4444; }
    .dot-paid { background-color: #8B5CF6; }
    .menu-item-name {
      flex: 1;
    }
    .check-mark {
      font-size: 13px;
      font-weight: 700;
      color: #10B981;
      margin-left: auto;
    }
    .active-item {
      background-color: #F8FAFC;
      font-weight: 600;
    }
  `]
})
export class ExpenseStatusCellRendererComponent implements ICellRendererAngularComp {
  params!: ExpenseStatusCellParams;
  currentStatus: string = 'PENDING';
  statusClass: string = 'status-pending';
  canEdit: boolean = false;

  agInit(params: ExpenseStatusCellParams): void {
    this.params = params;
    this.updateState();
  }

  refresh(params: ExpenseStatusCellParams): boolean {
    this.params = params;
    this.updateState();
    return true;
  }

  private updateState() {
    this.currentStatus = this.params.value || this.params.data?.status || 'PENDING';
    this.canEdit = !!this.params.canEdit && !this.params.data?.isSummaryRow;

    if (this.currentStatus === 'APPROVED') {
      this.statusClass = 'status-approved';
    } else if (this.currentStatus === 'REJECTED') {
      this.statusClass = 'status-rejected';
    } else if (this.currentStatus === 'PAID') {
      this.statusClass = 'status-paid';
    } else {
      this.statusClass = 'status-pending';
    }
  }

  setStatus(status: string) {
    if (this.currentStatus === status) return;
    if (this.params.onStatusChange && this.params.data) {
      this.params.onStatusChange(this.params.data, status);
    }
  }

  rejectClaim() {
    if (this.params.onReject && this.params.data) {
      this.params.onReject(this.params.data);
    }
  }

  markPaid() {
    if (this.params.onMarkPaid && this.params.data) {
      this.params.onMarkPaid(this.params.data);
    }
  }
}
