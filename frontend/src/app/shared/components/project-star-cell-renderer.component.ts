import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { LucideStar } from '@lucide/angular';
import { CommonModule } from '@angular/common';

export interface ProjectStarCellParams extends ICellRendererParams {
  isStarred: (data: any) => boolean;
  onToggle: (data: any) => void;
}

@Component({
  selector: 'app-project-star-cell-renderer',
  standalone: true,
  imports: [CommonModule, LucideStar],
  template: `
    <div class="star-cell" (click)="$event.stopPropagation()">
      <button type="button" class="star-cell-btn" [class.active]="starred" (click)="toggle()" title="Toggle star">
        <svg lucideStar size="16" [style.fill]="starred ? '#eab308' : 'none'" [style.stroke]="starred ? '#eab308' : '#94a3b8'"></svg>
      </button>
    </div>
  `,
  styles: [`
    .star-cell {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
    }
    .star-cell-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .star-cell-btn:hover {
      background: rgba(234, 179, 8, 0.12);
    }
  `]
})
export class ProjectStarCellRendererComponent implements ICellRendererAngularComp {
  params!: ProjectStarCellParams;
  starred = false;

  agInit(params: ProjectStarCellParams): void {
    this.params = params;
    this.starred = this.params.isStarred(this.params.data);
  }

  refresh(params: ProjectStarCellParams): boolean {
    this.params = params;
    this.starred = this.params.isStarred(this.params.data);
    return true;
  }

  toggle() {
    this.starred = !this.starred;
    this.params.onToggle(this.params.data);
  }
}
