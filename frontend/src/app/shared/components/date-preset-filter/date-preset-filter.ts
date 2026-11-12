import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type DatePreset = 'ALL' | 'TODAY' | 'YESTERDAY' | '7D' | '30D' | 'MONTH' | 'CUSTOM';
/** Inclusive range in local time; null = no date filter. */
export type DateRange = { from: Date; to: Date } | null;

/**
 * The one date filter for list pages (12 Nov 2026): a single "Joined: Any
 * time ▾" dropdown with Today, Yesterday, Last 7/30 days, This month, or a
 * custom from-month to to-month range — the way Google, HubSpot and Zoho do it.
 */
@Component({
  selector: 'app-date-preset-filter',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dpf" (keydown.escape)="open = false">
      <button type="button" class="dpf-btn" [class.on]="preset !== 'ALL'" (click)="open = !open"
              [attr.aria-expanded]="open" aria-haspopup="menu">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <span>{{ label ? label + ': ' : '' }}<b>{{ summary() }}</b></span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <div class="dpf-backdrop" *ngIf="open" (click)="open = false"></div>
      <div class="dpf-menu" *ngIf="open" role="menu">
        <button type="button" role="menuitemradio" *ngFor="let p of presets" [class.active]="preset === p.id"
                [attr.aria-checked]="preset === p.id" (click)="select(p.id)">
          <span>{{ p.long }}</span>
          <svg *ngIf="preset === p.id" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </button>
        <div class="dpf-custom" *ngIf="preset === 'CUSTOM'">
          <label>From <input type="month" [ngModel]="fromMonth" (ngModelChange)="fromMonth = $event; emit()"></label>
          <label>To <input type="month" [ngModel]="toMonth" (ngModelChange)="toMonth = $event; emit()"></label>
          <button type="button" class="dpf-done" (click)="open = false">Done</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: inline-block; }
    .dpf { position: relative; }
    .dpf-btn { display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 12px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #475569; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .dpf-btn b { font-weight: 600; color: #0f172a; }
    .dpf-btn:hover { border-color: #cbd5e1; }
    .dpf-btn.on { border-color: #93c5fd; background: #eff6ff; color: #1d4ed8; }
    .dpf-btn.on b { color: #1d4ed8; }
    .dpf-backdrop { position: fixed; inset: 0; z-index: 40; }
    .dpf-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 41; min-width: 220px; padding: 6px; background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 12px 32px rgba(15, 23, 42, .14); }
    .dpf-menu > button { display: flex; width: 100%; align-items: center; justify-content: space-between; padding: 8px 10px; border: 0; background: transparent; border-radius: 6px; font-size: 13px; color: #334155; cursor: pointer; text-align: left; }
    .dpf-menu > button:hover { background: #f1f5f9; }
    .dpf-menu > button.active { color: #1d4ed8; font-weight: 600; }
    .dpf-custom { display: grid; gap: 8px; padding: 10px 10px 6px; margin-top: 4px; border-top: 1px solid #eef2f7; }
    .dpf-custom label { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: #64748b; }
    .dpf-custom input { height: 32px; padding: 0 8px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; color: #0f172a; }
    .dpf-done { justify-self: end; height: 30px; padding: 0 14px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; }
  `],
})
export class DatePresetFilterComponent {
  @Input() preset: DatePreset = 'ALL';
  /** What the date means on this page, e.g. "Joined" or "Uploaded". */
  @Input() label = '';
  @Output() presetChange = new EventEmitter<DatePreset>();
  @Output() rangeChange = new EventEmitter<DateRange>();

  open = false;
  readonly presets: { id: DatePreset; long: string }[] = [
    { id: 'ALL', long: 'Any time' }, { id: 'TODAY', long: 'Today' }, { id: 'YESTERDAY', long: 'Yesterday' },
    { id: '7D', long: 'Last 7 days' }, { id: '30D', long: 'Last 30 days' }, { id: 'MONTH', long: 'This month' },
    { id: 'CUSTOM', long: 'Custom range…' },
  ];

  /** What the button shows, e.g. "Last 7 days" or "Jan 2026 – Mar 2026". */
  summary(): string {
    if (this.preset === 'CUSTOM') {
      const f = (m: string) => m ? new Date(m + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
      const a = f(this.fromMonth), b = f(this.toMonth);
      return a && b && a !== b ? `${a} – ${b}` : (a || b || 'Custom range');
    }
    return this.presets.find(p => p.id === this.preset)?.long ?? 'Any time';
  }
  fromMonth = '';
  toMonth = '';

  select(p: DatePreset) {
    this.preset = p;
    if (p === 'CUSTOM' && !this.fromMonth) {
      const m = new Date().toISOString().slice(0, 7);
      this.fromMonth = m;
      this.toMonth = m;
    }
    this.presetChange.emit(p);
    this.emit();
    if (p !== 'CUSTOM') this.open = false;
  }

  /** Back to All, e.g. from a page's Reset button. */
  reset() { this.preset = 'ALL'; this.presetChange.emit('ALL'); this.rangeChange.emit(null); }

  emit() { this.rangeChange.emit(rangeFor(this.preset, this.fromMonth, this.toMonth)); }
}

export function rangeFor(p: DatePreset, fromMonth = '', toMonth = ''): DateRange {
  const now = new Date();
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  const back = (n: number) => { const d = day(now); d.setDate(d.getDate() - n); return d; };
  switch (p) {
    case 'TODAY': return { from: day(now), to: end(now) };
    case 'YESTERDAY': return { from: back(1), to: end(back(1)) };
    case '7D': return { from: back(6), to: end(now) };
    case '30D': return { from: back(29), to: end(now) };
    case 'MONTH': return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end(now) };
    case 'CUSTOM': {
      if (!fromMonth && !toMonth) return null;
      const [fy, fm] = (fromMonth || toMonth).split('-').map(Number);
      const [ty, tm] = (toMonth || fromMonth).split('-').map(Number);
      let from = new Date(fy, fm - 1, 1), to = new Date(ty, tm, 0, 23, 59, 59, 999);
      if (to < from) [from, to] = [new Date(ty, tm - 1, 1), new Date(fy, fm, 0, 23, 59, 59, 999)];
      return { from, to };
    }
    default: return null;
  }
}

/** Whether a date (string or Date) falls in the range; no range = everything. */
export function inDateRange(value: string | Date | null | undefined, range: DateRange): boolean {
  if (!range) return true;
  if (!value) return false;
  const t = new Date(value).getTime();
  return t >= range.from.getTime() && t <= range.to.getTime();
}
