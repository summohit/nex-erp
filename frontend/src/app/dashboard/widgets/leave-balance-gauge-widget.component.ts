import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideArrowRight, LucideCalendar, LucideCheckCircle2 } from '@lucide/angular';
import { LeaveGaugeItem } from '../services/dashboard-analytics-mock.service';

@Component({
  selector: 'app-leave-balance-gauge-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideCalendar, LucideArrowRight, LucideCheckCircle2],
  template: `
    <article class="lg-card">
      <header class="lg-head">
        <div class="lg-title-group">
          <div class="lg-icon">
            <svg lucideCalendar size="18"></svg>
          </div>
          <div>
            <div class="lg-title-row">
              <h3>Leave Balance Gauges</h3>
              <span class="lg-badge">{{ totalRemaining }}d available</span>
            </div>
            <p class="lg-sub">Used vs allocated quota per leave category</p>
          </div>
        </div>
        <a routerLink="/leaves" class="lg-link">
          <span>Apply Leave</span>
          <svg lucideArrowRight size="13"></svg>
        </a>
      </header>

      <div class="lg-skeleton" *ngIf="loading"></div>

      <div class="lg-empty" *ngIf="!loading && !items?.length">
        <span>No data yet — leave balances will appear once policies are assigned.</span>
      </div>

      <div class="lg-body" *ngIf="!loading && items?.length">
        <!-- Overall Quota Summary Strip -->
        <div class="lg-summary-strip">
          <div class="lg-sum-metrics">
            <div class="lg-sum-col">
              <span class="lg-sum-lbl">Available</span>
              <strong class="lg-sum-val emerald">{{ totalRemainingDays }}d</strong>
            </div>
            <div class="lg-sum-divider"></div>
            <div class="lg-sum-col">
              <span class="lg-sum-lbl">Used</span>
              <strong class="lg-sum-val">{{ totalUsedDays }}d</strong>
            </div>
            <div class="lg-sum-divider"></div>
            <div class="lg-sum-col">
              <span class="lg-sum-lbl">Total Quota</span>
              <strong class="lg-sum-val">{{ totalAllocatedDays }}d</strong>
            </div>
          </div>

          <div class="lg-sum-bar-wrap">
            <div class="lg-sum-bar-top">
              <span>Overall Balance Remaining</span>
              <strong>{{ overallRemainingPct }}% available</strong>
            </div>
            <div class="lg-sum-bar-track">
              <div
                class="lg-sum-bar-fill"
                [style.width.%]="overallRemainingPct"
              ></div>
            </div>
          </div>
        </div>

        <!-- Radial Gauge Cards -->
        <div class="lg-grid" [class.single-item]="items.length === 1">
          <div
            class="lg-gauge-item"
            *ngFor="let item of items; trackBy: trackByLeave"
          >
            <div class="lg-ring-wrap">
              <svg
                width="68"
                height="68"
                viewBox="0 0 68 68"
                class="lg-ring-svg"
                aria-hidden="true"
              >
                <circle
                  class="lg-ring-track"
                  cx="34"
                  cy="34"
                  r="27"
                  stroke-width="6.5"
                ></circle>
                <circle
                  class="lg-ring-fill"
                  cx="34"
                  cy="34"
                  r="27"
                  stroke-width="6.5"
                  [attr.stroke]="item.color"
                  [attr.stroke-dasharray]="circumference"
                  [attr.stroke-dashoffset]="dashOffset(item.percentUsed)"
                ></circle>
              </svg>
              <div class="lg-ring-center">
                <span class="lg-ring-rem" [style.color]="item.color">{{ item.remaining }}</span>
                <span class="lg-ring-unit">left</span>
              </div>
            </div>

            <div class="lg-meta">
              <div class="lg-name-row">
                <div class="lg-name-left">
                  <span class="lg-name" [title]="item.name">{{ item.name }}</span>
                  <span
                    class="lg-code"
                    [style.background]="item.color + '18'"
                    [style.color]="item.color"
                    [style.border-color]="item.color + '40'"
                  >
                    {{ item.code }}
                  </span>
                </div>
                <span class="lg-avail-pct">{{ 100 - item.percentUsed }}% left</span>
              </div>

              <!-- Mini Progress Bar -->
              <div class="lg-item-bar">
                <i
                  [style.width.%]="100 - item.percentUsed"
                  [style.background]="item.color"
                ></i>
              </div>

              <div class="lg-stats">
                <span class="lg-stat-chip">
                  Used: <strong>{{ item.used }}d</strong>
                </span>
                <span class="lg-stat-sep">·</span>
                <span class="lg-stat-chip">
                  Quota: <strong>{{ item.allocated }}d</strong>
                </span>
                <span class="lg-stat-sep">·</span>
                <span class="lg-stat-chip">
                  Balance: <strong [style.color]="item.color">{{ item.remaining }}d</strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Subtle Footer Note -->
        <div class="lg-footer">
          <div class="lg-footer-left">
            <svg lucideCheckCircle2 size="14"></svg>
            <span>
              {{ items.length }} active leave {{ items.length === 1 ? 'policy' : 'policies' }} assigned for current cycle
            </span>
          </div>
          <a routerLink="/leaves" class="lg-footer-cta">View Policy &amp; History →</a>
        </div>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .lg-card {
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
        height: 100%;
        box-sizing: border-box;
      }
      .lg-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .lg-title-group {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .lg-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: #f5f3ff;
        border: 1px solid #ddd6fe;
        color: #7c3aed;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }
      .lg-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .lg-title-row h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
        letter-spacing: -0.015em;
      }
      .lg-badge {
        padding: 2px 9px;
        border-radius: 999px;
        background: #f5f3ff;
        border: 1px solid #ddd6fe;
        color: #6d28d9;
        font-size: 11px;
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .lg-sub {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--dash-text-muted, #64748b);
      }
      .lg-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 11px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        color: #1373e5;
        background: #eff6ff;
        border: 1px solid #dbeafe;
        text-decoration: none;
        transition: all 0.15s ease;
      }
      .lg-link:hover {
        background: #dbeafe;
      }

      .lg-body {
        display: flex;
        flex-direction: column;
        gap: 14px;
        flex: 1;
      }

      /* Summary Strip */
      .lg-summary-strip {
        padding: 12px 14px;
        border-radius: 12px;
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.05), rgba(19, 115, 229, 0.05));
        border: 1px solid var(--dash-border, #e2e8f0);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        flex-wrap: wrap;
      }
      .lg-sum-metrics {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .lg-sum-col {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .lg-sum-lbl {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--dash-text-muted, #64748b);
      }
      .lg-sum-val {
        font-size: 16px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
        font-variant-numeric: tabular-nums;
        line-height: 1.1;
      }
      .lg-sum-val.emerald {
        color: #059669;
      }
      .lg-sum-divider {
        width: 1px;
        height: 26px;
        background: var(--dash-border, #e2e8f0);
      }
      .lg-sum-bar-wrap {
        flex: 1;
        min-width: 150px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .lg-sum-bar-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: var(--dash-text-muted, #64748b);
      }
      .lg-sum-bar-top strong {
        color: var(--dash-text-primary, #0f172a);
        font-weight: 800;
        font-variant-numeric: tabular-nums;
      }
      .lg-sum-bar-track {
        height: 7px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.22);
        overflow: hidden;
      }
      .lg-sum-bar-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #7c3aed, #1373e5, #059669);
        transition: width 0.4s ease;
      }

      /* Gauge Grid */
      .lg-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
      }
      .lg-grid.single-item {
        grid-template-columns: 1fr;
      }
      .lg-gauge-item {
        display: flex;
        align-items: center;
        gap: 14px;
        padding: 14px 16px;
        border-radius: 14px;
        background: var(--dash-surface-subtle, #f8fafc);
        border: 1px solid var(--dash-border, #e2e8f0);
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .lg-gauge-item:hover {
        border-color: var(--dash-border-strong, #cbd5e1);
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.04);
      }
      .lg-ring-wrap {
        position: relative;
        width: 68px;
        height: 68px;
        flex: 0 0 68px;
        display: grid;
        place-items: center;
      }
      .lg-ring-svg {
        width: 68px !important;
        height: 68px !important;
        display: block;
        transform: rotate(-90deg);
      }
      .lg-ring-track {
        fill: none;
        stroke: rgba(148, 163, 184, 0.22);
      }
      .lg-ring-fill {
        fill: none;
        stroke-linecap: round;
        transition: stroke-dashoffset 0.5s ease;
      }
      .lg-ring-center {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }
      .lg-ring-rem {
        font-size: 17px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
      }
      .lg-ring-unit {
        font-size: 9px;
        font-weight: 800;
        color: var(--dash-text-muted, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-top: 2px;
      }
      .lg-meta {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 7px;
      }
      .lg-name-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .lg-name-left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .lg-name {
        font-size: 14px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .lg-code {
        padding: 1px 6px;
        border-radius: 5px;
        border: 1px solid transparent;
        font-size: 10px;
        font-weight: 800;
        flex-shrink: 0;
      }
      .lg-avail-pct {
        font-size: 11px;
        font-weight: 700;
        color: var(--dash-text-muted, #64748b);
        font-variant-numeric: tabular-nums;
        flex-shrink: 0;
      }
      .lg-item-bar {
        height: 5px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.2);
        overflow: hidden;
      }
      .lg-item-bar i {
        display: block;
        height: 100%;
        border-radius: 999px;
        transition: width 0.4s ease;
      }
      .lg-stats {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        font-size: 11.5px;
        color: var(--dash-text-muted, #64748b);
        font-variant-numeric: tabular-nums;
      }
      .lg-stats strong {
        color: var(--dash-text-secondary, #334155);
        font-weight: 700;
      }
      .lg-stat-sep {
        opacity: 0.5;
      }

      /* Footer Note */
      .lg-footer {
        margin-top: auto;
        padding-top: 10px;
        border-top: 1px dashed var(--dash-border, #e2e8f0);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
        font-size: 11.5px;
        color: var(--dash-text-muted, #64748b);
      }
      .lg-footer-left {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: var(--dash-text-muted, #64748b);
      }
      .lg-footer-left svg {
        color: #059669;
      }
      .lg-footer-cta {
        font-size: 11.5px;
        font-weight: 700;
        color: #1373e5;
        text-decoration: none;
      }
      .lg-footer-cta:hover {
        text-decoration: underline;
      }

      .lg-skeleton {
        height: 140px;
        border-radius: 12px;
        background: #f1f5f9;
      }
      .lg-empty {
        padding: 14px;
        border-radius: 12px;
        background: #f8fafc;
        color: #64748b;
        font-size: 12.5px;
      }
    `,
  ],
})
export class LeaveBalanceGaugeWidgetComponent {
  @Input() items: LeaveGaugeItem[] = [];
  @Input() totalRemaining: string | number = 0;
  @Input() loading = false;

  readonly circumference = 2 * Math.PI * 27;

  get totalAllocatedDays(): number {
    return (this.items || []).reduce((sum, i) => sum + Number(i.allocated || 0), 0);
  }

  get totalUsedDays(): number {
    return (this.items || []).reduce((sum, i) => sum + Number(i.used || 0), 0);
  }

  get totalRemainingDays(): number {
    return (this.items || []).reduce((sum, i) => sum + Number(i.remaining || 0), 0);
  }

  get overallRemainingPct(): number {
    const alloc = this.totalAllocatedDays;
    if (!alloc) return 100;
    return Math.max(0, Math.min(100, Math.round((this.totalRemainingDays / alloc) * 100)));
  }

  dashOffset(percentUsed: number): number {
    const remainingPct = Math.max(0, Math.min(100, 100 - percentUsed));
    return this.circumference - (remainingPct / 100) * this.circumference;
  }

  trackByLeave = (_: number, item: LeaveGaugeItem) => item.id;
}
