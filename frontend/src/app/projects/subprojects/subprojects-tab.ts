import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import { ProjectsService } from '../../services/projects';
import { EmployeeService } from '../../services/employee.service';
import { DialogService } from '../../shared/services/dialog.service';
import {
  LucideLayers,
  LucideFolder,
  LucideGitBranch,
  LucidePlus,
  LucideLink,
  LucideArrowUpRight,
  LucideCheckSquare,
  LucideUsers,
  LucideCheck,
  LucideInfo,
  LucideCoins,
  LucideSplit,
  LucidePencil,
  LucideUnlink,
  LucideAlertTriangle,
  LucideX,
  LucideArrowRight,
  LucideClock,
} from '@lucide/angular';

/**
 * Subprojects of a parent project: ABC holds ABC-A, ABC-B, ABC-C.
 *
 * Everyone who can see the parent sees its subprojects listed; only an
 * administrator creates one, adds an existing project, changes a sub code,
 * detaches one, or switches the parent between separate and shared budgets.
 */
@Component({
  selector: 'app-subprojects-tab',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    LucideLayers,
    LucideFolder,
    LucideGitBranch,
    LucidePlus,
    LucideLink,
    LucideArrowUpRight,
    LucideCheckSquare,
    LucideUsers,
    LucideCheck,
    LucideInfo,
    LucideCoins,
    LucideSplit,
    LucidePencil,
    LucideUnlink,
    LucideAlertTriangle,
    LucideX,
    LucideArrowRight,
    LucideClock,
  ],
  template: `
    @if (project(); as p) {
      <div class="sp-container">
        <!-- Master / Parent Project Hero Banner -->
        <div class="sp-parent-card">
          <div class="sp-parent-main">
            <div class="sp-parent-icon-box">
              <svg lucideLayers [size]="22"></svg>
            </div>
            <div class="sp-parent-details">
              <div class="sp-parent-tag-row">
                <span class="sp-master-badge">
                  <span class="sp-master-dot"></span>
                  MASTER PROJECT
                </span>
                <span class="sp-parent-code-chip">{{ p.key }}</span>
              </div>
              <h2 class="sp-parent-title">{{ p.name }}</h2>
              <div class="sp-parent-meta">
                <span>Parent code: <strong>{{ p.key }}</strong></span>
                <span class="meta-dot">·</span>
                <span>
                  <strong>{{ (p.subprojects || []).length }}</strong> 
                  connected subproject{{ (p.subprojects || []).length === 1 ? '' : 's' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Budget Mode Controls -->
          <div class="sp-parent-controls">
            <div class="sp-mode-container">
              <div class="sp-mode-top">
                <svg lucideCoins [size]="14" class="text-indigo-600"></svg>
                <span class="sp-mode-title">Budget Allocation</span>
              </div>
              @if (isAdmin()) {
                <div class="sp-mode-toggle" title="Select how subprojects handle their budgets">
                  <button 
                    type="button" 
                    class="mode-btn" 
                    [class.active]="mode() === 'SEPARATE'" 
                    (click)="setMode('SEPARATE')" 
                    [disabled]="busy()">
                    <svg lucideSplit [size]="13"></svg>
                    <span>Separate</span>
                  </button>
                  <button 
                    type="button" 
                    class="mode-btn" 
                    [class.active]="mode() === 'SHARED'" 
                    (click)="setMode('SHARED')" 
                    [disabled]="busy()">
                    <svg lucideCoins [size]="13"></svg>
                    <span>Shared</span>
                  </button>
                </div>
              } @else {
                <span class="sp-mode-readonly">
                  <span class="ro-dot"></span>
                  {{ mode() === 'SHARED' ? 'Shared Master Budget' : 'Separate Subproject Budgets' }}
                </span>
              }
            </div>
          </div>
        </div>

        <!-- Budget Strategy Info Callout -->
        <div class="sp-info-callout" [class.shared]="mode() === 'SHARED'">
          <div class="callout-icon">
            <svg lucideInfo [size]="16"></svg>
          </div>
          <div class="callout-content">
            <span class="callout-strategy">
              {{ mode() === 'SHARED' ? 'Shared Budget Strategy' : 'Separate Budgets Strategy' }}:
            </span>
            {{ mode() === 'SHARED'
              ? 'All subprojects draw from ' + p.key + '’s master budget pool. The Summary tab counts collective spend against it.'
              : 'Each subproject maintains an independent budget. ' + p.key + '’s Summary tab displays the combined portfolio total.' }}
          </div>
        </div>

        <!-- Section Bar: Title & Action Buttons -->
        <div class="sp-section-bar">
          <div class="sp-section-title-wrap">
            <div class="sp-tree-icon-badge">
              <svg lucideGitBranch [size]="16"></svg>
            </div>
            <div class="sp-section-heading-group">
              <div class="sp-heading-with-count">
                <h3>Subprojects Hierarchy</h3>
                <span class="sp-count-pill">{{ (p.subprojects || []).length }}</span>
              </div>
              <p class="sp-section-sub">Autonomous task boards and delivery pipelines organized under {{ p.key }}</p>
            </div>
          </div>

          @if (isAdmin()) {
            <div class="sp-action-btns">
              <button type="button" class="btn-sp primary" (click)="openForm('new')">
                <svg lucidePlus [size]="15"></svg>
                <span>New Subproject</span>
              </button>
              <button type="button" class="btn-sp outline" (click)="openForm('attach')">
                <svg lucideLink [size]="14"></svg>
                <span>Add Existing Project</span>
              </button>
            </div>
          }
        </div>

        <!-- Form: New Subproject -->
        @if (form() === 'new') {
          <div class="sp-form-card">
            <div class="sp-form-header">
              <div class="form-title-wrap">
                <div class="form-icon-badge new">
                  <svg lucidePlus [size]="16"></svg>
                </div>
                <div>
                  <h4>Create New Subproject under {{ p.key }}</h4>
                  <p class="form-subtitle">Sets up a new child workspace linked directly to this master project.</p>
                </div>
              </div>
              <button type="button" class="form-close-btn" (click)="form.set(null)" [disabled]="busy()" title="Close form">
                <svg lucideX [size]="16"></svg>
              </button>
            </div>

            <div class="sp-form-body">
              <div class="sp-form-grid">
                <div class="sp-form-field">
                  <label class="sp-label">Subproject Name <span class="req">*</span></label>
                  <input 
                    class="sp-input"
                    [value]="name()" 
                    (input)="name.set($any($event.target).value)" 
                    placeholder="e.g. Mobile Application / Phase 1" />
                </div>

                <div class="sp-form-field">
                  <label class="sp-label">Sub Code Identifier <span class="req">*</span></label>
                  <div class="sp-code-group">
                    <input 
                      class="sp-input code-input"
                      [value]="subCode()" 
                      (input)="subCode.set($any($event.target).value.toUpperCase())" 
                      placeholder="A" 
                      maxlength="10" />
                    <div class="sp-generated-preview">
                      <span class="preview-label">Generated Key:</span>
                      <strong class="preview-key">{{ p.key }}-{{ subCode() || '…' }}</strong>
                    </div>
                  </div>
                </div>

                <div class="sp-form-field">
                  <label class="sp-label">Project Manager <span class="req">*</span></label>
                  <select class="sp-select" (change)="pmId.set(+$any($event.target).value || null)">
                    <option value="">Choose Project Manager…</option>
                    @for (e of employees(); track e.id) { 
                      <option [value]="e.id">{{ e.firstName }} {{ e.lastName }}</option> 
                    }
                  </select>
                </div>

                @if (mode() === 'SEPARATE') {
                  <div class="sp-form-field">
                    <label class="sp-label">Allocated Budget ({{ p.currency || 'INR' }})</label>
                    <div class="sp-curr-wrapper">
                      <span class="curr-sign">{{ p.currency === 'USD' ? '$' : p.currency === 'EUR' ? '€' : '₹' }}</span>
                      <input 
                        type="number" 
                        min="0" 
                        class="sp-input curr-input"
                        [value]="budget() ?? ''" 
                        (input)="budget.set($any($event.target).value === '' ? null : +$any($event.target).value)" 
                        placeholder="e.g. 500000" />
                    </div>
                  </div>
                }
              </div>

              <div class="sp-form-callout">
                <svg lucideInfo [size]="15"></svg>
                <span>Timeline dates, department, category, and client are cloned from <strong>{{ p.key }}</strong> and can be modified on the subproject board anytime.</span>
              </div>
            </div>

            <div class="sp-form-footer">
              <button type="button" class="btn-form-cancel" (click)="form.set(null)" [disabled]="busy()">Cancel</button>
              <button 
                type="button" 
                class="btn-form-submit primary" 
                (click)="create()" 
                [disabled]="busy() || !name().trim() || !subCode().trim() || !pmId()">
                <svg lucidePlus [size]="14" *ngIf="!busy()"></svg>
                <span>{{ busy() ? 'Creating Subproject…' : 'Create Subproject' }}</span>
              </button>
            </div>
          </div>
        }

        <!-- Form: Attach Existing Standalone Project -->
        @if (form() === 'attach') {
          <div class="sp-form-card attach">
            <div class="sp-form-header">
              <div class="form-title-wrap">
                <div class="form-icon-badge attach">
                  <svg lucideLink [size]="16"></svg>
                </div>
                <div>
                  <h4>Add Existing Standalone Project under {{ p.key }}</h4>
                  <p class="form-subtitle">Converts an independent project into a structured subproject under this parent.</p>
                </div>
              </div>
              <button type="button" class="form-close-btn" (click)="form.set(null)" [disabled]="busy()" title="Close form">
                <svg lucideX [size]="16"></svg>
              </button>
            </div>

            <div class="sp-form-body">
              <div class="sp-form-grid">
                <div class="sp-form-field">
                  <label class="sp-label">Select Project to Attach <span class="req">*</span></label>
                  <select class="sp-select" (change)="attachId.set(+$any($event.target).value || null)">
                    <option value="">Choose an existing project…</option>
                    @for (o of attachable(); track o.id) { 
                      <option [value]="o.id">{{ o.key }} — {{ o.name }}</option> 
                    }
                  </select>
                </div>

                <div class="sp-form-field">
                  <label class="sp-label">Sub Code Identifier <span class="req">*</span></label>
                  <div class="sp-code-group">
                    <input 
                      class="sp-input code-input"
                      [value]="subCode()" 
                      (input)="subCode.set($any($event.target).value.toUpperCase())" 
                      placeholder="B" 
                      maxlength="10" />
                    <div class="sp-generated-preview">
                      <span class="preview-label">New Subproject Key:</span>
                      <strong class="preview-key">{{ p.key }}-{{ subCode() || '…' }}</strong>
                    </div>
                  </div>
                </div>
              </div>

              <div class="sp-form-callout warn">
                <svg lucideAlertTriangle [size]="16"></svg>
                <span>
                  <strong>Important Notice:</strong> The attached project’s code and all associated task IDs will seamlessly migrate to 
                  <strong>{{ p.key }}-{{ subCode() || 'B' }}-#</strong>. Existing URLs and links will redirect automatically.
                </span>
              </div>
            </div>

            <div class="sp-form-footer">
              <button type="button" class="btn-form-cancel" (click)="form.set(null)" [disabled]="busy()">Cancel</button>
              <button 
                type="button" 
                class="btn-form-submit attach" 
                (click)="attach()" 
                [disabled]="busy() || !attachId() || !subCode().trim()">
                <svg lucideLink [size]="14" *ngIf="!busy()"></svg>
                <span>{{ busy() ? 'Connecting Subproject…' : 'Attach as Subproject' }}</span>
              </button>
            </div>
          </div>
        }

        <!-- Subprojects Hierarchy Tree List -->
        <div class="sp-tree-container">
          @for (c of p.subprojects || []; track c.id) {
            <div class="sp-tree-item">
              <!-- Visual Branch Connector -->
              <div class="sp-branch-line" aria-hidden="true">
                <svg width="24" height="48" viewBox="0 0 24 48" fill="none">
                  <path d="M6 0v24a10 10 0 0 0 10 10h8" stroke="#cbd5e1" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
              </div>

              <!-- Subproject Card -->
              <div 
                class="sp-card" 
                (click)="open(c.id)" 
                (auxclick)="onCardAuxClick($event, c.id)">
                
                <div class="sp-card-content">
                  <!-- Header: Code chip, Title with external icon, Level pill, Status badge -->
                  <div class="sp-card-header">
                    <div class="sp-card-title-group">
                      <span class="sp-subcode-chip">{{ c.key }}</span>
                      
                      <a 
                        class="sp-card-link" 
                        [routerLink]="['/projects', c.id]" 
                        (click)="$event.stopPropagation(); open(c.id)"
                        title="Open subproject board">
                        <span class="sp-card-name-text">{{ c.name }}</span>
                        <svg lucideArrowUpRight [size]="15" class="sp-ext-icon"></svg>
                      </a>

                      <span class="sp-sub-level-badge">SUBPROJECT {{ c.subCode }}</span>
                    </div>

                    <div class="sp-card-status-wrap">
                      <span class="sp-status-chip" [ngStyle]="getStatusStyle(c.workStatus)">
                        <span class="status-pulse-dot" [style.background]="getStatusDot(c.workStatus)"></span>
                        {{ formatStatus(c.workStatus) }}
                      </span>
                    </div>
                  </div>

                  <!-- Details Row: Tasks count, PM info, and Action buttons -->
                  <div class="sp-card-footer">
                    <div class="sp-card-meta-chips">
                      <!-- Tasks Count Chip -->
                      <div class="sp-meta-chip">
                        <div class="meta-chip-icon">
                          <svg lucideCheckSquare [size]="13"></svg>
                        </div>
                        <span class="meta-chip-text">
                          <strong>{{ c._count?.issues ?? 0 }}</strong> task{{ c._count?.issues === 1 ? '' : 's' }}
                        </span>
                      </div>

                      <!-- Project Manager Chip -->
                      <div class="sp-meta-chip pm">
                        <div class="sp-pm-avatar" [style.background]="getAvatarBg(pmNames(c))">
                          {{ getPmInitial(c) }}
                        </div>
                        <span class="meta-chip-text">
                          PM: <strong>{{ pmNames(c) || 'Unassigned' }}</strong>
                        </span>
                      </div>

                      <!-- Progress Indicator (if available) -->
                      @if (c.progress != null && c.progress > 0) {
                        <div class="sp-meta-chip progress-chip">
                          <div class="sp-progress-track">
                            <div class="sp-progress-fill" [style.width.%]="c.progress"></div>
                          </div>
                          <span class="progress-pct">{{ c.progress }}%</span>
                        </div>
                      }
                    </div>

                    <!-- Admin Row Actions -->
                    @if (isAdmin()) {
                      <div class="sp-card-actions">
                        <button 
                          type="button" 
                          class="sp-action-btn edit" 
                          (click)="$event.stopPropagation(); renameSub(c)" 
                          title="Change subproject identifier code">
                          <svg lucidePencil [size]="12"></svg>
                          <span>Change code</span>
                        </button>
                        <button 
                          type="button" 
                          class="sp-action-btn danger" 
                          (click)="$event.stopPropagation(); detach(c)" 
                          title="Detach from parent project">
                          <svg lucideUnlink [size]="12"></svg>
                          <span>Detach</span>
                        </button>
                      </div>
                    }
                  </div>
                </div>
              </div>
            </div>
          } @empty {
            <!-- Empty State Card -->
            <div class="sp-empty-card">
              <div class="sp-empty-icon-box">
                <svg lucideLayers [size]="30"></svg>
              </div>
              <h4 class="sp-empty-title">No Subprojects Connected Yet</h4>
              <p class="sp-empty-desc">
                Divide <strong>{{ p.name }}</strong> into structured, modular subprojects. Each subproject maintains its own board, milestones, and issues while synchronizing into this master project.
              </p>
              @if (isAdmin()) {
                <div class="sp-empty-buttons">
                  <button type="button" class="btn-sp primary" (click)="openForm('new')">
                    <svg lucidePlus [size]="15"></svg>
                    <span>Create First Subproject</span>
                  </button>
                  <button type="button" class="btn-sp outline" (click)="openForm('attach')">
                    <svg lucideLink [size]="14"></svg>
                    <span>Add Existing Project</span>
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .sp-container {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 1100px;
      margin: 0;
      padding: 4px 0 32px 0;
      box-sizing: border-box;
      font-family: inherit;
    }

    /* ── Master Project Hero Banner ── */
    .sp-parent-card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
      background: linear-gradient(135deg, #ffffff 0%, #f8faff 100%);
      border: 1px solid #e0e7ff;
      border-radius: 16px;
      padding: 20px 24px;
      box-shadow: 0 4px 16px -2px rgba(99, 102, 241, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04);
      position: relative;
      overflow: hidden;
    }

    .sp-parent-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 4px;
      height: 100%;
      background: linear-gradient(180deg, #4f46e5 0%, #3b82f6 100%);
    }

    .sp-parent-main {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
      flex: 1;
    }

    .sp-parent-icon-box {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
    }

    .sp-parent-details {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .sp-parent-tag-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sp-master-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 8px;
      background: rgba(79, 70, 229, 0.08);
      color: #4338ca;
      border: 1px solid rgba(79, 70, 229, 0.16);
      border-radius: 999px;
      font-size: 10px;
      font-weight: 750;
      letter-spacing: 0.04em;
    }

    .sp-master-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4f46e5;
    }

    .sp-parent-code-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 700;
      color: #334155;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 1px 7px;
    }

    .sp-parent-title {
      margin: 0;
      font-size: 17px;
      font-weight: 750;
      color: #0f172a;
      line-height: 1.3;
      word-break: break-word;
    }

    .sp-parent-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12.5px;
      color: #64748b;
    }

    .meta-dot {
      color: #cbd5e1;
      font-weight: bold;
    }

    /* ── Budget Mode Box ── */
    .sp-parent-controls {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .sp-mode-container {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
    }

    .sp-mode-top {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 650;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .sp-mode-toggle {
      display: inline-flex;
      align-items: center;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 3px;
      gap: 3px;
    }

    .mode-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: none;
      background: transparent;
      border-radius: 7px;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 650;
      color: #64748b;
      cursor: pointer;
      transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .mode-btn:hover:not(.active):not(:disabled) {
      color: #0f172a;
      background: rgba(255, 255, 255, 0.6);
    }

    .mode-btn.active {
      background: #0f4f9c;
      color: #ffffff;
      box-shadow: 0 1px 3px rgba(15, 79, 156, 0.28);
    }

    .mode-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .sp-mode-readonly {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #ffffff;
      border: 1px solid #c7d2fe;
      color: #4338ca;
      font-size: 12px;
      font-weight: 650;
      padding: 5px 12px;
      border-radius: 999px;
    }

    .ro-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #4f46e5;
    }

    /* ── Info Callout ── */
    .sp-info-callout {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 3px solid #3b82f6;
      border-radius: 10px;
      padding: 10px 14px;
      font-size: 12.5px;
      color: #475569;
      line-height: 1.45;
    }

    .sp-info-callout.shared {
      background: #fbfbfe;
      border-left-color: #6366f1;
    }

    .callout-icon {
      color: #3b82f6;
      margin-top: 1px;
      flex-shrink: 0;
    }

    .sp-info-callout.shared .callout-icon {
      color: #6366f1;
    }

    .callout-strategy {
      color: #0f172a;
      font-weight: 700;
    }

    /* ── Section Bar ── */
    .sp-section-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .sp-section-title-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .sp-tree-icon-badge {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #eff6ff;
      color: #1d4ed8;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .sp-section-heading-group {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .sp-heading-with-count {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sp-heading-with-count h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 750;
      color: #0f172a;
    }

    .sp-count-pill {
      font-size: 11px;
      font-weight: 700;
      background: #f1f5f9;
      color: #475569;
      border-radius: 999px;
      padding: 1px 8px;
    }

    .sp-section-sub {
      margin: 0;
      font-size: 12px;
      color: #64748b;
    }

    .sp-action-btns {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-sp {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 9px;
      padding: 7px 14px;
      font-size: 12.5px;
      font-weight: 650;
      cursor: pointer;
      transition: all 0.18s ease;
      border: 1px solid transparent;
    }

    .btn-sp.primary {
      background: #0f4f9c;
      color: #ffffff;
      box-shadow: 0 1px 2px rgba(15, 79, 156, 0.2);
    }

    .btn-sp.primary:hover {
      background: #0c3e7a;
      box-shadow: 0 4px 12px rgba(15, 79, 156, 0.25);
    }

    .btn-sp.outline {
      background: #ffffff;
      border-color: #cbd5e1;
      color: #334155;
    }

    .btn-sp.outline:hover {
      background: #f8fafc;
      border-color: #94a3b8;
      color: #0f172a;
    }

    /* ── Subprojects Hierarchy Tree List ── */
    .sp-tree-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .sp-tree-item {
      display: flex;
      align-items: stretch;
      gap: 10px;
    }

    .sp-branch-line {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      flex-shrink: 0;
      margin-left: 10px;
    }

    /* ── Subproject Card ── */
    .sp-card {
      flex: 1;
      min-width: 0;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 16px 20px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
      position: relative;
    }

    .sp-card:hover {
      border-color: #0f4f9c;
      box-shadow: 0 8px 24px -4px rgba(15, 79, 156, 0.12), 0 2px 6px -1px rgba(15, 23, 42, 0.04);
      transform: translateY(-2px);
    }

    .sp-card-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .sp-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .sp-card-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex-wrap: wrap;
    }

    .sp-subcode-chip {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      font-weight: 750;
      color: #0f4f9c;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      padding: 2px 8px;
      white-space: nowrap;
    }

    .sp-card-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      text-decoration: none;
      color: #0f172a;
      transition: color 0.15s ease;
    }

    .sp-card-name-text {
      font-size: 15px;
      font-weight: 750;
      color: #0f172a;
      transition: color 0.15s ease;
    }

    .sp-card:hover .sp-card-name-text {
      color: #0f4f9c;
      text-decoration: underline;
    }

    .sp-ext-icon {
      color: #94a3b8;
      transition: all 0.15s ease;
    }

    .sp-card:hover .sp-ext-icon {
      color: #0f4f9c;
      transform: translate(1px, -1px);
    }

    .sp-sub-level-badge {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #f8fafc;
      color: #64748b;
      border: 1px solid #e2e8f0;
      border-radius: 999px;
      padding: 1px 7px;
    }

    .sp-card-status-wrap {
      display: flex;
      align-items: center;
    }

    .sp-status-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 650;
      white-space: nowrap;
    }

    .status-pulse-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    /* ── Subproject Card Footer & Meta ── */
    .sp-card-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding-top: 8px;
      border-top: 1px solid #f1f5f9;
    }

    .sp-card-meta-chips {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .sp-meta-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #475569;
    }

    .meta-chip-icon {
      color: #0f4f9c;
      display: flex;
    }

    .meta-chip-text strong {
      color: #0f172a;
    }

    .sp-meta-chip.pm {
      gap: 7px;
    }

    .sp-pm-avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      color: #ffffff;
      font-size: 10px;
      font-weight: 750;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.15);
      flex-shrink: 0;
    }

    .progress-chip {
      display: inline-flex;
      align-items: center;
      gap: 7px;
    }

    .sp-progress-track {
      width: 60px;
      height: 5px;
      background: #e2e8f0;
      border-radius: 99px;
      overflow: hidden;
    }

    .sp-progress-fill {
      height: 100%;
      background: #10b981;
      border-radius: inherit;
    }

    .progress-pct {
      font-size: 11px;
      font-weight: 700;
      color: #059669;
    }

    /* ── Card Action Buttons ── */
    .sp-card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sp-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid #e2e8f0;
      background: #ffffff;
      border-radius: 7px;
      padding: 4px 9px;
      font-size: 11.5px;
      font-weight: 650;
      color: #475569;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .sp-action-btn:hover {
      border-color: #cbd5e1;
      background: #f8fafc;
      color: #0f172a;
    }

    .sp-action-btn.danger {
      color: #dc2626;
      border-color: #fee2e2;
      background: #fff5f5;
    }

    .sp-action-btn.danger:hover {
      background: #fee2e2;
      border-color: #fca5a5;
      color: #b91c1c;
    }

    /* ── Empty State ── */
    .sp-empty-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 48px 24px;
      background: #ffffff;
      border: 1.5px dashed #cbd5e1;
      border-radius: 16px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.02);
    }

    .sp-empty-icon-box {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: #eff6ff;
      color: #0f4f9c;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;
    }

    .sp-empty-title {
      margin: 0 0 6px 0;
      font-size: 16px;
      font-weight: 750;
      color: #0f172a;
    }

    .sp-empty-desc {
      margin: 0 0 20px 0;
      max-width: 500px;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }

    .sp-empty-buttons {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* ── Form Cards (New & Attach) ── */
    .sp-form-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 16px;
      padding: 20px 24px;
      box-shadow: 0 12px 32px -4px rgba(15, 23, 42, 0.1), 0 4px 8px -2px rgba(15, 23, 42, 0.04);
      display: flex;
      flex-direction: column;
      gap: 16px;
      animation: fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .sp-form-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding-bottom: 14px;
      border-bottom: 1px solid #f1f5f9;
    }

    .form-title-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .form-icon-badge {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .form-icon-badge.new {
      background: #eff6ff;
      color: #0f4f9c;
    }

    .form-icon-badge.attach {
      background: #f5f3ff;
      color: #7c3aed;
    }

    .form-title-wrap h4 {
      margin: 0;
      font-size: 15px;
      font-weight: 750;
      color: #0f172a;
    }

    .form-subtitle {
      margin: 2px 0 0 0;
      font-size: 12px;
      color: #64748b;
    }

    .form-close-btn {
      border: none;
      background: none;
      color: #94a3b8;
      border-radius: 6px;
      padding: 4px;
      cursor: pointer;
      display: flex;
      transition: color 0.15s ease;
    }

    .form-close-btn:hover {
      color: #0f172a;
      background: #f1f5f9;
    }

    .sp-form-body {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .sp-form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 16px;
    }

    .sp-form-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .sp-label {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
    }

    .req {
      color: #ef4444;
    }

    .sp-input, .sp-select {
      font: inherit;
      font-size: 13px;
      padding: 9px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 9px;
      color: #0f172a;
      background: #ffffff;
      outline: none;
      transition: all 0.15s ease;
    }

    .sp-input:focus, .sp-select:focus {
      border-color: #0f4f9c;
      box-shadow: 0 0 0 3px rgba(15, 79, 156, 0.12);
    }

    .sp-code-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .code-input {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-weight: 700;
      letter-spacing: 0.05em;
    }

    .sp-generated-preview {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      color: #64748b;
    }

    .preview-key {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      color: #0f4f9c;
      font-size: 12px;
      background: #eff6ff;
      padding: 1px 6px;
      border-radius: 5px;
      border: 1px solid #bfdbfe;
    }

    .sp-curr-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .curr-sign {
      position: absolute;
      left: 11px;
      color: #64748b;
      font-size: 13px;
      font-weight: 600;
    }

    .curr-input {
      padding-left: 26px;
      width: 100%;
    }

    .sp-form-callout {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 9px;
      padding: 10px 14px;
      font-size: 12px;
      color: #475569;
      line-height: 1.45;
    }

    .sp-form-callout svg {
      color: #0f4f9c;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .sp-form-callout.warn {
      background: #fffbeb;
      border-color: #fde68a;
      color: #92400e;
    }

    .sp-form-callout.warn svg {
      color: #d97706;
    }

    .sp-form-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 10px;
      padding-top: 14px;
      border-top: 1px solid #f1f5f9;
    }

    .btn-form-cancel {
      border: 1px solid #cbd5e1;
      background: #ffffff;
      border-radius: 8px;
      padding: 8px 16px;
      font-size: 12.5px;
      font-weight: 650;
      color: #475569;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-form-cancel:hover:not(:disabled) {
      background: #f8fafc;
      color: #0f172a;
    }

    .btn-form-submit {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 12.5px;
      font-weight: 650;
      cursor: pointer;
      border: 1px solid transparent;
      color: #ffffff;
      transition: all 0.15s ease;
    }

    .btn-form-submit.primary {
      background: #0f4f9c;
    }

    .btn-form-submit.primary:hover:not(:disabled) {
      background: #0c3e7a;
    }

    .btn-form-submit.attach {
      background: #7c3aed;
    }

    .btn-form-submit.attach:hover:not(:disabled) {
      background: #6d28d9;
    }

    .btn-form-submit:disabled, .btn-form-cancel:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `],
})
export class SubprojectsTabComponent {
  private api = inject(ProjectsService);
  private employeesApi = inject(EmployeeService);
  private dialog = inject(DialogService);
  private toast = inject(HotToastService);
  private router = inject(Router);

