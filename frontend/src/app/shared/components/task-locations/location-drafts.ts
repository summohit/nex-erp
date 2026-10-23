import { Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideMapPin, LucideUsers, LucideUserPlus, LucideCalendar,
  LucideCheck, LucideX, LucideAlertTriangle, LucideAlertCircle,
  LucideChevronRight, LucideCopyCheck, LucidePlus, LucideTrash2
} from '@lucide/angular';
import { TaskLocation, LocationStatus, LOCATION_STATUS_LABEL } from '../../../services/task-locations.service';

export interface DraftPerson {
  id: number;
  firstName: string;
  lastName?: string | null;
  avatarUrl?: string | null;
}

/** One picked location's values while the task is being created. */
export interface LocationDraft {
  locationId: number;
  status: LocationStatus;
  startDate: string;
  dueDate: string;
  assigneeIds: number[];
  remarks: string;
  blockedReason: string;
  /** Changed by hand, so later changes to the task's own values leave it alone. */
  touched: { dates: boolean; assignees: boolean };
}

/** Whether a draft has everything the server requires. */
export function draftComplete(d: LocationDraft): boolean {
  return !!d.status && !!d.startDate && !!d.dueDate && d.dueDate >= d.startDate
    && d.assigneeIds.length > 0 && (d.status !== 'BLOCKED' || !!d.blockedReason.trim());
}

/**
 * The per-location part of the Create Task form: each picked location gets
 * its own status, dates, assigned members and remarks. Every location starts
 * with the task's own members and dates and follows them until changed by
 * hand. Time, comments and evidence come later, once the task exists.
 */
