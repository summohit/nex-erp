import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import {
  LucideAlertCircle,
  LucideArrowRight,
  LucideBarChart3,
  LucideRefreshCw,
} from '@lucide/angular';

@Component({
  selector: 'app-apex-chart-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    RouterModule,
    LucideBarChart3,
    LucideArrowRight,
    LucideAlertCircle,
    LucideRefreshCw,
  ],
  template: `
    <article class="chart-card" [class.is-empty]="empty && !loading && !error">
      <!-- Standardized Card Header: Icon + Title + Subtitle + Right Action -->
      <header class="chart-card-head">
        <div class="chart-card-title-group">
          <div class="chart-card-icon">
            <ng-content select="[card-icon]"></ng-content>
            <svg *ngIf="!hasProjectedIcon" lucideBarChart3 size="18"></svg>
          </div>
          <div class="chart-card-titles">
            <div class="chart-card-title-row">
              <h3>{{ title }}</h3>
              <span
                *ngIf="badge"
                class="chart-badge"
                [attr.data-tone]="badgeTone"
              >
                {{ badge }}
              </span>
            </div>
            <p *ngIf="subtitle" class="chart-subtitle">{{ subtitle }}</p>
          </div>
        </div>

        <div class="chart-card-actions">
          <ng-content select="[card-actions]"></ng-content>
          <a
            *ngIf="detailLink"
            [routerLink]="detailLink"
            class="chart-link-btn"
          >
            <span>{{ detailLabel }}</span>
            <svg lucideArrowRight size="13"></svg>
          </a>
        </div>
      </header>

      <!-- Loading Skeleton -->
      <div
        class="chart-skeleton-wrap"
        *ngIf="loading"
        [style.height.px]="height"
        aria-busy="true"
      >
        <div class="chart-skeleton-bars">
          <span style="height: 45%"></span>
          <span style="height: 72%"></span>
          <span style="height: 58%"></span>
          <span style="height: 86%"></span>
          <span style="height: 64%"></span>
          <span style="height: 92%"></span>
          <span style="height: 70%"></span>
          <span style="height: 80%"></span>
        </div>
      </div>

      <!-- Error State -->
      <div class="chart-state-compact is-error" *ngIf="!loading && error">
        <svg lucideAlertCircle size="16"></svg>
        <span>{{ error }}</span>
        <button type="button" class="retry-btn" (click)="retry.emit()">
          <svg lucideRefreshCw size="12"></svg>
          <span>Retry</span>
        </button>
      </div>

      <!-- Clean Compact Empty State ("No data yet" + icon, small height) -->
      <div class="chart-state-compact" *ngIf="!loading && !error && empty">
        <div class="empty-ico">
          <svg lucideBarChart3 size="16"></svg>
        </div>
        <div class="empty-copy">
          <strong>No data yet</strong>
          <span>Metrics will appear once activity is recorded.</span>
        </div>
      </div>

      <!-- Lazy-loaded ApexCharts Canvas Host -->
      <div
        class="chart-canvas-wrap"
        [hidden]="loading || !!error || empty"
        [style.minHeight.px]="height"
      >
        <div #chartHost class="chart-host"></div>
      </div>

      <!-- Optional Footer Slot -->
      <ng-content select="[card-footer]"></ng-content>
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .chart-card {
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
        transition:
          transform 0.2s cubic-bezier(0.16, 1, 0.3, 1),
          box-shadow 0.2s ease,
          border-color 0.2s ease;
      }
      .chart-card:hover {
        transform: translateY(-2px);
        border-color: var(--dash-border-strong, #cbd5e1);
        box-shadow:
          0 4px 12px -2px rgba(15, 23, 42, 0.06),
          0 14px 28px -8px rgba(15, 23, 42, 0.07);
      }
      .chart-card.is-empty {
        height: auto;
      }
      .chart-card-head {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 14px;
        flex-wrap: wrap;
      }
      .chart-card-title-group {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      .chart-card-icon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: var(--dash-brand-soft, #eff6ff);
        border: 1px solid var(--dash-brand-border, #bfdbfe);
        color: var(--dash-brand, #1373e5);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }
      .chart-card-titles {
        min-width: 0;
      }
      .chart-card-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .chart-card-title-row h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 800;
        color: var(--dash-text-primary, #0f172a);
        letter-spacing: -0.015em;
        line-height: 1.25;
      }
      .chart-subtitle {
        margin: 2px 0 0;
        font-size: 12px;
        font-weight: 500;
        color: var(--dash-text-muted, #64748b);
      }
      .chart-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        background: #eff6ff;
        color: #1d4ed8;
        border: 1px solid #bfdbfe;
      }
      .chart-badge[data-tone='success'] {
        background: #ecfdf5;
        color: #047857;
        border-color: #a7f3d0;
      }
      .chart-badge[data-tone='warning'] {
        background: #fffbeb;
        color: #b45309;
        border-color: #fde68a;
      }
      .chart-badge[data-tone='danger'] {
        background: #fef2f2;
        color: #dc2626;
        border-color: #fecaca;
      }
      .chart-badge[data-tone='neutral'] {
        background: #f1f5f9;
        color: #475569;
        border-color: #e2e8f0;
      }
      .chart-card-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .chart-link-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        color: var(--dash-brand, #1373e5);
        background: var(--dash-brand-soft, #eff6ff);
        border: 1px solid transparent;
        text-decoration: none;
        transition: all 0.15s ease;
        white-space: nowrap;
      }
      .chart-link-btn:hover {
        background: #dbeafe;
        border-color: #93c5fd;
      }
      .chart-canvas-wrap {
        position: relative;
        width: 100%;
        flex: 1;
        display: flex;
        align-items: center;
      }
      .chart-host {
        width: 100%;
      }
      /* Skeleton Loader */
      .chart-skeleton-wrap {
        display: flex;
        align-items: flex-end;
        padding: 16px 8px 8px;
        border-radius: 12px;
        background: var(--dash-surface-subtle, #f8fafc);
        box-sizing: border-box;
      }
      .chart-skeleton-bars {
        width: 100%;
        height: 100%;
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 12px;
        align-items: end;
      }
      .chart-skeleton-bars span {
        display: block;
        width: 100%;
        border-radius: 6px 6px 2px 2px;
        background: linear-gradient(
          90deg,
          #e2e8f0 25%,
          #f1f5f9 50%,
          #e2e8f0 75%
        );
        background-size: 200% 100%;
        animation: chartShimmer 1.3s infinite linear;
      }
      @keyframes chartShimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
      /* Compact Empty & Error States */
      .chart-state-compact {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 16px;
        border-radius: 12px;
        background: var(--dash-surface-subtle, #f8fafc);
        border: 1px dashed var(--dash-border-strong, #cbd5e1);
        color: var(--dash-text-muted, #64748b);
        font-size: 13px;
      }
      .chart-state-compact.is-error {
        background: #fef2f2;
        border-color: #fecaca;
        color: #b91c1c;
      }
      .empty-ico {
        width: 32px;
        height: 32px;
        border-radius: 8px;
        background: #e2e8f0;
        color: #475569;
        display: grid;
        place-items: center;
        flex-shrink: 0;
      }
      .empty-copy {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .empty-copy strong {
        font-size: 13px;
        font-weight: 700;
        color: var(--dash-text-primary, #0f172a);
      }
      .empty-copy span {
        font-size: 12px;
        color: var(--dash-text-muted, #64748b);
      }
      .retry-btn {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 10px;
        border-radius: 8px;
        border: 1px solid #fca5a5;
        background: #ffffff;
        color: #b91c1c;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      @media (prefers-reduced-motion: reduce) {
        .chart-card {
          transition: none !important;
        }
        .chart-card:hover {
          transform: none !important;
        }
        .chart-skeleton-bars span {
          animation: none !important;
        }
      }
    `,
  ],
})
export class ApexChartCardComponent
  implements AfterViewInit, OnChanges, OnDestroy
{
  private zone = inject(NgZone);
  private router = inject(Router);

  @ViewChild('chartHost', { static: false })
  chartHost?: ElementRef<HTMLDivElement>;

  @Input() title = '';
  @Input() subtitle?: string;
  @Input() badge?: string;
  @Input() badgeTone: 'brand' | 'success' | 'warning' | 'danger' | 'neutral' =
    'brand';
  @Input() options: Record<string, any> | null = null;
  @Input() loading = false;
  @Input() empty = false;
  @Input() error: string | null = null;
  @Input() height = 250;
  @Input() detailLink?: string;
  @Input() detailLabel = 'Details';
  @Input() hasProjectedIcon = false;

  @Output() retry = new EventEmitter<void>();

  private chartInstance: any = null;
  private viewReady = false;

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.syncChart();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (
      this.viewReady &&
      (changes['options'] || changes['loading'] || changes['empty'])
    ) {
      this.syncChart();
    }
  }

  ngOnDestroy(): void {
    this.destroyChart();
  }

  private async syncChart(): Promise<void> {
    if (this.loading || this.empty || this.error || !this.options) {
      this.destroyChart();
      return;
    }

    const hostEl = this.chartHost?.nativeElement;
    if (!hostEl) return;

    const mergedOptions = this.buildMergedOptions(this.options);

    if (this.chartInstance) {
      this.zone.runOutsideAngular(() => {
        this.chartInstance.updateOptions(mergedOptions, true, true);
      });
      return;
    }

    // Lazy-load ApexCharts library on demand
    const mod = await import('apexcharts');
    const ApexChartsCtor = (mod as any).default || mod;

    if (!this.chartHost?.nativeElement || this.loading || this.empty) return;

    this.zone.runOutsideAngular(() => {
      this.chartInstance = new ApexChartsCtor(
        this.chartHost!.nativeElement,
        mergedOptions
      );
      this.chartInstance.render();
    });
  }

  private buildMergedOptions(raw: Record<string, any>): Record<string, any> {
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const detailUrl = this.detailLink;

    return {
      ...raw,
      chart: {
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        toolbar: { show: false },
        zoom: { enabled: false },
        background: 'transparent',
        height: this.height,
        animations: {
          enabled: !reducedMotion,
          easing: 'easeinout',
          speed: 520,
        },
        events: {
          ...(raw['chart']?.events || {}),
          dataPointSelection: (event: any, chartContext: any, config: any) => {
            if (raw['chart']?.events?.dataPointSelection) {
              raw['chart'].events.dataPointSelection(
                event,
                chartContext,
                config
              );
            } else if (detailUrl) {
              this.zone.run(() => this.router.navigateByUrl(detailUrl));
            }
          },
        },
        ...(raw['chart'] || {}),
      },
      grid: {
        borderColor: 'rgba(148, 163, 184, 0.18)',
        strokeDashArray: 4,
        padding: { left: 6, right: 6, top: 4, bottom: 0 },
        ...(raw['grid'] || {}),
      },
      tooltip: {
        theme: 'light',
        style: {
          fontSize: '12px',
          fontFamily:
            "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
        },
        ...(raw['tooltip'] || {}),
      },
    };
  }

  private destroyChart(): void {
    if (this.chartInstance) {
      try {
        this.chartInstance.destroy();
      } catch {
        // ignore cleanup error
      }
      this.chartInstance = null;
    }
  }
}
