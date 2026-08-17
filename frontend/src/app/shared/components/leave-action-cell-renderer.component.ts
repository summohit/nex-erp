import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideMoreHorizontal, LucideEdit2, LucideCheckCircle, LucideXCircle, LucideX, LucidePaperclip, LucideInfo } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface LeaveActionCellParams extends ICellRendererParams {
  onEdit?: (data: any) => void;
  onCancel?: (data: any) => void;
  onApprove?: (data: any) => void;
  onReject?: (data: any) => void;
  onViewAttachment?: (data: any) => void;
  onViewReason?: (data: any) => void;
}

@Component({
  selector: 'app-leave-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, LucideEdit2, LucideCheckCircle, LucideXCircle, LucideX, LucidePaperclip, LucideInfo, MatMenuModule],
  template: `
    <div class="action-container" (click)="$event.stopPropagation()">
      <button class="btn-icon" [matMenuTriggerFor]="menu" *ngIf="hasMenuItems()">
        <svg lucideMoreHorizontal size="16"></svg>
      </button>

      <mat-menu #menu="matMenu" panelClass="custom-action-menu">
        <button mat-menu-item class="menu-item" (click)="viewReason()" *ngIf="params.data.status === 'REJECTED' && params.data.rejectionReason">
          <svg lucideInfo size="18" class="menu-icon"></svg>
          <span class="menu-text">View Reason</span>
        </button>
        <button mat-menu-item class="menu-item" (click)="viewAttachment()" *ngIf="params.onViewAttachment && params.data.attachmentUrl">
          <svg lucidePaperclip size="18" class="menu-icon"></svg>
          <span class="menu-text">View Attachment</span>
        </button>
        <button mat-menu-item class="menu-item" (click)="edit()" *ngIf="params.onEdit && params.data.status === 'PENDING'">
          <svg lucideEdit2 size="18" class="menu-icon"></svg>
          <span class="menu-text">Edit</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="cancel()" *ngIf="params.onCancel && !isPastStartDate(params.data.startDate) && params.data.status !== 'CANCELLED' && params.data.status !== 'REJECTED'">
          <svg lucideX size="18" class="menu-icon"></svg>
          <span class="menu-text">Cancel Request</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="approve()" *ngIf="params.onApprove && params.data.status === 'PENDING'">
          <svg lucideCheckCircle size="18" class="menu-icon"></svg>
          <span class="menu-text">Approve</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="reject()" *ngIf="params.onReject && params.data.status === 'PENDING'">
          <svg lucideXCircle size="18" class="menu-icon"></svg>
          <span class="menu-text">Reject</span>
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
    .btn-icon:hover:not(.disabled-btn) {
      background: #f1f5f9;
      color: #334155;
    }
    .disabled-btn {
      opacity: 0.3;
      cursor: not-allowed;
    }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px !important;
      font-family: 'Plus Jakarta Sans', sans-serif !important;
      height: 40px !important;
      min-height: 40px !important;
    }
    .text-danger {
      color: #ef4444 !important;
    }
    .text-danger:hover {
      background: #fee2e2 !important;
    }
    .text-success {
      color: #10b981 !important;
    }
    .text-success:hover {
      background: #d1fae5 !important;
    }
  `]
})
export class LeaveActionCellRendererComponent implements ICellRendererAngularComp {
  public params!: LeaveActionCellParams;

  agInit(params: LeaveActionCellParams): void {
    this.params = params;
  }

  refresh(params: LeaveActionCellParams): boolean {
    this.params = params;
    return true;
  }

  edit() {
    if (this.params.onEdit) {
      this.params.onEdit(this.params.data);
    }
  }

  cancel() {
    if (this.params.onCancel) {
      this.params.onCancel(this.params.data);
    }
  }

  approve() {
    if (this.params.onApprove) {
      this.params.onApprove(this.params.data);
    }
  }

  reject() {
    if (this.params.onReject) {
      this.params.onReject(this.params.data);
    }
  }

  isPastStartDate(startDateStr: string): boolean {
    if (!startDateStr) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(startDateStr);
    start.setHours(0, 0, 0, 0);
    return today.getTime() >= start.getTime();
  }

  viewAttachment() {
    if (this.params.onViewAttachment) {
      this.params.onViewAttachment(this.params.data);
    }
  }

  viewReason() {
    if (this.params.onViewReason && this.params.data.rejectionReason) {
      this.params.onViewReason(this.params.data);
    }
  }

  hasMenuItems(): boolean {
    const d = this.params.data;
    if (d.status === 'REJECTED' && d.rejectionReason) return true;
    if (this.params.onViewAttachment && d.attachmentUrl) return true;
    if (this.params.onEdit && d.status === 'PENDING') return true;
    if (this.params.onCancel && !this.isPastStartDate(d.startDate) && d.status !== 'CANCELLED' && d.status !== 'REJECTED') return true;
    if (this.params.onApprove && d.status === 'PENDING') return true;
    if (this.params.onReject && d.status === 'PENDING') return true;
    return false;
  }
}
