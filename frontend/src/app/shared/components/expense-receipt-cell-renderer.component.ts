import { Component } from '@angular/core';
import { ICellRendererAngularComp } from 'ag-grid-angular';
import { ICellRendererParams } from 'ag-grid-community';
import { CommonModule } from '@angular/common';

export interface ExpenseReceiptCellParams extends ICellRendererParams {
  onOpenReceipt?: (urls: string[], index: number) => void;
}

@Component({
  selector: 'app-expense-receipt-cell-renderer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="receipt-cell-root" *ngIf="!params?.data?.isSummaryRow">
      <!-- Empty state when no receipt attached -->
      <div *ngIf="urls.length === 0" class="receipt-empty" title="No receipt attached">
        <span class="empty-dash">—</span>
      </div>

      <!-- Receipt interactive preview button/card -->
      <div 
        *ngIf="urls.length > 0" 
        class="receipt-card" 
        (click)="handleClick($event)" 
        [title]="cardTooltip">
        
        <!-- Thumbnail / Badge Area -->
        <div class="receipt-thumb-box" [class.is-doc]="!isImage">
          <!-- Image thumbnail with error fallback -->
          <ng-container *ngIf="isImage && !hasImageError">
            <img [src]="firstUrl" class="receipt-img" alt="Receipt" (error)="onImageError()" />
          </ng-container>

          <!-- Fallback when image error or doc types -->
          <div *ngIf="!isImage || hasImageError" class="receipt-icon-badge" [ngClass]="badgeClass">
            <svg *ngIf="isPdf" class="badge-svg" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <svg *ngIf="isSpreadsheet" class="badge-svg" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
              <line x1="3" x2="21" y1="9" y2="9"/>
              <line x1="3" x2="21" y1="15" y2="15"/>
              <line x1="9" x2="9" y1="3" y2="21"/>
              <line x1="15" x2="15" y1="3" y2="21"/>
            </svg>
            <svg *ngIf="!isPdf && !isSpreadsheet && !isImage" class="badge-svg" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <svg *ngIf="isImage && hasImageError" class="badge-svg" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>
              <circle cx="9" cy="9" r="2"/>
              <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
            </svg>
            <span class="badge-tag">{{ badgeLabel }}</span>
          </div>

          <!-- Multi-receipt count indicator badge -->
          <span *ngIf="urls.length > 1" class="multi-count-pill" title="{{ urls.length }} files attached">
            +{{ urls.length - 1 }}
          </span>
        </div>

        <!-- Text & Action Link -->
        <div class="receipt-info">
          <span class="receipt-action-label">{{ actionLabel }}</span>
          <svg class="receipt-external-icon" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" x2="21" y1="14" y2="3"/>
          </svg>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
    }
    .receipt-cell-root {
      display: flex;
      align-items: center;
      height: 100%;
      user-select: none;
    }
    .receipt-empty {
      display: inline-flex;
      align-items: center;
      color: #94A3B8;
      font-size: 13px;
      font-weight: 500;
      padding-left: 2px;
    }
    .receipt-card {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 3px 8px 3px 4px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s ease-in-out;
      max-width: 100%;
    }
    .receipt-card:hover {
      background: #EFF6FF;
      border-color: #BFDBFE;
      box-shadow: 0 1px 3px rgba(37, 99, 235, 0.08);
      transform: translateY(-0.5px);
    }
    .receipt-card:hover .receipt-action-label {
      color: #1D4ED8;
    }
    .receipt-card:hover .receipt-external-icon {
      color: #1D4ED8;
      transform: translate(1px, -1px);
    }
    .receipt-thumb-box {
      position: relative;
      width: 28px;
      height: 28px;
      min-width: 28px;
      border-radius: 6px;
      overflow: visible;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .receipt-img {
      width: 28px;
      height: 28px;
      min-width: 28px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid #CBD5E1;
      display: block;
      background: #FFFFFF;
      transition: transform 0.15s ease;
    }
    .receipt-card:hover .receipt-img {
      border-color: #93C5FD;
    }
    .receipt-icon-badge {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1px;
      padding: 1px;
    }
    .badge-pdf {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      color: #DC2626;
    }
    .badge-xls {
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      color: #059669;
    }
    .badge-doc {
      background: #F0F9FF;
      border: 1px solid #BAE6FD;
      color: #0284C7;
    }
    .badge-file {
      background: #F1F5F9;
      border: 1px solid #CBD5E1;
      color: #475569;
    }
    .badge-svg {
      flex-shrink: 0;
    }
    .badge-tag {
      font-size: 8px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0.02em;
    }
    .multi-count-pill {
      position: absolute;
      top: -4px;
      right: -5px;
      background: #2563EB;
      color: #FFFFFF;
      font-size: 8.5px;
      font-weight: 700;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 9999px;
      border: 1.5px solid #FFFFFF;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
      z-index: 2;
    }
    .receipt-info {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      overflow: hidden;
      white-space: nowrap;
    }
    .receipt-action-label {
      font-size: 11.5px;
      font-weight: 600;
      color: #2563EB;
      letter-spacing: -0.01em;
      transition: color 0.15s ease;
    }
    .receipt-external-icon {
      color: #3B82F6;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }
  `]
})
export class ExpenseReceiptCellRendererComponent implements ICellRendererAngularComp {
  params!: ExpenseReceiptCellParams;
  urls: string[] = [];
  firstUrl: string = '';
  isImage: boolean = false;
  isPdf: boolean = false;
  isSpreadsheet: boolean = false;
  hasImageError: boolean = false;
  badgeClass: string = 'badge-file';
  badgeLabel: string = 'FILE';
  actionLabel: string = 'View receipt';
  cardTooltip: string = '';

  agInit(params: ExpenseReceiptCellParams): void {
    this.params = params;
    this.parseUrls(params.value);
  }

  refresh(params: ExpenseReceiptCellParams): boolean {
    this.params = params;
    this.parseUrls(params.value);
    return true;
  }

  private parseUrls(val: any): void {
    this.hasImageError = false;
    let rawUrls: string[] = [];

    if (val) {
      if (Array.isArray(val)) {
        rawUrls = val;
      } else if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            rawUrls = Array.isArray(parsed) ? parsed : [trimmed];
          } catch {
            rawUrls = [trimmed];
          }
        } else {
          rawUrls = [trimmed];
        }
      }
    }

    this.urls = rawUrls.filter(u => typeof u === 'string' && u.trim().length > 0);
    this.firstUrl = this.urls[0] || '';

    if (!this.firstUrl) {
      this.cardTooltip = 'No receipt';
      return;
    }

    this.isPdf = /\.pdf(\?|#|$)/i.test(this.firstUrl);
    this.isSpreadsheet = /\.(xlsx?|csv)(\?|#|$)/i.test(this.firstUrl);
    this.isImage = /\.(jpe?g|png|gif|webp|svg|bmp)(\?|#|$)/i.test(this.firstUrl) || this.firstUrl.startsWith('data:image/');

    if (this.isPdf) {
      this.badgeClass = 'badge-pdf';
      this.badgeLabel = 'PDF';
      this.actionLabel = this.urls.length > 1 ? `${this.urls.length} docs` : 'Open PDF';
    } else if (this.isSpreadsheet) {
      this.badgeClass = 'badge-xls';
      this.badgeLabel = 'XLS';
      this.actionLabel = this.urls.length > 1 ? `${this.urls.length} sheets` : 'Open Excel';
    } else if (this.isImage) {
      this.badgeClass = 'badge-file';
      this.badgeLabel = 'IMG';
      this.actionLabel = this.urls.length > 1 ? `${this.urls.length} receipts` : 'View receipt';
    } else {
      this.badgeClass = 'badge-doc';
      this.badgeLabel = 'DOC';
      this.actionLabel = this.urls.length > 1 ? `${this.urls.length} files` : 'Open document';
    }

    this.cardTooltip = this.urls.length > 1
      ? `${this.urls.length} attached receipts/documents (Click to open)`
      : `Click to view attached receipt: ${this.firstUrl.split('/').pop()?.split('?')[0] || this.firstUrl}`;
  }

  onImageError(): void {
    this.hasImageError = true;
  }

  handleClick(event: MouseEvent): void {
    event.stopPropagation();
    if (this.params?.onOpenReceipt && this.urls.length > 0) {
      this.params.onOpenReceipt(this.urls, 0);
    }
  }
}