@Component({
  selector: 'app-location-drafts',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideMapPin, LucideUsers, LucideUserPlus, LucideCalendar,
    LucideCheck, LucideX, LucideAlertTriangle, LucideAlertCircle,
    LucideChevronRight, LucideCopyCheck, LucidePlus, LucideTrash2
  ],
  template: `
    @if (drafts().length) {
      <div class="ld-container">
        <!-- Section Header -->
        <div class="ld-header">
          <div class="ld-header-left">
            <div class="ld-header-icon">
              <svg lucideMapPin size="15"></svg>
            </div>
            <div>
              <div class="ld-header-title">
                <span>Location Details</span>
                <span class="ld-req">*</span>
              </div>
              <p class="ld-header-subtitle">Status, schedule, and team members are required for each location</p>
            </div>
          </div>

          <div class="ld-header-right">
            <span
              class="ld-count-badge"
              [class.is-complete]="completedCount() === drafts().length"
              [class.is-incomplete]="showErrors() && completedCount() < drafts().length"
            >
              @if (completedCount() === drafts().length) {
                <svg lucideCheck size="11"></svg>
                <span>All {{ drafts().length }} configured</span>
              } @else {
                <span>{{ completedCount() }} of {{ drafts().length }} configured</span>
              }
            </span>
          </div>
        </div>

        <!-- Locations Accordion List -->
        <div class="ld-list">
          @for (d of drafts(); track d.locationId) {
            <div
              class="ld-card"
              [class.is-open]="openId() === d.locationId"
              [class.is-error]="showErrors() && !complete(d)"
            >
              <!-- Card Header / Summary -->
              <div class="ld-summary" (click)="toggleOpen(d.locationId)">
                <div class="ld-summary-left">
                  <svg
                    lucideChevronRight
                    size="15"
                    class="ld-chevron"
                    [class.is-rotated]="openId() === d.locationId"
                  ></svg>

                  <div class="ld-loc-icon" [class]="d.status.toLowerCase()">
                    <svg lucideMapPin size="13"></svg>
                  </div>

                  <div class="ld-name-wrap">
                    <span class="ld-name">{{ nameOf(d.locationId) }}</span>
                    @if (levelOf(d.locationId); as lvl) {
                      <span class="ld-level-pill" [class]="lvl">{{ lvl }}</span>
                    }
                  </div>
                </div>

                <div class="ld-summary-middle">
                  <!-- Assignees preview -->
                  <div class="ld-assignees-preview">
                    @if (d.assigneeIds.length) {
                      <div class="ld-avatar-group">
                        @for (id of d.assigneeIds.slice(0, 3); track id) {
                          <div
                            class="ld-avatar-bubble"
                            [style.background-color]="!personAvatar(id) ? getPersonColor(id) : 'transparent'"
                            [title]="personName(id)"
                          >
                            @if (personAvatar(id); as url) {
                              <img [src]="url" [alt]="personName(id)" class="ld-avatar-img" />
                            } @else {
                              {{ getPersonInitialsById(id) }}
                            }
                          </div>
                        }
                        @if (d.assigneeIds.length > 3) {
                          <div class="ld-avatar-overflow">
                            +{{ d.assigneeIds.length - 3 }}
                          </div>
                        }
                      </div>
                      <span class="ld-assignees-names">{{ whoOf(d) }}</span>
                    } @else {
                      <span class="ld-no-members-pill">
                        <svg lucideUsers size="11"></svg>
                        <span>No members</span>
                      </span>
                    }
                  </div>

                  <!-- Dates preview -->
                  @if (d.startDate && d.dueDate) {
                    <span class="ld-date-preview">
                      <svg lucideCalendar size="11"></svg>
                      <span>{{ formatDay(d.startDate) }} – {{ formatDay(d.dueDate) }}</span>
                    </span>
                  }

                  <!-- Incomplete Error tag -->
                  @if (showErrors() && !complete(d)) {
                    <span class="ld-incomplete-tag">
                      <svg lucideAlertCircle size="11"></svg>
                      <span>Incomplete</span>
                    </span>
                  }
                </div>

                <div class="ld-summary-right">
                  <span class="ld-status-pill" [class]="'pill-' + d.status.toLowerCase()">
                    <span class="ld-pill-dot"></span>
                    {{ label[d.status] }}
                  </span>
                  <button
                    type="button"
                    class="ld-btn-remove-header"
                    title="Remove location"
                    aria-label="Remove location"
                    (click)="removeDraft(d.locationId, $event)"
                  >
                    <svg lucideTrash2 size="13"></svg>
                  </button>
                </div>
              </div>

              <!-- Card Body (Expanded Details) -->
              @if (openId() === d.locationId) {
                <div class="ld-body">
                  <!-- Grid: Status, Start Date, Due Date -->
                  <div class="ld-controls-grid">
                    <div class="ld-control-col">
                      <label class="ld-field-label">Status <span class="ld-req">*</span></label>
                      <div class="ld-select-wrap">
                        <select
                          class="ld-select"
                          [value]="d.status"
                          (change)="set(d, { status: $any($event.target).value })"
                        >
                          @for (s of statuses; track s) {
                            <option [value]="s">{{ label[s] }}</option>
                          }
                        </select>
                      </div>
                    </div>

                    <div class="ld-control-col">
                      <label class="ld-field-label">Start Date <span class="ld-req">*</span></label>
                      <div class="ld-input-wrap">
                        <svg lucideCalendar size="14" class="ld-input-icon"></svg>
                        <input
                          type="date"
                          class="ld-input"
                          [value]="d.startDate"
                          [class.has-error]="showErrors() && !d.startDate"
                          #startInput
                          (change)="onStartDateChange(d, startInput.value, startInput)"
                        />
                      </div>
                    </div>

                    <div class="ld-control-col">
                      <label class="ld-field-label">Due Date <span class="ld-req">*</span></label>
                      <div class="ld-input-wrap">
                        <svg lucideCalendar size="14" class="ld-input-icon"></svg>
                        <input
                          type="date"
                          class="ld-input"
                          [value]="d.dueDate"
                          [min]="d.startDate || null"
                          [class.has-error]="showErrors() && (!d.dueDate || d.dueDate < d.startDate)"
                          #dueInput
                          (change)="onDueDateChange(d, dueInput.value, dueInput)"
                        />
                      </div>
                    </div>
                  </div>

                  <!-- Blocked Reason -->
                  @if (d.status === 'BLOCKED') {
                    <div class="ld-blocked-banner">
                      <label class="ld-field-label">
                        <svg lucideAlertTriangle size="13"></svg>
                        <span>What is blocking this location? <span class="ld-req">*</span></span>
                      </label>
                      <input
                        type="text"
                        class="ld-input"
                        placeholder="Reason why execution is blocked at this location…"
                        [value]="d.blockedReason"
                        [class.has-error]="showErrors() && !d.blockedReason.trim()"
                        (input)="set(d, { blockedReason: $any($event.target).value })"
                      />
                    </div>
                  }

                  <!-- Assigned Members Card -->
                  <div class="ld-assignees-card" [class.has-error]="showErrors() && !d.assigneeIds.length">
                    <div class="ld-assignees-head">
                      <span class="ld-card-title">
                        <svg lucideUsers size="13"></svg>
                        <span>Assigned Members</span>
                        <span class="ld-req">*</span>
                      </span>

                      <!-- Custom dropdown picker trigger -->
                      <div class="ld-dropdown-wrap">
                        <button
                          type="button"
                          class="ld-btn-assign-trigger"
                          (click)="toggleAssignDropdown(d.locationId)"
                        >
                          <svg lucideUserPlus size="13"></svg>
                          <span>+ Assign member</span>
                        </button>

                        @if (assigningLocId() === d.locationId) {
                          <div class="ld-popover-menu">
                            <div class="ld-popover-head">
                              <span>Assign Project Member</span>
                              <button type="button" class="ld-popover-close" (click)="assigningLocId.set(null)">
                                <svg lucideX size="12"></svg>
                              </button>
                            </div>
                            <div class="ld-popover-list">
                              @for (p of getUnassignedPeople(d); track p.id) {
                                <button
                                  type="button"
                                  class="ld-popover-item"
                                  (click)="addPerson(d, p.id)"
                                >
                                  <span class="ld-avatar-sm" [style.background-color]="!p.avatarUrl ? getPersonColor(p.id) : 'transparent'">
                                    @if (p.avatarUrl) {
                                      <img [src]="p.avatarUrl" [alt]="p.firstName" class="ld-avatar-img" />
                                    } @else {
                                      {{ getPersonInitials(p) }}
                                    }
                                  </span>
                                  <span class="ld-popover-name">{{ p.firstName }} {{ p.lastName || '' }}</span>
                                  <svg lucidePlus size="13" class="ld-item-plus-icon"></svg>
                                </button>
                              } @empty {
                                <div class="ld-popover-empty">All project members are already assigned</div>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    </div>

                    <!-- Member chips -->
                    @if (d.assigneeIds.length) {
                      <div class="ld-chips-row">
                        @for (id of d.assigneeIds; track id) {
                          <span class="ld-member-chip">
                            <span class="ld-chip-avatar" [style.background-color]="!personAvatar(id) ? getPersonColor(id) : 'transparent'">
                              @if (personAvatar(id); as url) {
                                <img [src]="url" [alt]="personName(id)" class="ld-avatar-img" />
                              } @else {
                                {{ getPersonInitialsById(id) }}
                              }
                            </span>
                            <span class="ld-chip-name">{{ personName(id) }}</span>
                            <button
                              type="button"
                              class="ld-chip-del"
                              (click)="removePerson(d, id)"
                              [attr.aria-label]="'Remove ' + personName(id)"
                              title="Unassign"
                            >
                              <svg lucideX size="11"></svg>
                            </button>
                          </span>
                        }
                      </div>
                    } @else {
                      <div class="ld-empty-members">
                        <svg lucideUserPlus size="14"></svg>
                        <span>No members assigned yet. At least 1 member is required for this location.</span>
                      </div>
                    }
                  </div>

                  <!-- Remarks & Notes -->
                  <div class="ld-remarks-group">
                    <label class="ld-field-label">Remarks &amp; Notes</label>
                    <textarea
                      rows="2"
                      class="ld-textarea"
                      placeholder="Site observations, execution remarks, or handover notes…"
                      [value]="d.remarks"
                      (input)="set(d, { remarks: $any($event.target).value })"
                    ></textarea>
                  </div>

                  <!-- Actions footer: Remove location & Apply to all -->
                  <div class="ld-actions-bar">
                    <button
                      type="button"
                      class="ld-btn-remove-card"
                      (click)="removeDraft(d.locationId, $event)"
                    >
                      <svg lucideTrash2 size="13"></svg>
                      <span>Remove location</span>
                    </button>

                    <button
                      type="button"
                      class="ld-btn-apply-all"
                      (click)="applyToAll(d)"
                      title="Copy this location's dates and members to all other picked locations"
                    >
                      <svg lucideCopyCheck size="13"></svg>
                      <span>Apply these dates and members to all locations</span>
                    </button>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .ld-container {
      margin-top: 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    /* Section Header */
    .ld-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding-bottom: 2px;
    }

    .ld-header-left {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .ld-header-icon {
      width: 28px;
      height: 28px;
      border-radius: 7px;
      background: #EFF6FF;
      color: #1373E5;
      border: 1px solid #DBEAFE;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .ld-header-title {
      font-size: 13px;
      font-weight: 700;
      color: #0F172A;
      line-height: 1.2;
    }

    .ld-header-subtitle {
      margin: 2px 0 0 0;
      font-size: 11px;
      color: #64748B;
    }

    .ld-req {
      color: #DC2626;
      font-weight: 700;
      margin-left: 2px;
    }

    .ld-count-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      background: #F1F5F9;
      color: #475569;
      border: 1px solid #E2E8F0;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .ld-count-badge.is-complete {
      background: #ECFDF5;
      color: #047857;
      border-color: #A7F3D0;
    }

    .ld-count-badge.is-incomplete {
      background: #FEF2F2;
      color: #B91C1C;
      border-color: #FECACA;
    }

    /* Accordion List */
    .ld-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .ld-card {
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      background: #FFFFFF;
      transition: all 0.2s ease;
      overflow: hidden;
    }

    .ld-card:hover {
      border-color: #CBD5E1;
    }

    .ld-card.is-open {
      border-color: #93C5FD;
      box-shadow: 0 4px 12px rgba(19, 115, 229, 0.08);
    }

    .ld-card.is-error {
      border-color: #FCA5A5;
      background: #FFFAFA;
    }

    /* Summary Row */
    .ld-summary {
      width: 100%;
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      user-select: none;
      background: transparent;
      transition: background 0.15s ease;
    }

    .ld-summary:hover {
      background: #F8FAFC;
    }

    .ld-summary-left {
      display: flex;
      align-items: center;
      gap: 9px;
      min-width: 0;
      flex: 1;
    }

    .ld-chevron {
      color: #94A3B8;
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }

    .ld-chevron.is-rotated {
      transform: rotate(90deg);
      color: #1373E5;
    }

    .ld-loc-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: #F1F5F9;
      color: #64748B;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .ld-loc-icon.in_progress, .ld-loc-icon.in_review {
      background: #EFF6FF;
      color: #1D4ED8;
    }

    .ld-loc-icon.completed {
      background: #ECFDF5;
      color: #047857;
    }

    .ld-loc-icon.blocked {
      background: #FEF2F2;
      color: #B91C1C;
    }

    .ld-name-wrap {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
    }

    .ld-name {
      font-size: 13px;
      font-weight: 600;
      color: #0F172A;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ld-level-pill {
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 4px;
      letter-spacing: 0.04em;
    }

    .ld-level-pill.state { background: #EEF2FF; color: #4338CA; }
    .ld-level-pill.city { background: #EFF6FF; color: #1D4ED8; }
    .ld-level-pill.site { background: #FAF5FF; color: #7E22CE; }

    .ld-summary-middle {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .ld-assignees-preview {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .ld-avatar-group {
      display: flex;
      align-items: center;
    }

    .ld-avatar-bubble {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: #FFFFFF;
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #FFFFFF;
      margin-left: -5px;
      overflow: hidden;
    }

    .ld-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
      display: block;
    }

    .ld-avatar-group .ld-avatar-bubble:first-child {
      margin-left: 0;
    }

    .ld-avatar-overflow {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #E2E8F0;
      color: #475569;
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #FFFFFF;
      margin-left: -5px;
    }

    .ld-assignees-names {
      font-size: 12px;
      color: #64748B;
      max-width: 140px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @media (max-width: 850px) {
      .ld-assignees-names {
        display: none;
      }
    }

    .ld-no-members-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #DC2626;
      background: #FEF2F2;
      border: 1px solid #FECACA;
      padding: 1px 6px;
      border-radius: 999px;
      font-weight: 500;
    }

    .ld-date-preview {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #64748B;
      padding: 1px 6px;
      border-radius: 5px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      white-space: nowrap;
    }

    .ld-incomplete-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 700;
      color: #DC2626;
    }

    .ld-summary-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .ld-btn-remove-header {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: #94A3B8;
      cursor: pointer;
      transition: all 0.15s ease;
      margin-left: 2px;
    }

    .ld-btn-remove-header:hover {
      background: #FEE2E2;
      color: #DC2626;
    }

    .ld-status-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .ld-status-pill.pill-not_started {
      background: #F1F5F9;
      color: #475569;
      border: 1px solid #E2E8F0;
    }

    .ld-status-pill.pill-in_progress, .ld-status-pill.pill-in_review {
      background: #EFF6FF;
      color: #1D4ED8;
      border: 1px solid #BFDBFE;
    }

    .ld-status-pill.pill-completed {
      background: #ECFDF5;
      color: #047857;
      border: 1px solid #A7F3D0;
    }

    .ld-status-pill.pill-blocked {
      background: #FEF2F2;
      color: #B91C1C;
      border: 1px solid #FECACA;
    }

    .ld-pill-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
    }

    /* Expanded Details Body */
    .ld-body {
      padding: 14px;
      border-top: 1px solid #F1F5F9;
      background: #FAFCFF;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    /* Controls Grid: Status, Start Date, Due Date */
    .ld-controls-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    @media (max-width: 640px) {
      .ld-controls-grid {
        grid-template-columns: 1fr;
      }
    }

    .ld-control-col {
      display: flex;
      flex-direction: column;
    }

    .ld-field-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .ld-input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .ld-input-icon {
      position: absolute;
      left: 10px;
      color: #94A3B8;
      pointer-events: none;
    }

    .ld-input-wrap .ld-input {
      padding-left: 32px;
    }

    .ld-input, .ld-select, .ld-textarea {
      font: inherit;
      font-size: 12px;
      padding: 7px 10px;
      border: 1px solid #CBD5E1;
      border-radius: 7px;
      color: #0F172A;
      background: #FFFFFF;
      width: 100%;
      box-sizing: border-box;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }

    .ld-input:focus, .ld-select:focus, .ld-textarea:focus {
      outline: none;
      border-color: #1373E5;
      box-shadow: 0 0 0 2px rgba(19, 115, 229, 0.15);
    }

    .ld-input.has-error {
      border-color: #F87171 !important;
      background: #FFFBFB;
    }

    .ld-blocked-banner {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ld-blocked-banner .ld-field-label {
      display: flex;
      align-items: center;
      gap: 5px;
      color: #B91C1C;
    }

    /* Assigned Members Section */
    .ld-assignees-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: border-color 0.15s ease;
    }

    .ld-assignees-card.has-error {
      border-color: #F87171;
      background: #FFFDFD;
    }

    .ld-assignees-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .ld-card-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .ld-dropdown-wrap {
      position: relative;
      display: inline-block;
    }

    .ld-btn-assign-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px dashed #CBD5E1;
      background: #FFFFFF;
      border-radius: 7px;
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .ld-btn-assign-trigger:hover {
      border-color: #1373E5;
      color: #1373E5;
      background: #EFF6FF;
    }

    .ld-popover-menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 60;
      width: 240px;
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }

    .ld-popover-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 10px;
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
      font-size: 11px;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .ld-popover-close {
      border: none;
      background: transparent;
      padding: 2px;
      cursor: pointer;
      color: #94A3B8;
      display: flex;
    }

    .ld-popover-close:hover {
      color: #0F172A;
    }

    .ld-popover-list {
      max-height: 200px;
      overflow-y: auto;
      padding: 4px 0;
    }

    .ld-popover-item {
      width: 100%;
      border: none;
      background: transparent;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      color: #1E293B;
      transition: background 0.1s ease;
    }

    .ld-popover-item:hover {
      background: #EFF6FF;
      color: #1373E5;
    }

    .ld-avatar-sm {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      color: #FFFFFF;
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }

    .ld-popover-name {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .ld-item-plus-icon {
      color: #94A3B8;
    }

    .ld-popover-empty {
      padding: 14px 10px;
      text-align: center;
      font-size: 12px;
      color: #94A3B8;
    }

    /* Chips */
    .ld-chips-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .ld-member-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      background: #F1F5F9;
      border: 1px solid #E2E8F0;
      border-radius: 999px;
      padding: 2px 8px 2px 3px;
      font-size: 12px;
      color: #1E293B;
      font-weight: 500;
    }

    .ld-chip-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: #FFFFFF;
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }

    .ld-chip-name {
      white-space: nowrap;
    }

    .ld-chip-del {
      border: none;
      background: transparent;
      padding: 0;
      display: flex;
      align-items: center;
      color: #94A3B8;
      cursor: pointer;
      margin-left: 2px;
    }

    .ld-chip-del:hover {
      color: #DC2626;
    }

    .ld-empty-members {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #94A3B8;
      font-style: italic;
      padding: 4px 0;
    }

    .ld-empty-members svg {
      color: #CBD5E1;
    }

    /* Remarks */
    .ld-remarks-group {
      display: flex;
      flex-direction: column;
    }

    .ld-textarea {
      resize: vertical;
      min-height: 48px;
    }

    /* Actions Bar */
    .ld-actions-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 8px;
      margin-top: 6px;
      border-top: 1px dashed #E2E8F0;
    }

    .ld-btn-remove-card {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 1px solid #FEE2E2;
      color: #DC2626;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      padding: 5px 10px;
      border-radius: 6px;
      transition: all 0.15s ease;
    }

    .ld-btn-remove-card:hover {
      background: #FEF2F2;
      border-color: #FCA5A5;
      color: #B91C1C;
    }

    .ld-btn-apply-all {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      color: #1373E5;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 6px;
      transition: background 0.15s ease;
    }

    .ld-btn-apply-all:hover {
      background: #EFF6FF;
    }
  `],
})
export class LocationDraftsComponent {
  private toast = inject(HotToastService);

