import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideMoreHorizontal } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface AssetActionCellParams extends ICellRendererParams {
  onViewDetails?: (data: any) => void;
  onEdit?: (data: any) => void;
  canEdit?: (data: any) => boolean;
  editLabel?: string;
  onAddStock?: (data: any) => void;
   onAssign?: (data: any) => void;
   onReturn?: (data: any) => void;
   canReturn?: (data: any) => boolean;
   returnLabel?: string;
  onApprove?: (data: any) => void;
  canApprove?: (data: any) => boolean;
  onReject?: (data: any) => void;
  canReject?: (data: any) => boolean;
  onCancel?: (data: any) => void;
  canCancel?: (data: any) => boolean;
  onDelete?: (data: any) => void;
  canDelete?: (data: any) => boolean;
  deleteLabel?: string;
}

@Component({
  selector: 'app-asset-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, MatMenuModule],
  template: `
    <div class="action-container" (click)="$event.stopPropagation()">
      <button class="btn-icon" [matMenuTriggerFor]="menu">
        <svg lucideMoreHorizontal size="16"></svg>
      </button>

      <mat-menu #menu="matMenu" panelClass="custom-action-menu">
        <button mat-menu-item class="menu-item" (click)="viewDetails()" *ngIf="params.onViewDetails">
          <span class="menu-text">View Details</span>
        </button>
        <button mat-menu-item class="menu-item text-primary" (click)="edit()" *ngIf="params.onEdit && canEdit()">
          <span class="menu-text action-edit-label">{{ params.editLabel || 'Edit' }}</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="addStock()" *ngIf="params.onAddStock">
          <span class="menu-text">Add stock</span>
        </button>
        <button mat-menu-item class="menu-item text-primary" (click)="assign()" *ngIf="params.onAssign">
          <span class="menu-text">Assign to Employee</span>
        </button>
        <button mat-menu-item class="menu-item text-primary" (click)="returnAsset()" *ngIf="params.onReturn && canReturn()">
          <span class="menu-text">{{ params.returnLabel || 'Return Asset' }}</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="approve()" *ngIf="params.onApprove && canApprove()">
          <span class="menu-text">Approve & Fulfill</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="reject()" *ngIf="params.onReject && canReject()">
          <span class="menu-text">Reject Request</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="cancelRequest()" *ngIf="params.onCancel && canCancel()">
          <span class="menu-text">Cancel Request</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="deleteAsset()" *ngIf="params.onDelete && canDelete()">
          <span class="menu-text action-delete-label">{{ params.deleteLabel || 'Delete Asset' }}</span>
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
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 8px;
      color: #64748B;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }
    .btn-icon:hover {
      background: #F8FAFC;
      color: #0F172A;
      border-color: #CBD5E1;
    }
    .text-primary { color: #2563EB !important; font-weight: 600; }
    .text-success { color: #059669 !important; font-weight: 600; }
    .text-danger { color: #DC2626 !important; font-weight: 600; }
    .menu-item .action-edit-label { color: #2563EB !important; font-weight: 600; }
    .menu-item .action-delete-label { color: #DC2626 !important; font-weight: 600; }
  `]
})
export class AssetActionCellRendererComponent implements ICellRendererAngularComp {
  params!: AssetActionCellParams;

  agInit(params: AssetActionCellParams): void {
    this.params = params;
  }

  refresh(params: AssetActionCellParams): boolean {
    this.params = params;
    return true;
  }

  canEdit(): boolean {
    if (!this.params?.canEdit) return true;
    return this.params.canEdit(this.params.data);
  }

  canApprove(): boolean {
    if (!this.params?.canApprove) return true;
    return this.params.canApprove(this.params.data);
  }

  canReject(): boolean {
    if (!this.params?.canReject) return true;
    return this.params.canReject(this.params.data);
  }

  canCancel(): boolean {
    if (!this.params?.canCancel) return true;
    return this.params.canCancel(this.params.data);
  }

  canDelete(): boolean {
    if (!this.params?.canDelete) return true;
    return this.params.canDelete(this.params.data);
  }

  canReturn(): boolean {
    if (!this.params?.canReturn) return true;
    return this.params.canReturn(this.params.data);
  }

  viewDetails() { if (this.params?.onViewDetails) this.params.onViewDetails(this.params.data); }
  edit() { if (this.params?.onEdit) this.params.onEdit(this.params.data); }
  addStock() { if (this.params?.onAddStock) this.params.onAddStock(this.params.data); }
  assign() { if (this.params?.onAssign) this.params.onAssign(this.params.data); }
  returnAsset() { if (this.params?.onReturn) this.params.onReturn(this.params.data); }
  approve() { if (this.params?.onApprove) this.params.onApprove(this.params.data); }
  reject() { if (this.params?.onReject) this.params.onReject(this.params.data); }
  cancelRequest() { if (this.params?.onCancel) this.params.onCancel(this.params.data); }
  deleteAsset() { if (this.params?.onDelete) this.params.onDelete(this.params.data); }
}
