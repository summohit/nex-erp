import {
  ChangeDetectionStrategy,
  Component,
  computed,
  Input,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import {
  LucideArrowRight,
  LucideCalendarClock,
  LucideFlame,
} from '@lucide/angular';
import {
  HeatmapCell,
  HeatmapWeek,
} from '../services/dashboard-analytics-mock.service';

@Component({
  selector: 'app-work-hours-heatmap-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    LucideCalendarClock,
    LucideArrowRight,
    LucideFlame,
  ],
  template: `
    <article class="hm-card">
      <header class="hm-head">
        <div class="hm-title-group">
          <div class="hm-icon">
            <svg lucideCalendarClock size="18"></svg>
          </div>
          <div>
            <div class="hm-title-row">
              <h3>Work-Hours Heatmap</h3>
              <span class="hm-badge">{{ totalHours() }}h logged · 12w</span>
            </div>
            <p class="hm-sub">
              Daily effort intensity across the last 12 weeks (target: 9h/day)
            </p>
          </div>
        </div>
        <a routerLink="/attendance" class="hm-link">
          <span>Attendance Log</span>
          <svg lucideArrowRight size="13"></svg>
        </a>
      </header>

      <!-- Skeleton -->
      <div class="hm-skeleton" *ngIf="loading"></div>

      <!-- Empty -->
      <div class="hm-empty" *ngIf="!loading && !weeks?.length">
        <svg lucideFlame size="16"></svg>
        <span>No data yet — work-hour activity will appear here.</span>
      </div>

      <!-- Heatmap Grid -->
      <div class="hm-body" *ngIf="!loading && weeks?.length">
        <div class="hm-grid-scroll">
          <div class="hm-layout">
            <!-- Day-of-week labels -->
            <div class="hm-dow-col">
              <span>Mon</span>
              <span>Wed</span>
              <span>Fri</span>
              <span>Sun</span>
            </div>

            <!-- 12 Week Columns -->
            <div class="hm-weeks-wrap">
              <div class="hm-week-labels">
                <span
                  *ngFor="let w of weeks; let idx = index; trackBy: trackByWeek"
                >
                  {{ idx % 2 === 0 ? w.weekLabel : '' }}
                </span>
              </div>

              <div class="hm-weeks">
                <div
                  class="hm-week-col"
                  *ngFor="let w of weeks; trackBy: trackByWeek"
                >
                  <button
                    type="button"
                    class="hm-cell lv-{{ c.level }}"
                    *ngFor="let c of w.days; trackBy: trackByCell"
                    [title]="c.label + ' — ' + c.hours + 'h worked'"
                    (mouseenter)="hoveredCell.set(c)"
                    (mouseleave)="hoveredCell.set(null)"
                  ></button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Legend & Active Cell Readout -->
        <footer class="hm-footer">
          <div class="hm-readout">
            <ng-container *ngIf="hoveredCell() as hc; else defaultReadout">
              <strong>{{ hc.label }}:</strong>
              <span>{{ hc.hours }}h logged</span>
            </ng-container>
            <ng-template #defaultReadout>
              <span>Avg workday: <strong>{{ avgWorkdayHours() }}h</strong></span>
            </ng-template>
          </div>

          <div class="hm-legend" aria-label="Hours intensity legend">
            <span>0h</span>
            <i class="hm-cell lv-0"></i>
            <i class="hm-cell lv-1" title="1–5h"></i>
            <i class="hm-cell lv-2" title="5–7.5h"></i>
            <i class="hm-cell lv-3" title="7.5–9h"></i>
            <i class="hm-cell lv-4" title="9h+"></i>
            <span>9h+</span>
          </div>
        </footer>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .hm-card {
        background: var(--dash-surface, #ffffff);
        border: 1px solid var(--dash-border, #e2e8f0);
        border-radius: 16px;
        padding: 20px;
        box-shadow: var(
          --dash-shadow,
          0 1px 3px rgba(15, 23, 42, 0.03),
          0 8px 24px -6px rgba(15, 23, 42, 0.04)
        );
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 100%;
        box-sizing: border-box;
      }
      .hm-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .hm-title-group {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .hm-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #059669;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }
      .hm-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .hm-title-row h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
        letter-spacing: -0.015em;
      }
      .hm-badge {
        padding: 2px 8px;
        border-radius: 999px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #047857;
        font-size: 11px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .hm-sub {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--dash-text-muted, #64748b);
      }
      .hm-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        color: #1373e5;
        background: #eff6ff;
        text-decoration: none;
      }
      .hm-link:hover {
        background: #dbeafe;
      }
      .hm-grid-scroll {
        overflow-x: auto;
        padding-bottom: 4px;
      }
      .hm-layout {
        display: flex;
        align-items: flex-end;
        gap: 10px;
      }
      .hm-dow-col {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        height: 124px;
        padding: 2px 0;
        font-size: 10.5px;
        font-weight: 700;
        color: var(--dash-text-muted, #64748b);
      }
      .hm-weeks-wrap {
        flex: 1;
        min-width: 280px;
      }
      .hm-week-labels {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 5px;
        margin-bottom: 6px;
        font-size: 10px;
        font-weight: 700;
        color: var(--dash-text-muted, #64748b);
        white-space: nowrap;
      }
      .hm-weeks {
        display: grid;
        grid-template-columns: repeat(12, 1fr);
        gap: 5px;
      }
      .hm-week-col {
        display: grid;
        grid-template-rows: repeat(7, 14px);
        gap: 4px;
      }
      .hm-cell {
        width: 100%;
        height: 14px;
        border-radius: 4px;
        border: 1px solid rgba(15, 23, 42, 0.05);
        padding: 0;
        cursor: pointer;
        transition: transform 0.12s ease;
      }
      button.hm-cell:hover {
        transform: scale(1.18);
        z-index: 2;
      }
      .hm-cell.lv-0 {
        background: var(--dash-surface-subtle, #f1f5f9);
      }
      .hm-cell.lv-1 {
        background: #bbf7d0;
      }
      .hm-cell.lv-2 {
        background: #4ade80;
      }
      .hm-cell.lv-3 {
        background: #16a34a;
      }
      .hm-cell.lv-4 {
        background: #15803d;
      }
      .hm-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid var(--dash-border, #f1f5f9);
        font-size: 12px;
        color: var(--dash-text-muted, #64748b);
        font-variant-numeric: tabular-nums;
      }
      .hm-readout strong {
        color: var(--dash-text-primary, #0f172a);
      }
      .hm-legend {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
      }
      .hm-legend .hm-cell {
        width: 12px;
        height: 12px;
        display: inline-block;
        cursor: default;
      }
      .hm-skeleton {
        height: 150px;
        border-radius: 12px;
        background: #f1f5f9;
      }
      .hm-empty {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 14px;
        border-radius: 12px;
        background: #f8fafc;
        color: #64748b;
        font-size: 12.5px;
      }
    `,
  ],
})
export class WorkHoursHeatmapWidgetComponent {
  @Input() weeks: HeatmapWeek[] = [];
  @Input() loading = false;

  hoveredCell = signal<HeatmapCell | null>(null);

  totalHours = computed(() => {
    let sum = 0;
    for (const w of this.weeks || []) {
      for (const d of w.days) sum += d.hours;
    }
    return Math.round(sum);
  });

  avgWorkdayHours = computed(() => {
    let sum = 0;
    let count = 0;
    for (const w of this.weeks || []) {
      for (const d of w.days) {
        if (d.hours > 0) {
          sum += d.hours;
          count++;
        }
      }
    }
    return count ? (sum / count).toFixed(1) : '0.0';
  });

  trackByWeek = (_: number, w: HeatmapWeek) => w.weekLabel;
  trackByCell = (_: number, c: HeatmapCell) => c.date;
}
