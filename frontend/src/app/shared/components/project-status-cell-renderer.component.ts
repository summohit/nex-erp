import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';

type ProjectStage = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'AT_RISK' | 'COMPLETED' | 'CLOSED' | 'CANCELLED';

export interface ProjectStatusCellParams extends ICellRendererParams {
  canChange: () => boolean;
  onStatusChange: (project: any, stage: ProjectStage) => void;
}

@Component({
  selector: 'app-project-status-cell-renderer',
  standalone: true,
  imports: [CommonModule, MatMenuModule],
  template: `
    <div class="project-status-cell" (click)="$event.stopPropagation()">
      <div class="project-progress-track">
        <span [style.width.%]="progress" *ngIf="progress > 0">{{ progress }}%</span>
      </div>
      <button type="button" class="project-stage-trigger" [disabled]="!params.canChange()" [matMenuTriggerFor]="stageMenu">
        <i [style.background]="stage.color"></i>
        <span>{{ stage.label }}</span>
        <b>▾</b>
      </button>
      <mat-menu #stageMenu="matMenu" class="project-stage-menu">
        <button mat-menu-item *ngFor="let option of stages" (click)="changeStage(option.value)">
          <i [style.background]="option.color"></i>
          <span>{{ option.label }}</span>
        </button>
      </mat-menu>
    </div>
  `,
  styles: [`
    .project-status-cell { display:flex; flex-direction:column; justify-content:center; gap:9px; height:100%; }
    .project-progress-track { height:19px; overflow:hidden; border-radius:5px; background:#e7ebf0; }
    .project-progress-track span { display:flex; align-items:center; justify-content:center; min-width:0; height:100%; color:#fff; background:#e00000; font-size:11px; font-weight:700; line-height:1; }
    .project-stage-trigger { display:flex; align-items:center; gap:10px; min-height:34px; width:100%; padding:4px 10px; border:1px solid #dce3ed; border-radius:5px; background:#fff; color:#172033; font:600 12px inherit; text-align:left; cursor:pointer; }
    .project-stage-trigger:hover:not(:disabled) { border-color:#aebbd0; background:#f8fafc; }
    .project-stage-trigger:disabled { cursor:default; opacity:.82; }
    .project-stage-trigger i, .project-stage-menu i { width:11px; height:11px; flex:0 0 11px; border-radius:50%; }
    .project-stage-trigger b { margin-left:auto; color:#1f2937; font-size:15px; font-weight:600; }
    :host ::ng-deep .project-stage-menu .mat-mdc-menu-content { padding:0; min-width:190px; }
    :host ::ng-deep .project-stage-menu .mat-mdc-menu-item { display:flex; align-items:center; gap:14px; min-height:44px; font-size:14px; }
  `]
})
export class ProjectStatusCellRendererComponent implements ICellRendererAngularComp {
  params!: ProjectStatusCellParams;
  progress = 0;
  stage = { value: 'DRAFT' as ProjectStage, label: 'Not Started', color: '#64748b' };

  readonly stages: { value: ProjectStage; label: string; color: string }[] = [
    { value: 'ACTIVE', label: 'In Progress', color: '#0ea5e9' },
    { value: 'DRAFT', label: 'Not Started', color: '#64748b' },
    { value: 'ON_HOLD', label: 'On Hold', color: '#f7b500' },
    { value: 'AT_RISK', label: 'At Risk', color: '#f97316' },
    { value: 'CANCELLED', label: 'Cancelled', color: '#dc2626' },
    { value: 'COMPLETED', label: 'Finished', color: '#65a30d' },
    { value: 'CLOSED', label: 'Closed', color: '#4338ca' },
  ];

  agInit(params: ProjectStatusCellParams): void {
    this.refresh(params);
  }

  refresh(params: ProjectStatusCellParams): boolean {
    this.params = params;
    this.progress = Math.max(0, Math.min(100, Math.round(Number(params.data?.progress ?? 0))));
    this.stage = this.stages.find((item) => item.value === (params.data?.workStatus || 'DRAFT')) || this.stages[1];
    return true;
  }

  changeStage(stage: ProjectStage): void {
    if (stage !== this.stage.value && this.params.canChange()) {
      this.params.onStatusChange(this.params.data, stage);
    }
  }
}
