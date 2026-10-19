import { Component, computed, HostListener, inject, Input, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import { WfhRequest, WfhService } from '../../services/wfh.service';
import { DialogService } from '../services/dialog.service';

/**
 * "Request WFH" (19 Oct 2026): the button, the request form, and my requests.
 * WFH used to be a leave type; it is its own request now, approved by the
 * reporting manager and then HR, with a monthly allowance set by HR here.
 */
@Component({
  selector: 'app-wfh-request',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Trigger Button -->
    <button type="button" class="wfh-trigger-btn" (click)="openForm()">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
      <span>Request WFH</span>
      <span class="wfh-trigger-pill" *ngIf="limit() > 0" [class.exhausted]="remainingQuota() === 0">
        {{ remainingQuota() }} left
      </span>
    </button>

    <!-- Modal Overlay -->
    <div class="wfh-overlay" *ngIf="open()" (click)="open.set(false)">
      <div class="wfh-dialog" (click)="$event.stopPropagation()" role="dialog" aria-modal="true" aria-labelledby="wfh-modal-title">

        <!-- 1. Modal Header -->
        <div class="wfh-modal-header">
          <div class="wfh-header-left">
            <div class="wfh-header-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </div>
            <div class="wfh-header-titles">
              <h3 id="wfh-modal-title">Work From Home</h3>
              <p>Request remote work &amp; track your approval status</p>
            </div>
          </div>

          <button type="button" class="wfh-close-btn" (click)="open.set(false)" aria-label="Close modal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div class="wfh-modal-body">
          <!-- 2. Monthly Quota & Allowance Card -->
          <div class="wfh-quota-card" [class.quota-full]="limit() > 0 && used() >= limit()" [class.quota-off]="limit() === 0">
            <div class="wfh-quota-top">
              <div class="wfh-quota-info">
                <span class="wfh-quota-kicker">Monthly Allowance</span>
                <p class="wfh-quota-desc">
                  <ng-container *ngIf="limit() === 0">
                    WFH requests are currently switched off by HR.
                  </ng-container>
                  <ng-container *ngIf="limit() > 0">
                    You can work from home <strong>{{ limit() }} {{ limit() === 1 ? 'day' : 'days' }}</strong> a month (pending or approved).
                  </ng-container>
                </p>
              </div>

              <div class="wfh-quota-badges" *ngIf="limit() > 0">
                <span class="wfh-usage-pill" [class.full]="used() >= limit()">
                  <strong>{{ used() }}</strong> of <strong>{{ limit() }}</strong> used
                </span>
                <span class="wfh-rem-text">
                  {{ remainingQuota() === 0 ? 'Quota reached this month' : remainingQuota() + ' remaining' }}
                </span>
              </div>
            </div>

            <!-- Progress Bar -->
            <div class="wfh-quota-track" *ngIf="limit() > 0">
              <div
                class="wfh-quota-fill"
                [class.full]="used() >= limit()"
                [style.width.%]="quotaPercent()">
              </div>
            </div>

            <!-- HR Admin Policy Controls (Inline) -->
            <div class="wfh-hr-policy-bar" *ngIf="canSetLimit">
              <div class="wfh-hr-label">
                <span class="hr-badge">HR Policy</span>
                <span>Monthly WFH allowance (days/month)</span>
              </div>
              <div class="wfh-hr-controls">
                <input type="number" min="0" max="31" class="wfh-limit-input" [(ngModel)]="limitInput" aria-label="WFH days allowed per month" />
                <button type="button" class="wfh-save-limit-btn" (click)="saveLimit()" [disabled]="busy()">
                  Save Limit
                </button>
              </div>
            </div>
          </div>

          <!-- 3. Two-Step Approval Pipeline Strip -->
          <div class="wfh-pipeline-bar">
            <div class="pipeline-step active">
              <span class="step-dot">1</span>
              <span class="step-label">You Submit</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="pipeline-arrow">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <div class="pipeline-step">
              <span class="step-dot">2</span>
              <span class="step-label">Reporting Manager</span>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="pipeline-arrow">
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
            <div class="pipeline-step">
              <span class="step-dot">3</span>
              <span class="step-label">HR Final Approval</span>
            </div>
          </div>

          <!-- 4. Request Form -->
          <div class="wfh-form-card">
            <!-- Date Picker + Quick Chips -->
            <div class="wfh-field-group">
              <div class="wfh-field-header">
                <label for="wfh-date-input" class="wfh-label">
                  <span>Work From Home Date <span class="req-star">*</span></span>
                </label>
                <div class="wfh-quick-dates">
                  <button type="button" class="quick-date-chip" [class.active]="date === today" (click)="setQuickDate(0)">Today</button>
                  <button type="button" class="quick-date-chip" [class.active]="date === tomorrowDate" (click)="setQuickDate(1)">Tomorrow</button>
                  <button type="button" class="quick-date-chip" [class.active]="date === nextMondayDate" (click)="setNextMonday()">Next Mon</button>
                </div>
              </div>

              <div class="wfh-date-input-wrap">
                <input
                  id="wfh-date-input"
                  type="date"
                  class="wfh-input"
                  [min]="today"
                  [(ngModel)]="date" />
                <span class="wfh-date-preview" *ngIf="date">
                  {{ date | date:'EEE, d MMM y' }}
                </span>
              </div>
            </div>

            <!-- Reason Field + Quick Suggestions -->
            <div class="wfh-field-group">
              <div class="wfh-field-header">
                <label for="wfh-reason-input" class="wfh-label">
                  <span>Reason <span class="req-star">*</span></span>
                </label>
                <span class="wfh-char-count">{{ reason.trim().length }} chars</span>
              </div>

              <textarea
                id="wfh-reason-input"
                rows="3"
                class="wfh-textarea"
                [(ngModel)]="reason"
                placeholder="Briefly state why you need to work from home…"></textarea>

              <div class="wfh-reason-chips">
                <span class="chips-prefix">Quick fill:</span>
                <button type="button" class="reason-chip" (click)="applyQuickReason('Personal / home commitment — available online for full shift')">Home commitment</button>
                <button type="button" class="reason-chip" (click)="applyQuickReason('Medical appointment / recovery — working remotely')">Medical / health</button>
                <button type="button" class="reason-chip" (click)="applyQuickReason('Commute / weather disruption — working full shift from home')">Commute / weather</button>
              </div>
            </div>

            <!-- Form Actions -->
            <div class="wfh-form-actions">
              <button type="button" class="wfh-btn-secondary" (click)="open.set(false)">
                Close
              </button>
              <button
                type="button"
                class="wfh-btn-primary"
                (click)="submit()"
                [disabled]="busy() || !date || !reason.trim() || limit() === 0">
                <svg *ngIf="!busy()" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
                <span>{{ busy() ? 'Sending Request…' : 'Send WFH Request' }}</span>
              </button>
            </div>
          </div>

          <!-- 5. My WFH Requests History -->
          <div class="wfh-history-section">
            <div class="wfh-history-header">
              <span class="wfh-history-title">My WFH Requests</span>
              <span class="wfh-history-count">{{ requests().length }}</span>
            </div>

            <!-- Empty State -->
            <div class="wfh-empty-state" *ngIf="!requests().length">
              <div class="wfh-empty-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
              <div class="wfh-empty-text">
                <strong>No WFH requests yet</strong>
                <span>Submitted remote work requests and their approval status will appear here.</span>
              </div>
            </div>

            <!-- Request Cards List -->
            <div class="wfh-requests-list" *ngIf="requests().length">
              <div class="wfh-req-card" *ngFor="let r of requests()" [class.is-cancelled]="r.status === 'CANCELLED'">
                <!-- Date Leaf Badge -->
                <div class="wfh-date-leaf">
                  <span class="leaf-month">{{ r.date | date:'MMM':'UTC' }}</span>
                  <span class="leaf-day">{{ r.date | date:'dd':'UTC' }}</span>
                </div>

                <!-- Request Details -->
                <div class="wfh-req-main">
                  <div class="wfh-req-top">
                    <strong class="wfh-req-date">{{ r.date | date:'EEE, d MMM y':'UTC' }}</strong>
                    <span class="wfh-status-pill s-{{ r.status }}">
                      <span class="status-dot"></span>
                      <span>{{ statusLabel(r.status) }}</span>
                    </span>
                  </div>

                  <p class="wfh-req-reason">{{ r.reason }}</p>

                  <!-- Rejection Note -->
                  <div *ngIf="r.reviewNote && r.status === 'REJECTED'" class="wfh-rejection-box">
                    <strong>Reason:</strong> &ldquo;{{ r.reviewNote }}&rdquo;
                  </div>
                </div>

                <!-- Cancel Button -->
                <button
                  type="button"
                  class="wfh-cancel-btn"
                  *ngIf="canCancel(r)"
                  (click)="cancel(r)"
                  title="Cancel this WFH request">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `,
  styles: [`
    /* ── Trigger Button ── */
    .wfh-trigger-btn {
      height: 40px;
      padding: 0 16px;
      border: 1px solid #a7f3d0;
      border-radius: 9999px;
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      color: #047857;
      font-family: inherit;
      font-weight: 700;
      font-size: 13.5px;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 2px 6px rgba(5, 150, 105, 0.1);
      transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .wfh-trigger-btn:hover {
      background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
      border-color: #6ee7b7;
      color: #065f46;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(5, 150, 105, 0.18);
    }

    .wfh-trigger-pill {
      font-size: 11px;
      font-weight: 800;
      padding: 1px 7px;
      border-radius: 9999px;
      background: rgba(5, 150, 105, 0.14);
      color: #065f46;
      font-variant-numeric: tabular-nums;
    }

    .wfh-trigger-pill.exhausted {
      background: #fef3c7;
      color: #92400e;
    }

    /* ── Modal Overlay & Dialog ── */
    .wfh-overlay {
      position: fixed;
      inset: 0;
      z-index: 1300;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      animation: wfhFadeIn 0.16s ease-out;
    }

    @keyframes wfhFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .wfh-dialog {
      width: min(540px, 100%);
      max-height: calc(100vh - 32px);
      background: #ffffff;
      border-radius: 20px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 24px 48px -12px rgba(15, 23, 42, 0.25);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: wfhSlideUp 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes wfhSlideUp {
      from { opacity: 0; transform: translateY(10px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ── 1. Modal Header ── */
    .wfh-modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 18px 22px;
      border-bottom: 1px solid #f1f5f9;
      background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
    }

    .wfh-header-left {
      display: flex;
      align-items: center;
      gap: 13px;
    }

    .wfh-header-icon {
      width: 42px;
      height: 42px;
      border-radius: 12px;
      background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%);
      border: 1px solid #a7f3d0;
      color: #059669;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .wfh-header-titles h3 {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.3px;
    }

    .wfh-header-titles p {
      margin: 2px 0 0;
      font-size: 12.5px;
      color: #64748b;
    }

    .wfh-close-btn {
      width: 34px;
      height: 34px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #ffffff;
      color: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .wfh-close-btn:hover {
      background: #f1f5f9;
      color: #0f172a;
      border-color: #cbd5e1;
    }

    /* ── Scrollable Body ── */
    .wfh-modal-body {
      padding: 18px 22px 22px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* ── 2. Monthly Quota Card ── */
    .wfh-quota-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 13px 15px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .wfh-quota-card.quota-full {
      background: #fffbeb;
      border-color: #fde68a;
    }

    .wfh-quota-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .wfh-quota-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .wfh-quota-kicker {
      font-size: 10.5px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }

    .wfh-quota-desc {
      margin: 0;
      font-size: 12.5px;
      color: #334155;
      line-height: 1.4;
    }

    .wfh-quota-badges {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 3px;
      flex-shrink: 0;
    }

    .wfh-usage-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
      font-variant-numeric: tabular-nums;
    }

    .wfh-usage-pill.full {
      background: #fef3c7;
      color: #b45309;
      border-color: #fcd34d;
    }

    .wfh-rem-text {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
    }

    .wfh-quota-track {
      height: 6px;
      width: 100%;
      background: #e2e8f0;
      border-radius: 9999px;
      overflow: hidden;
    }

    .wfh-quota-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981 0%, #059669 100%);
      border-radius: 9999px;
      transition: width 0.35s ease;
    }

    .wfh-quota-fill.full {
      background: linear-gradient(90deg, #f59e0b 0%, #d97706 100%);
    }

    /* HR Admin Policy Row */
    .wfh-hr-policy-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding-top: 10px;
      border-top: 1px dashed #cbd5e1;
      flex-wrap: wrap;
    }

    .wfh-hr-label {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }

    .hr-badge {
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding: 2px 6px;
      border-radius: 5px;
      background: #e0e7ff;
      color: #3730a3;
    }

    .wfh-hr-controls {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .wfh-limit-input {
      width: 64px;
      height: 32px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0 8px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      background: #ffffff;
      text-align: center;
    }

    .wfh-save-limit-btn {
      height: 32px;
      padding: 0 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #ffffff;
      color: #0f172a;
      font-family: inherit;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .wfh-save-limit-btn:hover:not(:disabled) {
      background: #0f172a;
      color: #ffffff;
      border-color: #0f172a;
    }

    /* ── 3. Approval Pipeline Strip ── */
    .wfh-pipeline-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 9px 14px;
      background: #eff6ff;
      border: 1px solid #dbeafe;
      border-radius: 11px;
    }

    .pipeline-step {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 600;
      color: #475569;
    }

    .pipeline-step.active {
      color: #1e40af;
      font-weight: 700;
    }

    .step-dot {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 10.5px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .pipeline-step.active .step-dot {
      background: #2563eb;
      color: #ffffff;
    }

    .pipeline-arrow {
      color: #93c5fd;
      flex-shrink: 0;
    }

    /* ── 4. Request Form Card ── */
    .wfh-form-card {
      display: flex;
      flex-direction: column;
      gap: 14px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 15px;
    }

    .wfh-field-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .wfh-field-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    .wfh-label {
      margin: 0;
      font-size: 12.5px;
      font-weight: 700;
      color: #1e293b;
    }

    .req-star {
      color: #ef4444;
    }

    .wfh-quick-dates {
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .quick-date-chip {
      padding: 2px 9px;
      border-radius: 9999px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #475569;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.14s ease;
    }

    .quick-date-chip:hover {
      border-color: #cbd5e1;
      color: #0f172a;
    }

    .quick-date-chip.active {
      background: #eff6ff;
      border-color: #60a5fa;
      color: #1d4ed8;
      font-weight: 700;
    }

    .wfh-date-input-wrap {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .wfh-input {
      flex: 1;
      height: 40px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 0 12px;
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 600;
      color: #0f172a;
      background: #ffffff;
      transition: all 0.15s ease;
    }

    .wfh-input:focus,
    .wfh-textarea:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }

    .wfh-date-preview {
      font-size: 12px;
      font-weight: 700;
      color: #047857;
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      padding: 6px 11px;
      border-radius: 8px;
      white-space: nowrap;
    }

    .wfh-char-count {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 500;
    }

    .wfh-textarea {
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 10px 12px;
      font-family: inherit;
      font-size: 13.5px;
      color: #0f172a;
      resize: vertical;
      min-height: 72px;
      transition: all 0.15s ease;
    }

    .wfh-reason-chips {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 2px;
    }

    .chips-prefix {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
    }

    .reason-chip {
      padding: 3px 9px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      color: #475569;
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.14s ease;
    }

    .reason-chip:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #0f172a;
    }

    .wfh-form-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 4px;
    }

    .wfh-btn-secondary {
      height: 38px;
      padding: 0 16px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      background: #ffffff;
      color: #475569;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .wfh-btn-secondary:hover {
      background: #f8fafc;
      color: #0f172a;
    }

    .wfh-btn-primary {
      height: 38px;
      padding: 0 18px;
      border: none;
      border-radius: 10px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      color: #ffffff;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
      transition: all 0.16s ease;
    }

    .wfh-btn-primary:hover:not(:disabled) {
      background: linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%);
      transform: translateY(-1px);
    }

    .wfh-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* ── 5. My WFH Requests History Section ── */
    .wfh-history-section {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding-top: 4px;
    }

    .wfh-history-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .wfh-history-title {
      font-size: 11.5px;
      font-weight: 800;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #64748b;
    }

    .wfh-history-count {
      font-size: 11px;
      font-weight: 800;
      padding: 1px 8px;
      border-radius: 9999px;
      background: #f1f5f9;
      color: #475569;
    }

    .wfh-empty-state {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 16px;
      background: #f8fafc;
      border: 1px dashed #cbd5e1;
      border-radius: 12px;
    }

    .wfh-empty-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .wfh-empty-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .wfh-empty-text strong {
      font-size: 13px;
      color: #334155;
    }

    .wfh-empty-text span {
      font-size: 12px;
      color: #64748b;
    }

    .wfh-requests-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .wfh-req-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 11px 13px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      transition: all 0.15s ease;
    }

    .wfh-req-card:hover {
      background: #ffffff;
      border-color: #cbd5e1;
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04);
    }

    .wfh-req-card.is-cancelled {
      opacity: 0.65;
    }

    .wfh-date-leaf {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }

    .leaf-month {
      font-size: 9.5px;
      font-weight: 800;
      text-transform: uppercase;
      color: #2563eb;
      letter-spacing: 0.04em;
      line-height: 1;
    }

    .leaf-day {
      font-size: 15px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.25;
      font-variant-numeric: tabular-nums;
    }

    .wfh-req-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .wfh-req-top {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .wfh-req-date {
      font-size: 13.5px;
      font-weight: 700;
      color: #0f172a;
    }

    .wfh-req-reason {
      margin: 0;
      font-size: 12.5px;
      color: #475569;
      line-height: 1.35;
      word-break: break-word;
    }

    .wfh-rejection-box {
      margin-top: 3px;
      font-size: 11.5px;
      color: #b91c1c;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 4px 8px;
    }

    .wfh-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 9px;
      border-radius: 9999px;
      background: #f1f5f9;
      color: #475569;
      white-space: nowrap;
    }

    .wfh-status-pill .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .wfh-status-pill.s-PENDING_MANAGER {
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
    }

    .wfh-status-pill.s-PENDING_HR {
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
    }

    .wfh-status-pill.s-APPROVED {
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
    }

    .wfh-status-pill.s-REJECTED {
      background: #fef2f2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }

    .wfh-status-pill.s-CANCELLED {
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #cbd5e1;
    }

    .wfh-cancel-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 30px;
      padding: 0 10px;
      border: 1px solid #fecaca;
      border-radius: 8px;
      background: #ffffff;
      color: #dc2626;
      font-family: inherit;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }

    .wfh-cancel-btn:hover {
      background: #fef2f2;
      border-color: #f87171;
    }
  `],
})
export class WfhRequestComponent implements OnInit {
  private api = inject(WfhService);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);

  /** HR and admins can change the monthly allowance from the same dialog. */
  @Input() canSetLimit = false;

  open = signal(false);
  busy = signal(false);
  limit = signal(1);
  used = signal(0);
  requests = signal<WfhRequest[]>([]);

  today = this.offsetDateStr(0);
  tomorrowDate = this.offsetDateStr(1);
  nextMondayDate = this.computeNextMondayStr();

  date = '';
  reason = '';
  limitInput = 1;

  remainingQuota = computed(() => Math.max(0, this.limit() - this.used()));
  quotaPercent = computed(() => {
    const l = this.limit();
    if (l <= 0) return 0;
    return Math.min(100, Math.round((this.used() / l) * 100));
  });

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) {
      this.open.set(false);
    }
  }

  ngOnInit() {
    this.load();
  }

  private offsetDateStr(days: number): string {
    const d = new Date(Date.now() + 330 * 60_000);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private computeNextMondayStr(): string {
    const d = new Date(Date.now() + 330 * 60_000);
    const day = d.getUTCDay();
    const diff = day === 0 ? 1 : 8 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  setQuickDate(offsetDays: number) {
    this.date = this.offsetDateStr(offsetDays);
  }

  setNextMonday() {
    this.date = this.nextMondayDate;
  }

  applyQuickReason(text: string) {
    this.reason = text;
  }

  load() {
    this.api.mine().subscribe({
      next: (r) => {
        this.limit.set(r.limit);
        this.limitInput = r.limit;
        this.used.set(r.usedThisMonth);
        this.requests.set(r.requests || []);
      },
      error: () => {},
    });
  }

  openForm() {
    this.date = this.today;
    this.reason = '';
    this.load();
    this.open.set(true);
  }

  submit() {
    if (!this.date || !this.reason.trim()) return;
    this.busy.set(true);
    this.api.create(this.date, this.reason.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success('WFH request sent to your manager');
        this.reason = '';
        this.load();
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.error(e.error?.message || 'Could not send the request');
      },
    });
  }

  async cancel(r: WfhRequest) {
    const confirmed = await this.dialog.confirm(
      'Are you sure you want to cancel this Work From Home request?',
      'Cancel WFH Request',
      'Yes, Cancel Request',
      'Keep Request',
      'danger'
    );
    if (!confirmed) return;
    this.api.cancel(r.id).subscribe({
      next: () => {
        this.toast.success('WFH request cancelled');
        this.load();
      },
      error: (e) => this.toast.error(e.error?.message || 'Could not cancel'),
    });
  }

  saveLimit() {
    this.busy.set(true);
    this.api.saveSettings(Number(this.limitInput)).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.limit.set(r.wfhDaysPerMonth);
        this.toast.success('WFH limit saved');
      },
      error: (e) => {
        this.busy.set(false);
        this.toast.error(e.error?.message || 'Could not save');
      },
    });
  }

  canCancel(r: WfhRequest) {
    return (
      r.status === 'PENDING_MANAGER' ||
      r.status === 'PENDING_HR' ||
      (r.status === 'APPROVED' && r.date.slice(0, 10) >= this.today)
    );
  }

  statusLabel(s: string) {
    return (
      ({
        PENDING_MANAGER: 'With Manager',
        PENDING_HR: 'With HR',
        APPROVED: 'Approved',
        REJECTED: 'Rejected',
        CANCELLED: 'Cancelled',
      } as any)[s] ?? s
    );
  }
}