  /** Every active location, for names. */
  locations = input<TaskLocation[]>([]);
  /** The locations picked above, in pick order. */
  selectedIds = model<number[]>([]);
  removeLocation = output<number>();
  /** Who can be put on a location — the project's people. */
  people = input<DraftPerson[]>([]);
  /** The task's own members and dates; each location starts with them. */
  defaultAssigneeIds = input<number[]>([]);
  defaultStart = input<string>('');
  defaultDue = input<string>('');
  showErrors = input(false);

  drafts = model<LocationDraft[]>([]);
  openId = signal<number | null>(null);
  assigningLocId = signal<number | null>(null);

  readonly statuses: LocationStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
  readonly label = LOCATION_STATUS_LABEL;
  readonly complete = draftComplete;

  private byId = computed(() => new Map(this.locations().map((l) => [l.id, l])));
  private personById = computed(() => new Map(this.people().map((p) => [p.id, p])));

  completedCount = computed(() => this.drafts().filter((d) => draftComplete(d)).length);

  constructor() {
    // Keep one draft per picked location, and let untouched drafts follow the
    // task's own members and dates as those change.
    effect(() => {
      const ids = this.selectedIds();
      const members = this.defaultAssigneeIds();
      const start = this.defaultStart();
      const due = this.defaultDue();
      untracked(() => {
        const prev = new Map(this.drafts().map((d) => [d.locationId, d]));
        const next = ids.map((id) => {
          const d = prev.get(id) ?? {
            locationId: id, status: 'NOT_STARTED' as LocationStatus, startDate: '', dueDate: '',
            assigneeIds: [], remarks: '', blockedReason: '', touched: { dates: false, assignees: false },
          };
          return {
            ...d,
            ...(d.touched.dates ? {} : { startDate: start, dueDate: due }),
            ...(d.touched.assignees ? {} : { assigneeIds: [...members] }),
          };
        });
        this.drafts.set(next);
        if (this.openId() != null && !ids.includes(this.openId()!)) this.openId.set(null);
      });
    });
  }

