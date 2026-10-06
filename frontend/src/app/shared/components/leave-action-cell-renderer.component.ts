import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideMoreHorizontal, LucideEdit2, LucideCheckCircle, LucideXCircle, LucideX, LucidePaperclip, LucideInfo, LucideEye, LucideTrash2 } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface LeaveActionCellParams extends ICellRendererParams {
  onView?: (data: any) => void;
  onEdit?: (data: any) => void;
  onCancel?: (data: any) => void;
  onApprove?: (data: any) => void;
  onReject?: (data: any) => void;
  onViewAttachment?: (data: any) => void;
  onViewReason?: (data: any) => void;
  canEdit?: (data: any) => boolean;
  canCancel?: (data: any) => boolean;
  canApprove?: (data: any) => boolean;
  canReject?: (data: any) => boolean;
  /**
   * §Att10: remove the request outright. Passed only by screens whose viewer
   * is a Super Admin, so its presence is the permission — the menu never has
   * to ask who is looking.
   */
  onDelete?: (data: any) => void;
}

@Component({
  selector: 'app-leave-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, LucideEdit2, LucideCheckCircle, LucideXCircle, LucideX, LucidePaperclip, LucideInfo, LucideEye, LucideTrash2, MatMenuModule],
  template: `
    <div class="action-container" (click)="$event.stopPropagation()">
      <button class="btn-view" (click)="view()" *ngIf="params.onView" title="View full details">
        <svg lucideEye size="14"></svg>
        <span>View</span>
      </button>

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
        <button mat-menu-item class="menu-item" (click)="edit()" *ngIf="params.onEdit && params.data.status === 'PENDING' && isAllowed(params.canEdit)">
          <svg lucideEdit2 size="18" class="menu-icon"></svg>
          <span class="menu-text">Edit</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="cancel()" *ngIf="params.onCancel && !isPastStartDate(params.data.startDate) && params.data.status !== 'CANCELLED' && params.data.status !== 'REJECTED' && isAllowed(params.canCancel)">
          <svg lucideX size="18" class="menu-icon"></svg>
          <span class="menu-text">Cancel Request</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="approve()" *ngIf="params.onApprove && params.data.status === 'PENDING' && isAllowed(params.canApprove)">
          <svg lucideCheckCircle size="18" class="menu-icon"></svg>
          <span class="menu-text">Approve</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="reject()" *ngIf="params.onReject && params.data.status === 'PENDING' && isAllowed(params.canReject)">
          <svg lucideXCircle size="18" class="menu-icon"></svg>
          <span class="menu-text">Reject</span>
        </button>
        <!-- §Att10. Last, and set apart: cancelling leaves a record that says
             cancelled, whereas this makes the request disappear. Sitting next
             to Cancel with the same weight would invite the wrong one. -->
        <button mat-menu-item class="menu-item menu-destructive" (click)="remove()" *ngIf="params.onDelete">
          <svg lucideTrash2 size="18" class="menu-icon"></svg>
          <span class="menu-text">Delete request</span>
        </button>
      </mat-menu>
    </div>
  `,
  styles: [`
    .action-container {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 4px;
      height: 100%;
    }
    .btn-view {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 600;
      font-family: 'Plus Jakarta Sans', sans-serif;
      color: #2563EB;
      background: rgba(37, 99, 235, 0.08);
      border: 1px solid rgba(37, 99, 235, 0.2);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-view:hover {
      background: rgba(37, 99, 235, 0.16);
      border-color: rgba(37, 99, 235, 0.4);
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
      color: #1373e5 !important;
    }
    .text-danger:hover {
      background: #dbeafe !important;
    }
    .text-success {
      color: #10b981 !important;
    }
    .text-success:hover {
      background: #d1fae5 !important;
    }
    /* Deletion is the only irreversible thing in this menu, and the only red. */
    .menu-destructive {
      color: #dc2626 !important;
      border-top: 1px solid #f1f5f9;
    }
    .menu-destructive:hover {
      background: #fef2f2 !important;
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

  remove() {
    if (this.params.onDelete) {
      this.params.onDelete(this.params.data);
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
    if (this.params.onEdit && d.status === 'PENDING' && this.isAllowed(this.params.canEdit)) return true;
    if (this.params.onCancel && !this.isPastStartDate(d.startDate) && d.status !== 'CANCELLED' && d.status !== 'REJECTED' && this.isAllowed(this.params.canCancel)) return true;
    if (this.params.onApprove && d.status === 'PENDING' && this.isAllowed(this.params.canApprove)) return true;
    if (this.params.onReject && d.status === 'PENDING' && this.isAllowed(this.params.canReject)) return true;
    if (this.params.onDelete) return true;
    return false;
  }

  isAllowed(predicate?: (data: any) => boolean): boolean {
    return !predicate || predicate(this.params.data);
  }
}
