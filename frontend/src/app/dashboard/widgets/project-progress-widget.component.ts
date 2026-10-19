import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { LucideArrowRight, LucideFolderKanban } from '@lucide/angular';
import { ProjectProgressItem } from '../services/dashboard-analytics-mock.service';

@Component({
  selector: 'app-project-progress-widget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule, LucideFolderKanban, LucideArrowRight],
  template: `
    <article class="pp-card">
      <header class="pp-head">
        <div class="pp-title-group">
          <div class="pp-icon">
            <svg lucideFolderKanban size="18"></svg>
          </div>
          <div>
            <div class="pp-title-row">
              <h3>Project Delivery Progress</h3>
              <span class="pp-badge">{{ projects?.length || 0 }} active</span>
            </div>
            <p class="pp-sub">Milestone completion rate &amp; target delivery dates</p>
          </div>
        </div>
        <a routerLink="/projects" class="pp-link">
          <span>All Projects</span>
          <svg lucideArrowRight size="13"></svg>
        </a>
      </header>

      <div class="pp-skeleton" *ngIf="loading"></div>

      <div class="pp-empty" *ngIf="!loading && !projects?.length">
        <strong>No data yet</strong>
        <span>Assigned projects and milestones will appear here.</span>
      </div>

      <div class="pp-list" *ngIf="!loading && projects?.length">
        <a
          routerLink="/projects"
          class="pp-item"
          *ngFor="let p of projects; trackBy: trackByProject"
        >
          <div class="pp-item-top">
            <div class="pp-name-group">
              <span class="pp-name">{{ p.name }}</span>
              <span class="pp-dept">{{ p.clientOrDept }}</span>
            </div>
            <div class="pp-right-meta">
              <span
                class="pp-status-pill"
                [class.at-risk]="p.status === 'AT_RISK'"
              >
                {{ p.status === 'AT_RISK' ? 'At Risk' : 'On Track' }}
              </span>
              <span class="pp-pct">{{ p.progress }}%</span>
            </div>
          </div>

          <div class="pp-bar-track">
            <div
              class="pp-bar-fill"
              [class.at-risk]="p.status === 'AT_RISK'"
              [style.width.%]="p.progress"
            ></div>
          </div>

          <div class="pp-item-foot">
            <span>{{ p.tasksOpen }} open tasks</span>
            <span>Due {{ p.dueDate }}</span>
          </div>
        </a>
      </div>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .pp-card {
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
      .pp-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .pp-title-group {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .pp-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: #eef2ff;
        border: 1px solid #c7d2fe;
        color: #4f46e5;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }
      .pp-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pp-title-row h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
        letter-spacing: -0.015em;
      }
      .pp-badge {
        padding: 2px 8px;
        border-radius: 999px;
        background: #eef2ff;
        border: 1px solid #c7d2fe;
        color: #4338ca;
        font-size: 11px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .pp-sub {
        margin: 2px 0 0;
        font-size: 12px;
        color: var(--dash-text-muted, #64748b);
      }
      .pp-link {
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
      .pp-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .pp-item {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 11px 13px;
        border-radius: 12px;
        background: var(--dash-surface-subtle, #f8fafc);
        border: 1px solid var(--dash-border, #e2e8f0);
        text-decoration: none;
        transition: border-color 0.15s ease, transform 0.15s ease;
      }
      .pp-item:hover {
        border-color: #93c5fd;
        transform: translateY(-1px);
      }
      .pp-item-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .pp-name-group {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .pp-name {
        font-size: 13.5px;
        font-weight: 700;
        color: var(--dash-text-primary, #0f172a);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pp-dept {
        font-size: 11px;
        font-weight: 600;
        color: var(--dash-text-muted, #64748b);
      }
      .pp-right-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
      }
      .pp-status-pill {
        padding: 2px 7px;
        border-radius: 999px;
        font-size: 10.5px;
        font-weight: 700;
        background: #ecfdf5;
        color: #047857;
        border: 1px solid #a7f3d0;
      }
      .pp-status-pill.at-risk {
        background: #fef2f2;
        color: #dc2626;
        border-color: #fecaca;
      }
      .pp-pct {
        font-size: 13px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
      }
      .pp-bar-track {
        height: 7px;
        border-radius: 999px;
        background: #e2e8f0;
        overflow: hidden;
      }
      .pp-bar-fill {
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #1373e5, #4f46e5);
        transition: width 0.4s ease;
      }
      .pp-bar-fill.at-risk {
        background: linear-gradient(90deg, #ea580c, #dc2626);
      }
      .pp-item-foot {
        display: flex;
        justify-content: space-between;
        font-size: 11.5px;
        color: var(--dash-text-muted, #64748b);
        font-variant-numeric: tabular-nums;
      }
      .pp-skeleton {
        height: 180px;
        border-radius: 12px;
        background: #f1f5f9;
      }
      .pp-empty {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 14px;
        border-radius: 12px;
        background: #f8fafc;
        color: #64748b;
        font-size: 12.5px;
      }
    `,
  ],
})
export class ProjectProgressWidgetComponent {
  @Input() projects: ProjectProgressItem[] = [];
  @Input() loading = false;

  trackByProject = (_: number, p: ProjectProgressItem) => p.id;
}
