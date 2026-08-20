import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartComponent, ApexAxisChartSeries, ApexNonAxisChartSeries, ApexChart, ApexXAxis, ApexDataLabels, ApexStroke, ApexFill, ApexLegend, ApexPlotOptions, ApexGrid, ApexTooltip, ApexYAxis, ApexResponsive } from 'ng-apexcharts';

export type ChartKind = 'area' | 'bar' | 'line' | 'donut' | 'radialBar';

const PALETTE = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2', '#db2777'];

@Component({
  selector: 'app-chart-card',
  standalone: true,
  imports: [CommonModule, ChartComponent],
  templateUrl: './chart-card.component.html',
  styleUrls: ['./chart-card.component.css']
})
export class ChartCardComponent {
  @Input() type: ChartKind = 'area';
  @Input() series: ApexAxisChartSeries | ApexNonAxisChartSeries = [];
  @Input() categories: string[] = [];
  @Input() labels: string[] = [];
  @Input() colors: string[] = PALETTE;
  @Input() height = 240;
  @Input() horizontal = false;
  @Input() stacked = false;
  @Input() showLegend = true;
  @Input() currency = false;
  @Input() emptyMessage = 'No data yet';
  @Input() emptyHint = '';

  get isEmpty(): boolean {
    const s = this.series as any[];
    if (!s || s.length === 0) return true;
    if (this.type === 'donut' || this.type === 'radialBar') {
      return !s.some((v: number) => v > 0);
    }
    return !s.some((serie: any) => (serie.data || []).some((d: any) => (typeof d === 'number' ? d : d?.y) > 0));
  }

  get chartOptions(): ApexChart {
    return {
      type: this.type,
      height: this.height,
      toolbar: { show: false },
      stacked: this.stacked,
      fontFamily: 'inherit',
      sparkline: { enabled: false }
    };
  }

  get xaxisOptions(): ApexXAxis {
    return {
      categories: this.categories,
      labels: { style: { fontSize: '11px', colors: '#64748b' } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    };
  }

  get yaxisOptions(): ApexYAxis {
    return {
      labels: {
        style: { fontSize: '11px', colors: '#64748b' },
        formatter: this.currency ? (v: number) => this.formatCompactCurrency(v) : undefined
      }
    };
  }

  get dataLabelsOptions(): ApexDataLabels {
    return { enabled: this.type === 'donut' || this.type === 'radialBar' };
  }

  get strokeOptions(): ApexStroke {
    return this.type === 'area' || this.type === 'line'
      ? { curve: 'smooth', width: 2.5 }
      : { width: this.type === 'bar' ? 0 : 2 };
  }

  get fillOptions(): ApexFill {
    if (this.type === 'area') {
      return { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.02, stops: [0, 95, 100] } };
    }
    return { opacity: 1 };
  }

  get legendOptions(): ApexLegend {
    return { show: this.showLegend, position: 'bottom', fontSize: '12px', labels: { colors: '#475569' } };
  }

  get plotOptionsConfig(): ApexPlotOptions {
    if (this.type === 'bar') {
      return { bar: { horizontal: this.horizontal, borderRadius: 4, columnWidth: '55%', dataLabels: { position: 'top' } } };
    }
    if (this.type === 'radialBar') {
      return {
        radialBar: {
          hollow: { size: '55%' },
          dataLabels: {
            name: { fontSize: '12px', color: '#64748b' },
            value: { fontSize: '20px', fontWeight: 700, color: '#0f172a' }
          }
        }
      };
    }
    return {};
  }

  get gridOptions(): ApexGrid {
    return { borderColor: '#f1f5f9', strokeDashArray: 4 };
  }

  get tooltipOptions(): ApexTooltip {
    return this.currency ? { y: { formatter: (v: number) => this.formatCurrency(v) } } : {};
  }

  get responsiveOptions(): ApexResponsive[] {
    return [{ breakpoint: 640, options: { chart: { height: this.height - 40 } } }];
  }

  private formatCurrency(v: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v || 0);
  }

  private formatCompactCurrency(v: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(v || 0);
  }
}
