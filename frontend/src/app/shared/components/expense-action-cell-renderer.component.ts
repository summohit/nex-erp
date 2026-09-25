import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideMoreHorizontal } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface ExpenseActionCellParams extends ICellRendererParams {
  onApprove?: (data: any) => void;
  onReject?: (data: any) => void;
  onDelete?: (data: any) => void;
  onMarkPaid?: (data: any) => void;
  onViewDetail?: (data: any) => void;
}

@Component({
  selector: 'app-expense-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, MatMenuModule],
  template: `
    <div class="action-container" *ngIf="!params.data?.isSummaryRow" (click)="$event.stopPropagation()">
      <button class="btn-icon" [matMenuTriggerFor]="menu" title="Actions">
        <svg lucideMoreHorizontal size="16"></svg>
      </button>

      <mat-menu #menu="matMenu" panelClass="custom-action-menu">
        <button mat-menu-item class="menu-item" (click)="viewDetail()" *ngIf="params.onViewDetail">
          <span class="menu-text">View Details</span>
        </button>
        <button mat-menu-item class="menu-item" (click)="viewReceipt()" *ngIf="params.data?.receiptUrl">
          <span class="menu-text">View Receipt</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="approve()" *ngIf="params.onApprove && params.data?.status === 'PENDING'">
          <span class="menu-text">Approve</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="reject()" *ngIf="params.onReject && params.data?.status === 'PENDING'">
          <span class="menu-text">Reject</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="markPaid()" *ngIf="params.onMarkPaid && params.data?.status === 'APPROVED'">
          <span class="menu-text">Mark Paid</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="deleteClaim()" *ngIf="params.onDelete && params.data?.status === 'PENDING'">
          <span class="menu-text">Cancel Claim</span>
        </button>
      </mat-menu>
    </div>
  `,
  styles: [`
    .action-container {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100%;
    }
    .btn-icon {
      background: none;
      border: none;
      padding: 8px;
      cursor: pointer;
      color: #64748B;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .btn-icon:hover {
      background: #F1F5F9;
      color: #0F172A;
    }
    .menu-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      height: auto;
      line-height: 1.5;
    }
    .menu-text {
      font-size: 14px;
      font-weight: 500;
    }
    .text-success { color: #10B981 !important; }
    .text-danger { color: #1373e5 !important; }

    .resolved-dash {
      color: #CBD5E1;
      font-size: 18px;
      font-weight: 600;
      cursor: default;
      user-select: none;
    }
  `]
})
export class ExpenseActionCellRendererComponent implements ICellRendererAngularComp {
  params!: ExpenseActionCellParams;

  agInit(params: ExpenseActionCellParams): void {
    this.params = params;
  }

  refresh(params: ExpenseActionCellParams): boolean {
    this.params = params;
    return true;
  }

  approve() {
    if (this.params.onApprove && this.params.data) {
      this.params.onApprove(this.params.data);
    }
  }

  reject() {
    if (this.params.onReject && this.params.data) {
      this.params.onReject(this.params.data);
    }
  }

  markPaid() {
    if (this.params.onMarkPaid && this.params.data) {
      this.params.onMarkPaid(this.params.data);
    }
  }

  deleteClaim() {
    if (this.params.onDelete && this.params.data) {
      this.params.onDelete(this.params.data);
    }
  }

  viewReceipt() {
    if (this.params.data?.receiptUrl) {
      window.open(this.params.data.receiptUrl, '_blank');
    }
  }

  viewDetail() {
    if (this.params.onViewDetail && this.params.data) {
      this.params.onViewDetail(this.params.data);
    }
  }
}
