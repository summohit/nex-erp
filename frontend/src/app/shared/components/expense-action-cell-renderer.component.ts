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
}

@Component({
  selector: 'app-expense-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, MatMenuModule],
  template: `
    <div class="action-container" *ngIf="!params.data?.isSummaryRow" (click)="$event.stopPropagation()">

      <!-- Resolved: show a dash -->
      <span class="resolved-dash" *ngIf="params.data?.status !== 'PENDING'" title="Claim already {{ params.data?.status?.toLowerCase() }}">—</span>

      <!-- Pending: show action menu -->
      <ng-container *ngIf="params.data?.status === 'PENDING'">
        <button class="btn-icon" [matMenuTriggerFor]="menu">
          <svg lucideMoreHorizontal size="16"></svg>
        </button>

        <mat-menu #menu="matMenu" panelClass="custom-action-menu">
          <button mat-menu-item class="menu-item" (click)="viewReceipt()" *ngIf="params.data?.receiptUrl">
            <span class="menu-text">View Receipt</span>
          </button>
          <button mat-menu-item class="menu-item text-success" (click)="approve()" *ngIf="params.onApprove">
            <span class="menu-text">Approve</span>
          </button>
          <button mat-menu-item class="menu-item text-danger" (click)="reject()" *ngIf="params.onReject">
            <span class="menu-text">Reject</span>
          </button>
          <button mat-menu-item class="menu-item text-danger" (click)="deleteClaim()" *ngIf="params.onDelete">
            <span class="menu-text">Cancel Claim</span>
          </button>
        </mat-menu>
      </ng-container>
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
    .text-danger { color: #EF4444 !important; }

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
}
