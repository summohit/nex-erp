import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * A single shimmering placeholder block.
 *
 * Compose these to mirror the shape of the content being loaded — a skeleton
 * that matches the real layout avoids the jump users see when a spinner is
 * swapped for content of a different size.
 */
@Component({
  selector: 'app-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      class="sk"
      [class.sk-circle]="circle"
      [style.width]="width"
      [style.height]="circle ? width : height"
      [style.border-radius]="circle ? '50%' : radius"
      aria-hidden="true"></span>
  `,
  styles: [`
    .sk {
      display: block;
      background: linear-gradient(
        90deg,
        #f1f5f9 25%,
        #e2e8f0 37%,
        #f1f5f9 63%
      );
      background-size: 400% 100%;
      animation: sk-shimmer 1.4s ease-in-out infinite;
      flex-shrink: 0;
    }

    .sk-circle { border-radius: 50%; }

    @keyframes sk-shimmer {
      0%   { background-position: 100% 50%; }
      100% { background-position: 0 50%; }
    }

    /* A shimmer is decorative; honour a reduced-motion preference. */
    @media (prefers-reduced-motion: reduce) {
      .sk { animation: none; background: #eef2f6; }
    }
  `],
})
export class SkeletonComponent {
  @Input() width = '100%';
  @Input() height = '12px';
  @Input() radius = '6px';
  /** Renders a circle sized by `width` — for avatars. */
  @Input() circle = false;
}
