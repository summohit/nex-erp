import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-stat-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './stat-card.component.html',
  styleUrls: ['./stat-card.component.css']
})
export class StatCardComponent {
  @Input() label = '';
  @Input() value: string | number | null = '';
  @Input() subtitle?: string;
  @Input() badge?: string;
  /** While the figures are on their way: shimmer rather than a misleading 0. */
  @Input() loading = false;
  @Input() colorClass: 'bg-blue' | 'bg-indigo' | 'bg-amber' | 'bg-emerald' | 'bg-purple' | 'bg-orange' = 'bg-blue';
}
