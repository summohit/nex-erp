import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideMoreHorizontal } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface ClientActionCellParams extends ICellRendererParams {
  onView?: (data: any) => void;
  onArchive?: (data: any) => void;
  onRestore?: (data: any) => void;
  onDelete?: (data: any) => void;
}

@Component({
  selector: 'app-client-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, MatMenuModule],
  template: `
    <div class="action-container" (click)="$event.stopPropagation()">
      <button class="btn-icon" [matMenuTriggerFor]="menu" title="Actions">
        <svg lucideMoreHorizontal size="16"></svg>
      </button>

      <mat-menu #menu="matMenu" panelClass="custom-action-menu">
        <button mat-menu-item class="menu-item" (click)="view()" *ngIf="params.onView">
          <span class="menu-text">View</span>
        </button>
        <button mat-menu-item class="menu-item text-success" (click)="restore()" *ngIf="params.onRestore && isArchived()">
          <span class="menu-text">Restore Client</span>
        </button>
        <button mat-menu-item class="menu-item text-primary" (click)="archive()" *ngIf="params.onArchive && !isArchived()">
          <span class="menu-text">Archive Client</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="deleteClient()" *ngIf="params.onDelete">
          <span class="menu-text">Delete Client</span>
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
    .text-primary { color: #FF5A1F !important; font-weight: 600; }
    .text-success { color: #059669 !important; font-weight: 600; }
    .text-danger { color: #DC2626 !important; font-weight: 600; }
  `]
})
export class ClientActionCellRendererComponent implements ICellRendererAngularComp {
  params!: ClientActionCellParams;

  agInit(params: ClientActionCellParams): void {
    this.params = params;
  }

  refresh(params: ClientActionCellParams): boolean {
    this.params = params;
    return true;
  }

  isArchived(): boolean {
    return this.params?.data?.status === 'ARCHIVED';
  }

  view() { if (this.params?.onView) this.params.onView(this.params.data); }
  archive() { if (this.params?.onArchive) this.params.onArchive(this.params.data); }
  restore() { if (this.params?.onRestore) this.params.onRestore(this.params.data); }
  deleteClient() { if (this.params?.onDelete) this.params.onDelete(this.params.data); }
}