  /** The parent project, as getProjectDetails returns it (with `subprojects`). */
  project = input<any>(null);
  isAdmin = input(false);
  /** Fired after any change, so the page reloads the project. */
  changed = output<void>();

  busy = signal(false);
  form = signal<'new' | 'attach' | null>(null);
  name = signal('');
  subCode = signal('');
  pmId = signal<number | null>(null);
  budget = signal<number | null>(null);
  attachId = signal<number | null>(null);
  employees = signal<any[]>([]);
  allProjects = signal<any[]>([]);

  mode = computed(() => (this.project()?.budgetMode === 'SHARED' ? 'SHARED' : 'SEPARATE'));

  /** Projects that can go under this one: not itself, not already a subproject, not a parent. */
  attachable = computed(() => {
    const me = this.project()?.id;
    const all = this.allProjects();
    const parents = new Set(all.filter((x) => x.parentId).map((x) => x.parentId));
    return all.filter((x) => x.id !== me && !x.parentId && !parents.has(x.id));
  });

  pmNames(c: any): string {
    const pms = (c.members || []).map((m: any) => m.employee?.firstName || m.employee?.name).filter(Boolean);
    if (pms.length) return pms.join(', ');
    return '';
  }

  getPmInitial(c: any): string {
    const name = this.pmNames(c);
    if (!name) return '?';
    return name[0].toUpperCase();
  }

