import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideMoreHorizontal, LucideEdit2, LucideTrash2, LucideUser } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface ActionCellParams extends ICellRendererParams {
  onEdit?: (data: any) => void;
  editLabel?: string;
  onDelete?: (data: any) => void;
  deleteLabel?: string | ((data: any) => string);
  onViewProfile?: (data: any) => void;
  onView?: (data: any) => void;
  viewLabel?: string;
  onViewLabel?: string;
  onMarkPaid?: (data: any) => void;
  onFinalize?: (data: any) => void;
  onResendVerification?: (data: any) => void;
}

@Component({
  selector: 'app-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, MatMenuModule],
  template: `
    <div class="action-container" *ngIf="!params.data?.isSummaryRow" (click)="$event.stopPropagation()">
      <button class="btn-icon" [matMenuTriggerFor]="menu">
        <svg lucideMoreHorizontal size="16"></svg>
      </button>

      <mat-menu #menu="matMenu" panelClass="custom-action-menu">
        <button mat-menu-item class="menu-item" (click)="view()" *ngIf="params.onView">
          <span class="menu-text">{{ params.viewLabel || 'View / Print Payslip' }}</span>
        </button>
        <button mat-menu-item class="menu-item" (click)="viewProfile()" *ngIf="params.onViewProfile">
          <span class="menu-text">View Profile</span>
        </button>
        <button mat-menu-item class="menu-item" (click)="edit()" *ngIf="params.onEdit">
          <span class="menu-text">{{ params.editLabel || 'Edit' }}</span>
        </button>
        <button mat-menu-item class="menu-item" (click)="finalize()" *ngIf="params.onFinalize">
          <span class="menu-text">Finalize Payslip</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="markPaid()" *ngIf="params.onMarkPaid">
          <span class="menu-text">Mark as Paid</span>
        </button>
        <button mat-menu-item class="menu-item" (click)="resendVerification()" *ngIf="params.onResendVerification && params.data?.user?.status === 'PENDING_VERIFICATION'">
          <span class="menu-text text-primary">Resend Verification</span>
        </button>
        <button mat-menu-item class="menu-item" [ngClass]="{'text-danger': getDeleteLabel() === 'Deactivate' || getDeleteLabel() === 'Delete', 'text-success': getDeleteLabel() === 'Activate'}" (click)="delete()" *ngIf="params.onDelete">
          <span class="menu-text">{{ getDeleteLabel() }}</span>
        </button>
      </mat-menu>
    </div>
  `,
  styles: [`
    .action-container {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      height: 100%;
    }
    .btn-icon {
      background: none;
      border: none;
      padding: 8px;
      cursor: pointer;
      color: #64748b;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
    }
    .btn-icon:hover {
      background: #f1f5f9;
      color: #334155;
    }
    .menu-item {
      display: flex;
      align-items: center;
      font-size: 13px !important;
      font-weight: 600 !important;
      font-family: 'Plus Jakarta Sans', sans-serif !important;
      height: 34px !important;
      min-height: 34px !important;
      padding: 0 14px !important;
      color: #334155;
    }
    .text-success {
      color: #10b981 !important;
    }
    .text-success:hover {
      background: #ecfdf5 !important;
    }
    .text-danger {
      color: #ef4444 !important;
    }
    .text-danger:hover {
      background: #fee2e2 !important;
    }
  `]
})
export class ActionCellRendererComponent implements ICellRendererAngularComp {
  public params!: ActionCellParams;

  agInit(params: ActionCellParams): void {
    this.params = params;
  }

  refresh(params: ActionCellParams): boolean {
    this.params = params;
    return true;
  }

  view() {
    if (this.params.onView) {
      this.params.onView(this.params.data);
    }
  }

  edit() {
    if (this.params.onEdit) {
      this.params.onEdit(this.params.data);
    }
  }

  finalize() {
    if (this.params.onFinalize) {
      this.params.onFinalize(this.params.data);
    }
  }

  markPaid() {
    if (this.params.onMarkPaid) {
      this.params.onMarkPaid(this.params.data);
    }
  }

  delete() {
    if (this.params.onDelete) {
      this.params.onDelete(this.params.data);
    }
  }

  getDeleteLabel(): string {
    if (typeof this.params.deleteLabel === 'function') {
      return this.params.deleteLabel(this.params.data);
    }
    return this.params.deleteLabel || 'Delete';
  }

  viewProfile() {
    if (this.params.onViewProfile) {
      this.params.onViewProfile(this.params.data);
    }
  }

  resendVerification() {
    if (this.params.onResendVerification) {
      this.params.onResendVerification(this.params.data);
    }
  }
}
