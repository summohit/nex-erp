import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideMoreHorizontal } from '@lucide/angular';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';

export interface ProjectActionCellParams extends ICellRendererParams {
  showActions: () => boolean;
  onEdit: (data: any) => void;
  onArchive: (data: any) => void;
}

@Component({
  selector: 'app-project-action-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideMoreHorizontal, MatMenuModule],
  template: `
    <div class="action-container" (click)="$event.stopPropagation()" *ngIf="params.showActions()">
      <button class="btn-icon" [matMenuTriggerFor]="menu" title="Actions">
        <svg lucideMoreHorizontal size="16"></svg>
      </button>

      <mat-menu #menu="matMenu" panelClass="custom-action-menu">
        <button mat-menu-item class="menu-item" (click)="edit()">
          <span class="menu-text">Edit board</span>
        </button>
        <button mat-menu-item class="menu-item text-danger" (click)="archive()">
          <span class="menu-text">Archive board</span>
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
    .text-danger { color: #DC2626 !important; font-weight: 600; }
  `]
})
export class ProjectActionCellRendererComponent implements ICellRendererAngularComp {
  params!: ProjectActionCellParams;

  agInit(params: ProjectActionCellParams): void {
    this.params = params;
  }

  refresh(params: ProjectActionCellParams): boolean {
    this.params = params;
    return true;
  }

  edit() { this.params.onEdit(this.params.data); }
  archive() { this.params.onArchive(this.params.data); }
}
