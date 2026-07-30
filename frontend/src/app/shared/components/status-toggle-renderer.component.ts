import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { CommonModule } from '@angular/common';

export interface StatusToggleParams extends ICellRendererParams {
  onToggle: (data: any, isActive: boolean) => void;
}

@Component({
  selector: 'app-status-toggle-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toggle-container" (click)="$event.stopPropagation()">
      <label class="switch">
        <input type="checkbox" [checked]="isActive" (change)="toggleStatus($event)">
        <span class="slider round"></span>
      </label>
      <span class="status-label" [class.active]="isActive" *ngIf="showLabel">{{ isActive ? activeLabel : inactiveLabel }}</span>
    </div>
  `,
  styles: [`
    .toggle-container {
      display: flex;
      align-items: center;
      gap: 12px;
      height: 100%;
    }
    
    .status-label {
      font-size: 13px;
      font-weight: 500;
      color: #64748b;
      transition: color 0.3s;
      width: 60px;
    }
    
    .status-label.active {
      color: #10b981; /* Emerald Green */
    }

    /* The switch - the box around the slider */
    .switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }

    /* Hide default HTML checkbox */
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    /* The slider */
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #cbd5e1;
      transition: .4s;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .4s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    input:checked + .slider {
      background-color: #10b981; /* Emerald Green */
    }

    input:focus + .slider {
      box-shadow: 0 0 1px #10b981;
    }

    input:checked + .slider:before {
      transform: translateX(20px);
    }

    /* Rounded sliders */
    .slider.round {
      border-radius: 24px;
    }

    .slider.round:before {
      border-radius: 50%;
    }
  `]
})
export class StatusToggleRendererComponent implements ICellRendererAngularComp {
  private params!: StatusToggleParams;
  public isActive: boolean = true;
  public activeLabel: string = 'Active';
  public inactiveLabel: string = 'Inactive';
  public showLabel: boolean = true;

  agInit(params: StatusToggleParams & { activeLabel?: string, inactiveLabel?: string, showLabel?: boolean }): void {
    this.params = params;
    this.isActive = params.value === undefined ? true : params.value;
    if (params.activeLabel !== undefined) this.activeLabel = params.activeLabel;
    if (params.inactiveLabel !== undefined) this.inactiveLabel = params.inactiveLabel;
    if (params.showLabel !== undefined) this.showLabel = params.showLabel;
  }

  refresh(params: StatusToggleParams): boolean {
    this.params = params;
    this.isActive = params.value === undefined ? true : params.value;
    return true;
  }

  toggleStatus(event: Event) {
    const target = event.target as HTMLInputElement;
    this.isActive = target.checked;
    
    if (this.params.onToggle) {
      this.params.onToggle(this.params.data, this.isActive);
    }
  }
}
