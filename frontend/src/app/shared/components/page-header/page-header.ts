import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * One page header for the Employee pages (12 Nov 2026), the way Google Admin,
 * HubSpot and Zoho lay it out: a small breadcrumb, the title and a one-line
 * subtitle on the left, the page's buttons on the right. Put buttons inside
 * the tag: view toggles first, outlined buttons next, the one blue primary
 * button last (rightmost).
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="ph">
      <button type="button" class="ph-back" *ngIf="showBack" (click)="back.emit()" [attr.aria-label]="backLabel" [attr.title]="backLabel">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </button>
      <div class="ph-icon" *ngIf="icon" aria-hidden="true">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path *ngFor="let d of iconPaths()" [attr.d]="d"></path>
        </svg>
      </div>
      <div class="ph-text">
        <h1>
          <ng-container *ngIf="section"><span class="ph-section">{{ section }}</span><span class="ph-sep" aria-hidden="true">›</span></ng-container>{{ heading }}
        </h1>
        <p *ngIf="subtitle">{{ subtitle }}</p>
      </div>
      <div class="ph-actions"><ng-content></ng-content></div>
    </header>
  `,
  styles: [`
    .ph { position: relative; overflow: visible; z-index: 20; display: flex; align-items: center; gap: 18px; flex-wrap: wrap; margin-bottom: 16px; padding: 15px; background: radial-gradient(circle at 40px 40px, rgba(37, 99, 235, .05) 0 80px, transparent 81px), linear-gradient(100deg, #f5f8ff 0%, #ffffff 45%); border: 1px solid #e6ebf5; border-radius: 16px; box-shadow: 0 1px 2px rgba(15, 23, 42, .04); }
    .ph::before { content: none; }
    .ph-back { position: relative; flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; border: 1px solid #e2e8f0; background: #fff; color: #334155; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; margin-right: -6px; }
    .ph-back:hover { background: #f1f5f9; color: #0f172a; }
    .ph-icon { position: relative; flex-shrink: 0; width: 50px; height: 50px; border-radius: 50%; background: #e8efff; color: #2563eb; display: flex; align-items: center; justify-content: center; font-weight: bold; }
    .ph-text { position: relative; flex: 1; min-width: 220px; }
    h1 { font-family: var(--font-heading); display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 0; font-size: 16px; font-weight: 900; letter-spacing: -0.2px; color: #0f172a; }
    .ph-section { font-weight: 400; color: #64748b; font-size: 14px; }
    .ph-sep { color: #94a3b8; font-weight: 400; font-size: 14px; }
    p { color: #64748b; margin: 4px 0 0; font-size: 11px; }
    .ph-actions { position: relative; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    @media (max-width: 760px) { .ph { padding: 14px 16px; } .ph-icon { width: 44px; height: 44px; } .ph-actions { width: 100%; } }
  `],
})
export class PageHeaderComponent {
  /** Menu the page sits under, e.g. "Employees". */
  @Input() section = '';
  /** A round back arrow before the title (12 Nov 2026), e.g. back to the job. */
  @Input() showBack = false;
  @Input() backLabel = 'Back';
  @Output() back = new EventEmitter<void>();
  /** Not `title`: that would also become the browser's hover tooltip. */
  @Input() heading = '';
  /** Round icon on the left: users, onboarding, documents, completion, org, award, trophy, megaphone, offboarding, wallet. */
  @Input() icon: '' | 'users' | 'onboarding' | 'documents' | 'completion' | 'org' | 'profile' | 'jobs' | 'chart' | 'calendar' | 'target' | 'award' | 'trophy' | 'megaphone' | 'offboarding' | 'wallet' = '';

  iconPaths(): string[] {
    switch (this.icon) {
      case 'users': return ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'];
      case 'onboarding': return ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M19 8v6', 'M22 11h-6'];
      case 'documents': return ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M16 13H8', 'M16 17H8'];
      case 'completion': return ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4 12 14.01l-3-3'];
      case 'org': return ['M9 3h6v4H9z', 'M3 17h6v4H3z', 'M15 17h6v4h-6z', 'M12 7v5', 'M6 17v-2.5h12V17'];
      case 'profile': return ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'];
      case 'jobs': return ['M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', 'M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z'];
      case 'chart': return ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'];
      case 'calendar': return ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'];
      case 'target': return ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'];
      case 'award': return ['M12 15a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M8.21 13.89 7 23l5-3 5 3-1.21-9.12'];
      case 'trophy': return ['M6 9H4.5a2.5 2.5 0 0 1 0-5H6', 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18', 'M4 22h16', 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22', 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22', 'M18 2H6v7a6 6 0 0 0 12 0V2Z'];
      case 'megaphone': return ['m3 11 18-5v12L3 14v-3z', 'M11.6 16.8a3 3 0 1 1-5.8-1.6'];
      case 'offboarding': return ['M13 4h3a2 2 0 0 1 2 2v14', 'M2 20h3', 'M13 20h9', 'M10 12v.01', 'M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z'];
      case 'wallet': return ['M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1', 'M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4'];
      default: return [];
    }
  }
  @Input() subtitle = '';
}
