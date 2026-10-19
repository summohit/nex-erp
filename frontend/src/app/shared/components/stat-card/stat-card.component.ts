import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
   inject,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './stat-card.component.html',
  styleUrls: ['./stat-card.component.css'],
})
export class StatCardComponent implements OnChanges, OnDestroy {
  private cdr = inject(ChangeDetectorRef);

  @Input() label = '';
  @Input() value: string | number | null = '';
  @Input() subtitle?: string;
  @Input() subtitleDanger = false;
  @Input() overdueCount = 0;
  @Input() badge?: string;
  @Input() delta?: string;
  @Input() deltaTone: 'good' | 'bad' | 'neutral' = 'good';
  @Input() deltaLabel = 'vs last period';
  @Input() sparkline: number[] = [];
  /** While the figures are on their way: shimmer rather than a misleading 0. */
  @Input() loading = false;
  @Input() colorClass:
    | 'bg-blue'
    | 'bg-indigo'
    | 'bg-amber'
    | 'bg-emerald'
    | 'bg-purple'
    | 'bg-orange'
    | 'bg-danger' = 'bg-blue';

  displayValue: string = '';
  sparklinePath = '';
  sparklineArea = '';
  private rafId: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['value']) {
      this.animateValue(this.value);
    }
    if (changes['sparkline']) {
      this.computeSparklineGeometry();
    }
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
    }
  }

  private animateValue(raw: string | number | null): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    const str = raw === null || raw === undefined ? '0' : String(raw);
    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Parse leading number and optional suffix (e.g. "18/24", "86%", "14.5")
    const match = str.match(/^(\d+(?:\.\d+)?)(.*)$/);
    if (!match || reducedMotion || typeof window === 'undefined') {
      this.displayValue = str;
      return;
    }

    const target = parseFloat(match[1]);
    const isFloat = match[1].includes('.');
    const suffix = match[2] || '';

    if (isNaN(target) || target === 0) {
      this.displayValue = str;
      return;
    }

    const duration = 420;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = target * eased;
      this.displayValue =
        (isFloat ? current.toFixed(1) : String(Math.round(current))) + suffix;
      this.cdr.markForCheck();

      if (progress < 1) {
        this.rafId = requestAnimationFrame(step);
      } else {
        this.displayValue = str;
        this.rafId = null;
        this.cdr.markForCheck();
      }
    };

    this.rafId = requestAnimationFrame(step);
  }

  private computeSparklineGeometry(): void {
    const pts = this.sparkline || [];
    if (pts.length < 2) {
      this.sparklinePath = '';
      this.sparklineArea = '';
      return;
    }
    const w = 88;
    const h = 28;
    const pad = 3;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;

    const coords = pts.map((v, i) => {
      const x = (i / (pts.length - 1)) * w;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    });

    const line = coords
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x},${pt.y}`)
      .join(' ');
    this.sparklinePath = line;
    this.sparklineArea = `${line} L${w},${h} L0,${h} Z`;
  }
}