  toggleOpen(locationId: number) {
    this.openId.set(this.openId() === locationId ? null : locationId);
    this.assigningLocId.set(null);
  }

  nameOf(id: number) {
    const l = this.byId().get(id);
    if (!l) return `#${id}`;
    const p = l.parentId != null ? this.byId().get(l.parentId) : null;
    return p ? `${l.name}, ${p.name}` : l.name;
  }

  levelOf(id: number): string {
    return this.byId().get(id)?.level?.toLowerCase() || '';
  }

  personName(id: number) {
    const p = this.personById().get(id);
    return p ? `${p.firstName} ${p.lastName ?? ''}`.trim() : `#${id}`;
  }

  personAvatar(id: number): string | null {
    return this.personById().get(id)?.avatarUrl || null;
  }

  whoOf(d: LocationDraft) {
    return d.assigneeIds.map((id) => this.personById().get(id)?.firstName ?? `#${id}`).join(', ');
  }

  getPersonInitials(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
    if (!p) return '?';
    const f = (p.firstName || '').trim()[0] || '';
    const l = (p.lastName || '').trim()[0] || '';
    return (f + l).toUpperCase() || '?';
  }

  getPersonInitialsById(id: number): string {
    return this.getPersonInitials(this.personById().get(id));
  }

  getPersonColor(id: number): string {
    const colors = [
      '#2563EB', '#059669', '#7C3AED', '#D97706',
      '#DB2777', '#0891B2', '#4F46E5', '#0D9488'
    ];
    return colors[Math.abs(id) % colors.length];
  }

