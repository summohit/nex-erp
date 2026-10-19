import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideArrowRight, LucideUserCheck } from '@lucide/angular';
import { TeamPresenceBreakdown } from '../services/dashboard-analytics-mock.service';

@Component({
  selector: 'app-team-presence-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideUserCheck, LucideArrowRight],
  template: `
    <article class="tp-card">
      <header class="tp-head">
        <div class="tp-title-group">
          <div class="tp-icon">
            <svg lucideUserCheck size="18"></svg>
          </div>
          <div>
            <div class="tp-title-row">
              <h3>Team Presence Today</h3>
              <span class="tp-badge" *ngIf="breakdown">
                {{ breakdown.total }} members
              </span>
            </div>
            <p class="tp-sub">
              Live check-in distribution across office, remote (WFH), leave &amp; unpunched
            </p>
          </div>
        </div>
        <a routerLink="/attendance" class="tp-link">
          <span>Live Roster</span>
          <svg lucideArrowRight size="13"></svg>
        </a>
      </header>

      <div class="tp-skeleton" *ngIf="loading"></div>

      <div class="tp-body" *ngIf="!loading && breakdown">
        <!-- Stacked Horizontal Bar -->
        <div class="tp-stacked-bar" role="img" aria-label="Team presence stacked bar">
          <div
            class="tp-seg"
            *ngFor="let seg of breakdown.segments; trackBy: trackBySeg"
            [style.width.%]="seg.count > 0 ? Math.max(4, seg.percent) : 0"
            [style.background]="seg.color"
            [title]="seg.label + ': ' + seg.count + ' (' + seg.percent + '%)'"
          ></div>
        </div>

        <!-- Segment Legend Cards -->
        <div class="tp-legend-grid">
          <div
            class="tp-stat-chip"
            *ngFor="let seg of breakdown.segments; trackBy: trackBySeg"
          >
            <div class="tp-stat-top">
              <span class="tp-dot" [style.background]="seg.color"></span>
              <span class="tp-stat-label">{{ seg.label }}</span>
            </div>
            <div class="tp-stat-val-row">
              <span class="tp-stat-count">{{ seg.count }}</span>
              <span class="tp-stat-pct">{{ seg.percent }}%</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .tp-card {
        background: var(--dash-surface, #ffffff);
        border: 1px solid var(--dash-border, #e2e8f0);
        border-radius: 16px;
        padding: 20px;
        box-shadow: var(
          --dash-shadow,
          0 1px 3px rgba(15, 23, 42, 0.03),
          0 8px 24px -6px rgba(15, 23, 42, 0.04)
        );
      }
      .tp-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .tp-title-group {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .tp-icon {
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
      .tp-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .tp-title-row h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
        letter-spacing: -0.015em;
      }
      .tp-badge {
        padding: 2px 8px;
        border-radius: 999px;
        background: #ecfdf5;
        border: 1px solid #a7f3d0;
        color: #047857;
        font-size: 11px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .tp-sub {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--dash-text-muted, #64748b);
      }
      .tp-link {
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
      .tp-stacked-bar {
        display: flex;
        height: 18px;
        border-radius: 999px;
        overflow: hidden;
        background: #f1f5f9;
        gap: 2px;
        margin-bottom: 16px;
      }
      .tp-seg {
        height: 100%;
        transition: width 0.4s ease;
        cursor: pointer;
      }
      .tp-seg:first-child {
        border-radius: 999px 0 0 999px;
      }
      .tp-seg:last-child {
        border-radius: 0 999px 999px 0;
      }
      .tp-legend-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 10px;
      }
      .tp-stat-chip {
        padding: 10px 12px;
        border-radius: 12px;
        background: var(--dash-surface-subtle, #f8fafc);
        border: 1px solid var(--dash-border, #e2e8f0);
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .tp-stat-top {
        display: flex;
        align-items: center;
        gap: 7px;
      }
      .tp-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
      }
      .tp-stat-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--dash-text-muted, #64748b);
      }
      .tp-stat-val-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        font-variant-numeric: tabular-nums;
      }
      .tp-stat-count {
        font-size: 20px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
      }
      .tp-stat-pct {
        font-size: 12px;
        font-weight: 700;
        color: var(--dash-text-muted, #64748b);
      }
      .tp-skeleton {
        height: 96px;
        border-radius: 12px;
        background: #f1f5f9;
      }
    `,
  ],
})
export class TeamPresenceWidgetComponent {
  @Input() breakdown: TeamPresenceBreakdown | null = null;
  @Input() loading = false;

  readonly Math = Math;

  trackBySeg = (_: number, seg: { key: string }) => seg.key;
}