  getAvatarBg(name: string): string {
    const colors = [
      'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      'linear-gradient(135deg, #ec4899, #be185d)',
      'linear-gradient(135deg, #10b981, #047857)',
      'linear-gradient(135deg, #f59e0b, #b45309)',
      'linear-gradient(135deg, #06b6d4, #0e7490)',
    ];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  formatStatus(status: string | null | undefined): string {
    if (!status) return 'Active';
    const s = String(status).toUpperCase();
    if (s === 'IN_PROGRESS') return 'In Progress';
    if (s === 'TODO') return 'To Do';
    if (s === 'DONE' || s === 'COMPLETED') return 'Completed';
    if (s === 'ON_HOLD') return 'On Hold';
    return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }

  getStatusStyle(status: string | null | undefined): { [key: string]: string } {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'IN_PROGRESS') return { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' };
    if (s === 'DONE' || s === 'COMPLETED') return { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' };
    if (s === 'ON_HOLD') return { background: '#faf5ff', color: '#7e22ce', border: '1px solid #e9d5ff' };
    if (s === 'TODO') return { background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' };
    return { background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' };
  }

  getStatusDot(status: string | null | undefined): string {
    const s = String(status || 'ACTIVE').toUpperCase();
    if (s === 'IN_PROGRESS') return '#2563eb';
    if (s === 'DONE' || s === 'COMPLETED') return '#16a34a';
    if (s === 'ON_HOLD') return '#9333ea';
    if (s === 'TODO') return '#d97706';
    return '#10b981';
  }

  open(id: number) {
    this.router.navigate(['/projects', id]);
  }

  onCardAuxClick(event: MouseEvent, id: number) {
    if (event.button === 1) { // Middle click (scroll wheel)
      event.preventDefault();
      window.open(`/projects/${id}`, '_blank');
    }
  }

  openForm(kind: 'new' | 'attach') {
    this.form.set(kind);
    this.name.set('');
    this.subCode.set(this.nextFreeCode());
    this.pmId.set(null);
    this.budget.set(null);
    this.attachId.set(null);
    if (kind === 'new' && !this.employees().length) {
      this.employeesApi.getEmployeesBasicList().subscribe((e: any[]) => this.employees.set(e || []));
    }
    if (kind === 'attach' && !this.allProjects().length) {
      this.api.getProjects().subscribe((p: any) => this.allProjects.set(Array.isArray(p) ? p : []));
    }
  }

  /** The next unused letter, as a starting suggestion: A, then B, then C. */
  private nextFreeCode(): string {
    const used = new Set((this.project()?.subprojects || []).map((c: any) => c.subCode));
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!used.has(ch)) return ch;
    return '';
  }

  private run(obs: any, ok: string) {
    this.busy.set(true);
    obs.subscribe({
      next: () => {
        this.busy.set(false);
        this.form.set(null);
        this.toast.success(ok);
        this.changed.emit();
      },
      error: (e: any) => {
        this.busy.set(false);
        this.toast.error(e?.error?.message || 'That did not save.');
      },
    });
  }

  create() {
    const p = this.project();
    this.run(this.api.createSubproject(p.id, {
      name: this.name().trim(), subCode: this.subCode().trim(), pmIds: [this.pmId()!],
      budgetAmount: this.mode() === 'SEPARATE' ? this.budget() : null,
    }), `${p.key}-${this.subCode().trim()} created`);
  }

  async attach() {
    const p = this.project();
    const target = this.allProjects().find((x) => x.id === this.attachId());
    const ok = await this.dialog.confirm(
      `${target?.key} — ${target?.name} becomes ${p.key}-${this.subCode().trim()}, and all its task IDs change with it. Continue?`,
      'Add as subproject', 'Add as subproject', 'Cancel', 'warning');
    if (!ok) return;
    this.run(this.api.attachSubproject(p.id, this.attachId()!, this.subCode().trim()), `${target?.name} is now a subproject`);
  }

  async renameSub(c: any) {
    const code = await this.dialog.prompt(
      `New sub code for ${c.key}. Its code and all its task IDs change to match.`, 'Change sub code',
      { placeholder: c.subCode, confirmLabel: 'Change code', required: true });
    if (!code?.trim()) return;
    this.run(this.api.changeSubCode(c.id, code.trim().toUpperCase()), 'Code changed');
  }

  async detach(c: any) {
    const ok = await this.dialog.confirm(
      `${c.key} — ${c.name} stops being a subproject of ${this.project()?.key}. It keeps its current code and everything on it.`,
      'Detach subproject', 'Detach', 'Cancel', 'danger');
    if (!ok) return;
    this.run(this.api.detachSubproject(c.id), `${c.name} detached`);
  }

  setMode(mode: 'SEPARATE' | 'SHARED') {
    if (mode === this.mode()) return;
    this.run(this.api.setBudgetMode(this.project().id, mode), mode === 'SHARED' ? 'Subprojects now share the budget' : 'Subprojects now have separate budgets');
  }
}