  getUnassignedPeople(d: LocationDraft): DraftPerson[] {
    const set = new Set(d.assigneeIds);
    return this.people().filter((p) => !set.has(p.id));
  }

  toggleAssignDropdown(locId: number) {
    this.assigningLocId.set(this.assigningLocId() === locId ? null : locId);
  }

  set(d: LocationDraft, patch: Partial<LocationDraft>, touched?: 'dates' | 'assignees') {
    this.drafts.update((all) => all.map((x) => x.locationId === d.locationId
      ? { ...x, ...patch, touched: touched ? { ...x.touched, [touched]: true } : x.touched }
      : x));
  }

  addPerson(d: LocationDraft, personId: number) {
    if (!d.assigneeIds.includes(personId)) {
      this.set(d, { assigneeIds: [...d.assigneeIds, personId] }, 'assignees');
    }
    this.assigningLocId.set(null);
  }

  removePerson(d: LocationDraft, id: number) {
    this.set(d, { assigneeIds: d.assigneeIds.filter((x) => x !== id) }, 'assignees');
  }

  formatDay(d: string | null): string {
    if (!d) return '';
    try {
      const parts = d.slice(0, 10).split('-');
      if (parts.length === 3) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = parseInt(parts[2], 10);
        const month = months[parseInt(parts[1], 10) - 1];
        return `${day} ${month}`;
      }
    } catch {}
    return d;
  }

  removeDraft(locationId: number, event?: MouseEvent) {
    if (event) {
      event.stopPropagation();
    }
    const locName = this.nameOf(locationId);
    this.selectedIds.update((ids) => ids.filter((id) => id !== locationId));
    this.removeLocation.emit(locationId);
    if (this.openId() === locationId) {
      this.openId.set(null);
    }
    this.toast.info(`Removed ${locName}`);
  }

  onStartDateChange(d: LocationDraft, val: string, inputEl: HTMLInputElement) {
    if (!val) {
      this.toast.error('Start date is required.');
      inputEl.value = d.startDate;
      return;
    }
    if (d.dueDate && val > d.dueDate) {
      // Auto-advance due date to match the future start date
      this.set(d, { startDate: val, dueDate: val }, 'dates');
      this.toast.info('Due date adjusted to match the new start date.');
      return;
    }
    this.set(d, { startDate: val }, 'dates');
  }

  onDueDateChange(d: LocationDraft, val: string, inputEl: HTMLInputElement) {
    if (!val) {
      this.toast.error('Due date is required.');
      inputEl.value = d.dueDate;
      return;
    }
    if (d.startDate && val < d.startDate) {
      this.toast.error('Due date cannot be before start date.');
      inputEl.value = d.dueDate;
      return;
    }
    this.set(d, { dueDate: val }, 'dates');
  }

  applyToAll(src: LocationDraft) {
    if (!src.startDate) {
      this.toast.error('Start date is required.');
      return;
    }
    if (!src.dueDate) {
      this.toast.error('Due date is required.');
      return;
    }
    if (src.dueDate < src.startDate) {
      this.toast.error('Due date cannot be before start date.');
      return;
    }
    this.drafts.update((all) => all.map((x) => ({
      ...x,
      startDate: src.startDate,
      dueDate: src.dueDate,
      assigneeIds: [...src.assigneeIds],
      touched: { dates: true, assignees: true },
    })));
    this.toast.success('Applied schedule & members to all locations');
  }
}
