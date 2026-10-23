import { Component, OnChanges, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideMapPin, LucidePlus, LucideX, LucideSearch, LucideCalendar,
  LucideClock, LucideCheck, LucideCheckCircle2, LucideAlertTriangle,
  LucideAlertCircle, LucideChevronDown, LucideChevronRight, LucideUser,
  LucideUsers, LucideUserPlus, LucideTrash2, LucideUpload, LucidePaperclip,
  LucideFileText, LucideMessageSquare, LucideSave, LucideLayers
} from '@lucide/angular';
import { DialogService } from '../../services/dialog.service';
import {
  TaskLocationsService, TaskLocation, IssueLocations, IssueLocationRow, LocationActivity,
  LocationStatus, LOCATION_STATUS_LABEL, locationLabel,
} from '../../../services/task-locations.service';
import { LocationPickerComponent } from './location-picker';
import { LocationDraftsComponent, LocationDraft, draftComplete } from './location-drafts';

export interface PanelPerson {
  id: number;
  firstName: string;
  lastName?: string | null;
  avatarUrl?: string | null;
}

/**
 * "Location Progress" in the task details modal: one row per location the
 * task is carried out at, each with its own status, people, dates, time,
 * remarks, evidence and history. Renders nothing for a task without
 * locations unless the viewer can add some.
 */
@Component({
  selector: 'app-task-location-panel',
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    FormsModule,
    LocationPickerComponent,
    LocationDraftsComponent,
    LucideMapPin, LucidePlus, LucideX, LucideSearch, LucideCalendar,
    LucideClock, LucideCheck, LucideCheckCircle2, LucideAlertTriangle,
    LucideAlertCircle, LucideChevronDown, LucideChevronRight, LucideUser,
    LucideUsers, LucideUserPlus, LucideTrash2, LucideUpload, LucidePaperclip,
    LucideFileText, LucideMessageSquare, LucideSave, LucideLayers
  ],
  template: `
    @if (data(); as d) {
      @if (d.locations.length || d.canManage) {
        <section class="tlp-panel">
          <!-- Header -->
          <div class="tlp-panel-head">
            <div class="tlp-panel-title-group">
              <div class="tlp-panel-icon-badge">
                <svg lucideMapPin size="17"></svg>
              </div>
              <div>
                <h4 class="tlp-panel-title">Location Progress</h4>
                <p class="tlp-panel-subtitle">Track execution, assignees, hours, and files per location</p>
              </div>
            </div>

            @if (d.canManage) {
              <button
                type="button"
                class="tlp-btn-toggle-add"
                [class.is-active]="adding()"
                (click)="toggleAdding()"
              >
                @if (adding()) {
                  <svg lucideX size="14"></svg>
                  <span>Cancel</span>
                } @else {
                  <svg lucidePlus size="14"></svg>
                  <span>Add locations</span>
                }
              </button>
            }
          </div>

          <!-- Overall Progress Card -->
          @if (d.progress.total) {
            <div class="tlp-progress-card">
              <div class="tlp-progress-header">
                <div class="tlp-progress-stat">
                  <span class="tlp-stat-number">{{ d.progress.completed }} / {{ d.progress.total }}</span>
                  <span class="tlp-stat-label">completed ({{ d.progress.percent }}%)</span>
                </div>
                <div class="tlp-status-pills-row">
                  <span class="tlp-kpi-pill in-progress">
                    <span class="tlp-dot blue"></span>
                    {{ d.progress.inProgress }} in progress
                  </span>
                  <span class="tlp-kpi-pill not-started">
                    <span class="tlp-dot slate"></span>
                    {{ d.progress.notStarted }} not started
                  </span>
                  @if (d.progress.blocked) {
                    <span class="tlp-kpi-pill blocked">
                      <svg lucideAlertTriangle size="12"></svg>
                      {{ d.progress.blocked }} blocked
                    </span>
                  }
                  @if (d.progress.overdue) {
                    <span class="tlp-kpi-pill overdue">
                      <svg lucideClock size="12"></svg>
                      {{ d.progress.overdue }} overdue
                    </span>
                  }
                </div>
              </div>

              <div class="tlp-progress-track">
                <div class="tlp-progress-fill" [style.width.%]="d.progress.percent"></div>
              </div>
            </div>
          }

          <!-- Add Locations Drawer/Section -->
          @if (adding()) {
            <div class="tlp-add-drawer">
              <div class="tlp-drawer-title-row">
                <div>
                  <h5 class="tlp-drawer-title">Add Locations to Task</h5>
                  <p class="tlp-drawer-subtitle">Select locations from master data, assign team members, and set target due date</p>
                </div>
              </div>

              <app-location-picker [locations]="addable()" [(selected)]="addIds" />

              @if (addIds().length) {
                <!-- Per-Location Configuration Drafts -->
                <app-location-drafts
                  [locations]="master()"
                  [(selectedIds)]="addIds"
                  [people]="people()"
                  [defaultAssigneeIds]="taskMemberIds()"
                  [defaultStart]="today"
                  [defaultDue]="today"
                  [showErrors]="showAddErrors()"
                  [(drafts)]="addDrafts"
                  (removeLocation)="removeAddLocation($event)"
                />

                <div class="tlp-add-actions-bar">
                  <div class="tlp-add-tip">
                    <svg lucideLayers size="13"></svg>
                    <span>Configure each location individually, or click "Apply to all" inside any location to copy schedule & members.</span>
                  </div>
                  <div class="tlp-add-btns">
                    <button
                      type="button"
                      class="tlp-btn-action outline"
                      (click)="toggleAdding()"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="tlp-btn-action primary"
                      [disabled]="busy() || !addIds().length"
                      (click)="add()"
                    >
                      <svg lucidePlus size="14"></svg>
                      <span>Add {{ addIds().length }} Location{{ addIds().length === 1 ? '' : 's' }}</span>
                    </button>
                  </div>
                </div>
              }
            </div>
          }

          <!-- Search & Filters -->
          @if (d.locations.length) {
            <div class="tlp-filter-bar">
              <div class="tlp-search-container">
                <svg lucideSearch size="14" class="tlp-search-icon"></svg>
                <input
                  type="search"
                  class="tlp-search-input"
                  placeholder="Search locations or assignees…"
                  [value]="search()"
                  (input)="search.set($any($event.target).value)"
                />
                @if (search()) {
                  <button type="button" class="tlp-clear-search-btn" (click)="search.set('')" title="Clear search">
                    <svg lucideX size="13"></svg>
                  </button>
                }
              </div>

              <div class="tlp-filter-select-wrap">
                <select
                  class="tlp-filter-select"
                  [value]="statusFilter()"
                  (change)="statusFilter.set($any($event.target).value)"
                >
                  <option value="">All statuses</option>
                  @for (s of statuses; track s) {
                    <option [value]="s">{{ label[s] }}</option>
                  }
                  <option value="OVERDUE">Overdue</option>
                  <option value="REMOVED">Removed</option>
                </select>
              </div>
            </div>
          }

          <!-- Location Rows List -->
          <div class="tlp-locations-list">
            @for (r of shown(); track r.id) {
              <div
                class="tlp-location-card"
                [class.is-open]="openId() === r.id"
                [class.is-removed]="!!r.removedAt"
              >
                <!-- Location Summary Row -->
                <div class="tlp-loc-summary" (click)="toggleOpen(r)">
                  <div class="tlp-loc-left">
                    <svg
                      lucideChevronRight
                      size="15"
                      class="tlp-chevron"
                      [class.is-rotated]="openId() === r.id"
                    ></svg>

                    <div class="tlp-loc-pin-icon" [class]="r.status.toLowerCase()">
                      <svg lucideMapPin size="13"></svg>
                    </div>

                    <div class="tlp-loc-title-group">
                      <span class="tlp-loc-name">{{ name(r) }}</span>
                      @if (r.location?.level) {
                        <span class="tlp-level-tag" [class]="r.location.level.toLowerCase()">
                          {{ r.location.level.toLowerCase() }}
                        </span>
                      }
                    </div>
                  </div>

                  <div class="tlp-loc-middle">
                    <!-- Assignee Avatar Stack -->
                    <div class="tlp-assignee-stack">
                      @if (r.assignees.length) {
                        <div class="tlp-avatar-group">
                          @for (a of r.assignees.slice(0, 3); track a.employeeId) {
                            <div
                              class="tlp-stack-avatar"
                              [style.background-color]="!a.employee.avatarUrl ? getPersonColor(a.employeeId) : 'transparent'"
                              [title]="a.employee.firstName + ' ' + (a.employee.lastName || '')"
                            >
                              @if (a.employee.avatarUrl) {
                                <img [src]="a.employee.avatarUrl" [alt]="a.employee.firstName" class="tlp-avatar-img" />
                              } @else {
                                {{ getPersonInitials(a.employee) }}
                              }
                            </div>
                          }
                          @if (r.assignees.length > 3) {
                            <div class="tlp-stack-overflow" [title]="assigneeNames(r)">
                              +{{ r.assignees.length - 3 }}
                            </div>
                          }
                        </div>
                        <span class="tlp-assignees-text">{{ assigneeNames(r) }}</span>
                      } @else {
                        <span class="tlp-no-assignees-hint">Unassigned</span>
                      }
                    </div>

                    <!-- Due date -->
                    @if (r.dueDate) {
                      <span class="tlp-due-badge" [class.is-overdue]="r.overdue">
                        <svg lucideCalendar size="12"></svg>
                        <span>due {{ r.dueDate | date: 'd MMM' }}</span>
                      </span>
                    }

                    <!-- Quick stats -->
                    @if (r.loggedMinutes) {
                      <span class="tlp-stat-badge" title="Logged time">
                        <svg lucideClock size="12"></svg>
                        <span>{{ hours(r.loggedMinutes) }}</span>
                      </span>
                    }
                    @if (r._count.attachments) {
                      <span class="tlp-stat-badge" title="Evidence attachments">
                        <svg lucidePaperclip size="12"></svg>
                        <span>{{ r._count.attachments }}</span>
                      </span>
                    }
                  </div>

                  <div class="tlp-loc-right">
                    @if (r.removedAt) {
                      <span class="tlp-status-pill removed">Removed</span>
                    } @else {
                      <span class="tlp-status-pill" [class]="'pill-' + r.status.toLowerCase()">
                        <span class="tlp-pill-dot"></span>
                        {{ label[r.status] }}
                      </span>
                      @if (d.canManage) {
                        <button
                          type="button"
                          class="tlp-btn-remove-row"
                          title="Remove location"
                          aria-label="Remove location"
                          (click)="$event.stopPropagation(); remove(r)"
                        >
                          <svg lucideTrash2 size="13"></svg>
                        </button>
                      }
                    }
                  </div>
                </div>

                <!-- Location Details Body (Accordion content) -->
                @if (openId() === r.id) {
                  <div class="tlp-loc-expanded">
                    @if (r.removedAt) {
                      <div class="tlp-removed-notice">
                        <svg lucideAlertCircle size="15"></svg>
                        <span>This location was removed from the task. Its logged hours, files, and activity history are preserved.</span>
                      </div>
                    } @else {
                      <!-- Grid of 3 controls: Status, Start Date, Due Date -->
                      <div class="tlp-controls-grid">
                        <div class="tlp-control-col">
                          <label class="tlp-input-label">Status <span class="tlp-req">*</span></label>
                          <div class="tlp-status-select-wrap" [class]="'status-' + r.status.toLowerCase()">
                            <select
                              class="tlp-select status-select"
                              [value]="r.status"
                              [disabled]="!r.canUpdate || busy() || (!d.canManage && taskClosed())"
                              [title]="!d.canManage && taskClosed() ? 'This task is closed. Ask the project manager to reopen it.' : ''"
                              (change)="setStatus(r, $any($event.target).value)"
                            >
                              @for (s of statusOptions(r, d.canManage); track s) {
                                <option [value]="s" [disabled]="!d.canManage && !employeeStatuses.includes(s)">{{ label[s] }}</option>
                              }
                            </select>
                          </div>
                        </div>

                        <div class="tlp-control-col">
                          <label class="tlp-input-label">Start Date <span class="tlp-req">*</span></label>
                          <div class="tlp-input-with-icon">
                            <svg lucideCalendar size="14" class="tlp-field-icon"></svg>
                            <input
                              type="date"
                              class="tlp-input"
                              [value]="day(r.startDate)"
                              [disabled]="!d.canManage"
                              #editStartEl
                              (change)="updateStartDate(r, editStartEl.value, editStartEl)"
                            />
                          </div>
                        </div>

                        <div class="tlp-control-col">
                          <label class="tlp-input-label">Due Date <span class="tlp-req">*</span></label>
                          <div class="tlp-input-with-icon">
                            <svg lucideCalendar size="14" class="tlp-field-icon"></svg>
                            <input
                              type="date"
                              class="tlp-input"
                              [value]="day(r.dueDate)"
                              [min]="day(r.startDate) || null"
                              [disabled]="!d.canManage"
                              #editDueEl
                              (change)="updateDueDate(r, editDueEl.value, editDueEl)"
                            />
                          </div>
                        </div>
                      </div>

                      <!-- Alert banners for Blocked / Completed -->
                      @if (r.status === 'BLOCKED' && r.blockedReason) {
                        <div class="tlp-banner blocked">
                          <svg lucideAlertTriangle size="16"></svg>
                          <div>
                            <strong>Blocked:</strong> {{ r.blockedReason }}
                          </div>
                        </div>
                      }
                      @if (r.completedAt) {
                        <div class="tlp-banner completed">
                          <svg lucideCheckCircle2 size="16"></svg>
                          <div>
                            Completed on {{ r.completedAt | date: 'd MMM y, h:mm a' }}
                          </div>
                        </div>
                      }

                      <!-- Assigned Members Section -->
                      <div class="tlp-assignees-manage-card">
                        <div class="tlp-assignees-header">
                          <span class="tlp-subhead-title">Assigned Members</span>
                        </div>

                        <div class="tlp-assignees-row">
                          <div class="tlp-chips-group">
                            @for (a of r.assignees; track a.employeeId) {
                              <span class="tlp-member-chip">
                                <span class="tlp-chip-avatar" [style.background-color]="!a.employee.avatarUrl ? getPersonColor(a.employeeId) : 'transparent'">
                                  @if (a.employee.avatarUrl) {
                                    <img [src]="a.employee.avatarUrl" [alt]="a.employee.firstName" class="tlp-avatar-img" />
                                  } @else {
                                    {{ getPersonInitials(a.employee) }}
                                  }
                                </span>
                                <span class="tlp-chip-name">{{ a.employee.firstName }} {{ a.employee.lastName || '' }}</span>
                                @if (d.canManage) {
                                  <button
                                    type="button"
                                    class="tlp-chip-del"
                                    (click)="removeAssignee(r, a.employeeId)"
                                    title="Unassign member"
                                  >
                                    <svg lucideX size="11"></svg>
                                  </button>
                                }
                              </span>
                            } @empty {
                              <span class="tlp-empty-note">No members assigned to this location</span>
                            }
                          </div>

                          @if (d.canManage) {
                            <div class="tlp-dropdown-wrap">
                              <button
                                type="button"
                                class="tlp-btn-picker-trigger"
                                (click)="toggleRowAssignDropdown(r.id)"
                              >
                                <svg lucideUserPlus size="13"></svg>
                                <span>Assign member</span>
                                <svg lucideChevronDown size="12"></svg>
                              </button>

                              @if (assigningRowId() === r.id) {
                                <div class="tlp-popover-menu">
                                  <div class="tlp-popover-head">
                                    <span>Assign Project Member</span>
                                    <button type="button" class="tlp-popover-close" (click)="assigningRowId.set(null)">
                                      <svg lucideX size="12"></svg>
                                    </button>
                                  </div>
                                  <div class="tlp-popover-body">
                                    @for (p of getUnassignedPeople(r); track p.id) {
                                      <button
                                        type="button"
                                        class="tlp-popover-click-item"
                                        (click)="addAssigneeToRow(r, p.id)"
                                      >
                                        <span class="tlp-chip-avatar" [style.background-color]="!p.avatarUrl ? getPersonColor(p.id) : 'transparent'">
                                          @if (p.avatarUrl) {
                                            <img [src]="p.avatarUrl" [alt]="p.firstName" class="tlp-avatar-img" />
                                          } @else {
                                            {{ getPersonInitials(p) }}
                                          }
                                        </span>
                                        <span class="tlp-popover-name">{{ p.firstName }} {{ p.lastName || '' }}</span>
                                        <svg lucidePlus size="13" class="tlp-item-add-icon"></svg>
                                      </button>
                                    } @empty {
                                      <div class="tlp-popover-empty">All project members are already assigned</div>
                                    }
                                  </div>
                                </div>
                              }
                            </div>
                          }
                        </div>
                      </div>

                      <!-- Remarks Section -->
                      <div class="tlp-remarks-card">
                        <label class="tlp-input-label">Remarks & Notes</label>
                        <textarea
                          rows="2"
                          class="tlp-textarea"
                          placeholder="Add site observations, execution remarks, or handover notes…"
                          [value]="r.remarks ?? ''"
                          [disabled]="!r.canUpdate"
                          #remarks
                        ></textarea>

                        @if (r.canUpdate) {
                          <div class="tlp-remarks-actions">
                            <div class="tlp-actions-left">
                              <button
                                type="button"
                                class="tlp-btn-action outline"
                                (click)="patch(r, { remarks: remarks.value })"
                              >
                                <svg lucideSave size="13"></svg>
                                <span>Save remarks</span>
                              </button>

                            </div>

                            @if (d.canManage) {
                              <div class="tlp-actions-right">
                                <button
                                  type="button"
                                  class="tlp-btn-action danger"
                                  (click)="remove(r)"
                                >
                                  <svg lucideTrash2 size="13"></svg>
                                  <span>Remove location</span>
                                </button>
                              </div>
                            }
                          </div>
                        }
                      </div>

                      <!-- Log Time & Comments Cards -->
                      @if (r.canUpdate) {
                        <div class="tlp-subcards-grid">
                          <!-- Log Time Card -->
                          <div class="tlp-subcard">
                            <div class="tlp-subcard-head">
                              <div class="tlp-subcard-title">
                                <svg lucideClock size="14"></svg>
                                <span>Log Time</span>
                              </div>
                              <span class="tlp-subcard-badge">Logged: {{ hours(r.loggedMinutes) }}</span>
                            </div>
                            <div class="tlp-subcard-body">
                              <div class="tlp-subcard-form-row">
                                <div class="tlp-field-hours">
                                  <input
                                    type="number"
                                    min="0.25"
                                    step="0.25"
                                    placeholder="Hours (e.g. 1.5)"
                                    class="tlp-input"
                                    #h
                                  />
                                </div>
                                <div class="tlp-field-date">
                                  <input
                                    type="date"
                                    [value]="today"
                                    class="tlp-input"
                                    #logDate
                                  />
                                </div>
                              </div>
                              <div class="tlp-subcard-form-row mt-2">
                                <input
                                  type="text"
                                  placeholder="What was done at this location?"
                                  class="tlp-input flex-1"
                                  #note
                                />
                                <button
                                  type="button"
                                  class="tlp-btn-action primary"
                                  (click)="logTime(r, h.value, note.value, logDate.value); h.value=''; note.value=''"
                                >
                                  Log time
                                </button>
                              </div>
                            </div>
                          </div>

                          <!-- Comments & Evidence Card -->
                          <div class="tlp-subcard">
                            <div class="tlp-subcard-head">
                              <div class="tlp-subcard-title">
                                <svg lucideMessageSquare size="14"></svg>
                                <span>Comments & Evidence</span>
                              </div>
                              <span class="tlp-subcard-badge">{{ r._count.attachments }} file{{ r._count.attachments === 1 ? '' : 's' }}</span>
                            </div>
                            <div class="tlp-subcard-body">
                              <div class="tlp-subcard-form-row">
                                <input
                                  type="text"
                                  placeholder="Add a comment for this location…"
                                  class="tlp-input flex-1"
                                  #c
                                  (keydown.enter)="comment(r, c.value); c.value=''"
                                />
                                <button
                                  type="button"
                                  class="tlp-btn-action outline"
                                  (click)="comment(r, c.value); c.value=''"
                                >
                                  Comment
                                </button>
                              </div>
                              <div class="tlp-subcard-form-row mt-2">
                                @if (uploading()?.rowId === r.id) {
                                  <span class="tlp-btn-action file-btn is-uploading" aria-live="polite">
                                    <span class="tlp-spinner" aria-hidden="true"></span>
                                    <span>Uploading {{ uploading()!.count }} file{{ uploading()!.count === 1 ? '' : 's' }}…</span>
                                  </span>
                                } @else {
                                  <label class="tlp-btn-action file-btn" [class.is-disabled]="!!uploading()">
                                    <svg lucideUpload size="13"></svg>
                                    <span>Upload evidence</span>
                                    <input type="file" multiple hidden [disabled]="!!uploading()" (change)="upload(r, $event)" />
                                  </label>
                                }
                              </div>
                            </div>
                          </div>
                        </div>
                      }
                    }

                    <!-- Evidence Files & Activity Feed -->
                    <div class="tlp-history-section">
                      <div class="tlp-history-head">
                        <span class="tlp-history-title">Activity & Evidence</span>
                        <span class="tlp-history-count">{{ history().length + evidence().length }} entries</span>
                      </div>

                      <!-- Evidence Files Cards -->
                      @if (evidence().length) {
                        <div class="tlp-evidence-grid">
                          @for (f of evidence(); track f.id) {
                            <a [href]="f.fileUrl" target="_blank" rel="noopener" class="tlp-evidence-chip">
                              <svg lucideFileText size="15" class="tlp-file-icon"></svg>
                              <div class="tlp-file-info">
                                <span class="tlp-file-name">{{ f.fileName }}</span>
                                <span class="tlp-file-meta">
                                  {{ f.uploader?.firstName }} · {{ f.createdAt | date: 'd MMM, h:mm a' }}
                                </span>
                              </div>
                            </a>
                          }
                        </div>
                      }

                      <!-- Activity Timeline -->
                      <div class="tlp-timeline">
                        @for (a of history(); track a.id) {
                          <div class="tlp-timeline-item">
                            <div class="tlp-timeline-dot" [class]="getTimelineActionClass(a.action)">
                              @switch (a.action) {
                                @case ('TIME_LOGGED') { <svg lucideClock size="10"></svg> }
                                @case ('COMMENT') { <svg lucideMessageSquare size="10"></svg> }
                                @case ('STATUS_CHANGED') { <svg lucideMapPin size="10"></svg> }
                                @case ('ASSIGNED') { <svg lucideUser size="10"></svg> }
                                @case ('UNASSIGNED') { <svg lucideUser size="10"></svg> }
                                @case ('EVIDENCE_ADDED') { <svg lucidePaperclip size="10"></svg> }
                                @case ('REMOVED') { <svg lucideTrash2 size="10"></svg> }
                                @default { <svg lucideCheck size="10"></svg> }
                              }
                            </div>
                            <div class="tlp-timeline-content">
                              <div class="tlp-timeline-text">
                                <strong>{{ a.actor.firstName }} {{ a.actor.lastName || '' }}</strong>
                                <span> {{ describe(a) }}</span>
                              </div>
                              <span class="tlp-timeline-time">{{ a.createdAt | date: 'd MMM, h:mm a' }}</span>
                            </div>
                          </div>
                        } @empty {
                          @if (!evidence().length) {
                            <p class="tlp-history-empty">No activity recorded for this location yet.</p>
                          }
                        }
                      </div>
                    </div>
                  </div>
                }
              </div>
            } @empty {
              <div class="tlp-empty-locations">
                @if (d.locations.length) {
                  <svg lucideSearch size="22"></svg>
                  <p>No locations match your search or filter.</p>
                } @else {
                  <svg lucideMapPin size="22"></svg>
                  <p>This task has no locations assigned yet. Click <strong>+ Add locations</strong> to track execution across states, cities, or sites.</p>
                }
              </div>
            }
          </div>
        </section>
      }
    }
  `,
  styles: [`
    .tlp-panel {
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 16px;
      margin: 16px 0;
      background: #FFFFFF;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* Header */
    .tlp-panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .tlp-panel-title-group {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .tlp-panel-icon-badge {
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: #EFF6FF;
      color: #1373E5;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #DBEAFE;
      flex-shrink: 0;
    }

    .tlp-panel-title {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #0F172A;
      line-height: 1.2;
    }

    .tlp-panel-subtitle {
      margin: 2px 0 0 0;
      font-size: 12px;
      color: #64748B;
    }

    .tlp-btn-toggle-add {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid #CBD5E1;
      background: #FFFFFF;
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #1E293B;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .tlp-btn-toggle-add:hover {
      background: #F8FAFC;
      border-color: #94A3B8;
    }

    .tlp-btn-toggle-add.is-active {
      background: #F1F5F9;
      color: #475569;
    }

    /* Overall Progress */
    .tlp-progress-card {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tlp-progress-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .tlp-progress-stat {
      font-size: 12px;
      color: #334155;
      display: flex;
      align-items: baseline;
      gap: 5px;
    }

    .tlp-stat-number {
      font-weight: 700;
      color: #0F172A;
      font-size: 13px;
    }

    .tlp-stat-label {
      color: #64748B;
    }

    .tlp-status-pills-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .tlp-kpi-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }

    .tlp-kpi-pill.in-progress {
      background: #EFF6FF;
      color: #1D4ED8;
      border: 1px solid #DBEAFE;
    }

    .tlp-kpi-pill.not-started {
      background: #F1F5F9;
      color: #475569;
      border: 1px solid #E2E8F0;
    }

    .tlp-kpi-pill.blocked {
      background: #FEF2F2;
      color: #B91C1C;
      border: 1px solid #FECACA;
    }

    .tlp-kpi-pill.overdue {
      background: #FFFBEB;
      color: #B45309;
      border: 1px solid #FDE68A;
    }

    .tlp-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .tlp-dot.blue { background: #3B82F6; }
    .tlp-dot.slate { background: #94A3B8; }

    .tlp-progress-track {
      height: 7px;
      background: #E2E8F0;
      border-radius: 999px;
      overflow: hidden;
    }

    .tlp-progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #10B981, #059669);
      border-radius: 999px;
      transition: width 0.3s ease;
    }

    /* Add Locations Drawer */
    .tlp-add-drawer {
      border: 1px solid #DBEAFE;
      background: #F8FAFC;
      border-radius: 10px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .tlp-drawer-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .tlp-drawer-title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      color: #0F172A;
    }

    .tlp-drawer-subtitle {
      margin: 2px 0 0 0;
      font-size: 11px;
      color: #64748B;
    }

    .tlp-add-actions-bar {
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 9px;
      flex-wrap: wrap;
    }

    .tlp-add-tip {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: #64748B;
    }

    .tlp-add-tip svg {
      color: #1373E5;
      flex-shrink: 0;
    }

    .tlp-add-btns {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tlp-req {
      color: #DC2626;
      font-weight: 700;
      margin-left: 2px;
    }

    .tlp-input-label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 5px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .tlp-assignee-selection-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      min-height: 36px;
    }

    .tlp-selected-chips-wrap {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .tlp-member-chip {
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

    .tlp-chip-avatar {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      color: #FFFFFF;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      overflow: hidden;
    }

    .tlp-avatar-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      border-radius: 50%;
      display: block;
    }

    .tlp-chip-del {
      border: none;
      background: transparent;
      padding: 0;
      display: flex;
      align-items: center;
      color: #94A3B8;
      cursor: pointer;
      margin-left: 2px;
    }

    .tlp-chip-del:hover {
      color: #DC2626;
    }

    .tlp-dropdown-wrap {
      position: relative;
      display: inline-block;
    }

    .tlp-btn-picker-trigger {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px dashed #CBD5E1;
      background: #FFFFFF;
      border-radius: 8px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 500;
      color: #475569;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tlp-btn-picker-trigger:hover {
      border-color: #1373E5;
      color: #1373E5;
      background: #EFF6FF;
    }

    .tlp-popover-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      z-index: 50;
      width: 240px;
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.08);
      overflow: hidden;
    }

    .tlp-popover-head {
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

    .tlp-popover-close {
      border: none;
      background: transparent;
      padding: 2px;
      cursor: pointer;
      color: #94A3B8;
      display: flex;
    }

    .tlp-popover-close:hover {
      color: #0F172A;
    }

    .tlp-popover-body {
      max-height: 200px;
      overflow-y: auto;
      padding: 4px 0;
    }

    .tlp-popover-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      font-size: 12px;
      color: #1E293B;
      transition: background 0.1s ease;
    }

    .tlp-popover-item:hover {
      background: #F1F5F9;
    }

    .tlp-popover-click-item {
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

    .tlp-popover-click-item:hover {
      background: #EFF6FF;
      color: #1373E5;
    }

    .tlp-item-add-icon {
      margin-left: auto;
      color: #94A3B8;
    }

    .tlp-popover-empty {
      padding: 14px 10px;
      text-align: center;
      font-size: 12px;
      color: #94A3B8;
    }

    .tlp-input-with-icon {
      position: relative;
      display: flex;
      align-items: center;
    }

    .tlp-field-icon {
      position: absolute;
      left: 10px;
      color: #94A3B8;
      pointer-events: none;
    }

    .tlp-input-with-icon .tlp-input {
      padding-left: 32px;
    }

    .tlp-input, .tlp-select, .tlp-textarea {
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

    .tlp-input:focus, .tlp-select:focus, .tlp-textarea:focus {
      outline: none;
      border-color: #1373E5;
      box-shadow: 0 0 0 2px rgba(19, 115, 229, 0.15);
    }

    .tlp-btn-primary-add {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: #1373E5;
      color: #FFFFFF;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s ease;
    }

    .tlp-btn-primary-add:hover:not(:disabled) {
      background: #0D62C4;
    }

    .tlp-btn-primary-add:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Search & Filter Bar */
    .tlp-filter-bar {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .tlp-search-container {
      position: relative;
      flex: 1;
      display: flex;
      align-items: center;
    }

    .tlp-search-icon {
      position: absolute;
      left: 10px;
      color: #94A3B8;
      pointer-events: none;
    }

    .tlp-search-input {
      font: inherit;
      font-size: 12px;
      padding: 7px 30px 7px 32px;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      color: #0F172A;
      background: #FFFFFF;
      width: 100%;
      box-sizing: border-box;
      transition: all 0.15s ease;
    }

    .tlp-search-input:focus {
      outline: none;
      border-color: #1373E5;
      box-shadow: 0 0 0 2px rgba(19, 115, 229, 0.15);
    }

    .tlp-clear-search-btn {
      position: absolute;
      right: 8px;
      border: none;
      background: transparent;
      padding: 2px;
      color: #94A3B8;
      cursor: pointer;
      display: flex;
    }

    .tlp-clear-search-btn:hover {
      color: #0F172A;
    }

    .tlp-filter-select-wrap {
      min-width: 140px;
    }

    .tlp-filter-select {
      font: inherit;
      font-size: 12px;
      padding: 7px 10px;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      color: #1E293B;
      background: #FFFFFF;
      width: 100%;
      cursor: pointer;
    }

    /* Locations List */
    .tlp-locations-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tlp-location-card {
      border: 1px solid #E2E8F0;
      border-radius: 9px;
      background: #FFFFFF;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      overflow: hidden;
    }

    .tlp-location-card:hover {
      border-color: #CBD5E1;
    }

    .tlp-location-card.is-open {
      border-color: #93C5FD;
      box-shadow: 0 4px 12px rgba(19, 115, 229, 0.08);
    }

    .tlp-location-card.is-removed {
      opacity: 0.65;
      border-style: dashed;
    }

    /* Summary Row */
    .tlp-loc-summary {
      width: 100%;
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      user-select: none;
      background: #FFFFFF;
      transition: background 0.15s ease;
    }

    .tlp-loc-summary:hover {
      background: #F8FAFC;
    }

    .tlp-loc-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }

    .tlp-chevron {
      color: #94A3B8;
      transition: transform 0.2s ease;
      flex-shrink: 0;
    }

    .tlp-chevron.is-rotated {
      transform: rotate(90deg);
      color: #1373E5;
    }

    .tlp-loc-pin-icon {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      background: #F1F5F9;
      color: #64748B;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .tlp-loc-pin-icon.in_progress, .tlp-loc-pin-icon.in_review {
      background: #EFF6FF;
      color: #1D4ED8;
    }

    .tlp-loc-pin-icon.completed {
      background: #ECFDF5;
      color: #047857;
    }

    .tlp-loc-pin-icon.blocked {
      background: #FEF2F2;
      color: #B91C1C;
    }

    .tlp-loc-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .tlp-loc-name {
      font-size: 13px;
      font-weight: 600;
      color: #0F172A;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tlp-level-tag {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 6px;
      border-radius: 4px;
      letter-spacing: 0.04em;
    }

    .tlp-level-tag.state { background: #EEF2FF; color: #4338CA; }
    .tlp-level-tag.city { background: #EFF6FF; color: #1D4ED8; }
    .tlp-level-tag.site { background: #FAF5FF; color: #7E22CE; }

    .tlp-loc-middle {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .tlp-assignee-stack {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tlp-avatar-group {
      display: flex;
      align-items: center;
    }

    .tlp-stack-avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      color: #FFFFFF;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #FFFFFF;
      margin-left: -6px;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
      overflow: hidden;
    }

    .tlp-avatar-group .tlp-stack-avatar:first-child {
      margin-left: 0;
    }

    .tlp-stack-overflow {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #E2E8F0;
      color: #475569;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #FFFFFF;
      margin-left: -6px;
    }

    .tlp-assignees-text {
      font-size: 12px;
      color: #64748B;
      max-width: 160px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    @media (max-width: 900px) {
      .tlp-assignees-text {
        display: none;
      }
    }

    .tlp-no-assignees-hint {
      font-size: 11px;
      color: #94A3B8;
      font-style: italic;
    }

    .tlp-due-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #64748B;
      padding: 2px 7px;
      border-radius: 6px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      white-space: nowrap;
    }

    .tlp-due-badge.is-overdue {
      color: #DC2626;
      background: #FEF2F2;
      border-color: #FECACA;
      font-weight: 600;
    }

    .tlp-stat-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #64748B;
      padding: 2px 6px;
      border-radius: 6px;
      background: #F1F5F9;
    }

    .tlp-loc-right {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .tlp-btn-remove-row {
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

    .tlp-btn-remove-row:hover {
      background: #FEE2E2;
      color: #DC2626;
    }

    .tlp-status-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }

    .tlp-status-pill.pill-not_started {
      background: #F1F5F9;
      color: #475569;
      border: 1px solid #E2E8F0;
    }

    .tlp-status-pill.pill-in_progress, .tlp-status-pill.pill-in_review {
      background: #EFF6FF;
      color: #1D4ED8;
      border: 1px solid #BFDBFE;
    }

    .tlp-status-pill.pill-completed {
      background: #ECFDF5;
      color: #047857;
      border: 1px solid #A7F3D0;
    }

    .tlp-status-pill.pill-blocked {
      background: #FEF2F2;
      color: #B91C1C;
      border: 1px solid #FECACA;
    }

    .tlp-status-pill.removed {
      background: #F3F4F6;
      color: #6B7280;
      border: 1px solid #E5E7EB;
    }

    .tlp-pill-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
    }

    /* Expanded Details Body */
    .tlp-loc-expanded {
      padding: 14px;
      border-top: 1px solid #F1F5F9;
      background: #FAFCFF;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .tlp-removed-notice {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 7px;
      color: #64748B;
      font-size: 12px;
    }

    /* Controls Grid: Status, Start Date, Due Date */
    .tlp-controls-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 12px;
    }

    @media (max-width: 680px) {
      .tlp-controls-grid {
        grid-template-columns: 1fr;
      }
    }

    .tlp-control-col {
      display: flex;
      flex-direction: column;
    }

    .tlp-status-select-wrap {
      border-radius: 7px;
      overflow: hidden;
    }

    .status-select {
      font-weight: 600;
    }

    /* Alerts */
    .tlp-banner {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 7px;
      font-size: 12px;
    }

    .tlp-banner.blocked {
      background: #FEF2F2;
      border: 1px solid #FECACA;
      color: #B91C1C;
    }

    .tlp-banner.completed {
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      color: #047857;
    }

    /* Assigned Members Management */
    .tlp-assignees-manage-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tlp-subhead-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #475569;
    }

    .tlp-assignees-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .tlp-chips-group {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .tlp-empty-note {
      font-size: 12px;
      color: #94A3B8;
      font-style: italic;
    }

    /* Remarks Card */
    .tlp-remarks-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tlp-textarea {
      resize: vertical;
      min-height: 50px;
    }

    .tlp-remarks-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .tlp-actions-left, .tlp-actions-right {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .tlp-btn-action {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      font-weight: 600;
      padding: 6px 11px;
      border-radius: 7px;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .tlp-btn-action.outline {
      border-color: #CBD5E1;
      background: #FFFFFF;
      color: #1E293B;
    }

    .tlp-btn-action.outline:hover {
      background: #F8FAFC;
      border-color: #94A3B8;
    }

    .tlp-btn-action.primary {
      background: #1373E5;
      color: #FFFFFF;
    }

    .tlp-btn-action.primary:hover {
      background: #0D62C4;
    }

    .tlp-btn-action.complete {
      background: #10B981;
      color: #FFFFFF;
    }

    .tlp-btn-action.complete:hover {
      background: #059669;
    }

    .tlp-btn-action.danger {
      border-color: #FECACA;
      background: #FFFFFF;
      color: #DC2626;
    }

    .tlp-btn-action.danger:hover {
      background: #FEF2F2;
      border-color: #EF4444;
    }

    .tlp-btn-action.file-btn {
      border: 1px dashed #CBD5E1;
      background: #FFFFFF;
      color: #475569;
    }

    .tlp-btn-action.file-btn:hover {
      border-color: #1373E5;
      color: #1373E5;
      background: #EFF6FF;
    }

    /* Subcards: Log Time & Comments */
    .tlp-subcards-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    @media (max-width: 768px) {
      .tlp-subcards-grid {
        grid-template-columns: 1fr;
      }
    }

    .tlp-subcard {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .tlp-subcard-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .tlp-subcard-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 700;
      color: #334155;
    }

    .tlp-subcard-badge {
      font-size: 11px;
      font-weight: 600;
      color: #64748B;
      background: #F1F5F9;
      padding: 1px 7px;
      border-radius: 999px;
    }

    .tlp-subcard-body {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .tlp-subcard-form-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .tlp-field-hours {
      width: 120px;
    }

    .tlp-field-date {
      flex: 1;
    }

    .flex-1 {
      flex: 1;
    }

    .mt-2 {
      margin-top: 6px;
    }

    /* History & Evidence */
    .tlp-history-section {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .tlp-history-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .tlp-history-title {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
    }

    .tlp-history-count {
      font-size: 11px;
      color: #64748B;
    }

    .tlp-evidence-grid {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .tlp-evidence-chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 7px;
      padding: 6px 10px;
      text-decoration: none;
      color: #1E293B;
      transition: all 0.15s ease;
      max-width: 260px;
    }

    .tlp-evidence-chip:hover {
      border-color: #1373E5;
      background: #EFF6FF;
    }

    .tlp-file-icon {
      color: #1373E5;
      flex-shrink: 0;
    }

    .tlp-file-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .tlp-file-name {
      font-size: 12px;
      font-weight: 600;
      color: #0F172A;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .tlp-file-meta {
      font-size: 10px;
      color: #64748B;
    }

    /* Timeline */
    .tlp-timeline {
      position: relative;
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .tlp-timeline::before {
      content: '';
      position: absolute;
      left: 7px;
      top: 6px;
      bottom: 6px;
      width: 2px;
      background: #E2E8F0;
    }

    .tlp-timeline-item {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .tlp-timeline-dot {
      position: absolute;
      left: -20px;
      top: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #FFFFFF;
      border: 2px solid #94A3B8;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748B;
      box-shadow: 0 0 0 2px #FFFFFF;
      z-index: 1;
    }

    .tlp-timeline-dot.act-time { border-color: #F59E0B; color: #D97706; background: #FEF3C7; }
    .tlp-timeline-dot.act-comment { border-color: #3B82F6; color: #2563EB; background: #EFF6FF; }
    .tlp-timeline-dot.act-status { border-color: #6366F1; color: #4F46E5; background: #EEF2FF; }
    .tlp-timeline-dot.act-assign { border-color: #8B5CF6; color: #7C3AED; background: #F5F3FF; }
    .tlp-timeline-dot.act-evidence { border-color: #10B981; color: #059669; background: #ECFDF5; }
    .tlp-timeline-dot.act-remove { border-color: #EF4444; color: #DC2626; background: #FEF2F2; }

    .tlp-timeline-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
      font-size: 12px;
      color: #334155;
    }

    .tlp-timeline-text strong {
      color: #0F172A;
    }

    .tlp-timeline-time {
      font-size: 11px;
      color: #94A3B8;
    }

    .tlp-history-empty {
      margin: 4px 0;
      font-size: 12px;
      color: #94A3B8;
      font-style: italic;
    }

    /* Empty state */
    .tlp-empty-locations {
      text-align: center;
      padding: 24px 16px;
      background: #F8FAFC;
      border: 1px dashed #CBD5E1;
      border-radius: 10px;
      color: #64748B;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .tlp-empty-locations svg {
      color: #94A3B8;
    }

    .tlp-empty-locations p {
      margin: 0;
      font-size: 12px;
      max-width: 360px;
      line-height: 1.4;
    }
    .tlp-btn-action.is-uploading { cursor: progress; opacity: .85; }
    .tlp-btn-action.is-disabled { opacity: .5; pointer-events: none; }
    .tlp-spinner { width: 13px; height: 13px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: tlp-spin .7s linear infinite; flex-shrink: 0; }
    @keyframes tlp-spin { to { transform: rotate(360deg); } }
  `]
})
export class TaskLocationPanelComponent implements OnChanges {
  private api = inject(TaskLocationsService);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);

  projectId = input.required<number>();
  issueId = input.required<number>();
  /** Who can be put on a location — the project's people. */
  people = input<PanelPerson[]>([]);
  /** The task's own members — each newly added location starts with them. */
  taskMemberIds = input<number[]>([]);
  /** Fired after any change, so the board can refresh the card. */
  changed = output<IssueLocations>();

  readonly statuses: LocationStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'COMPLETED'];
  /** What an employee may set on their own location; managers have every status. */
  readonly employeeStatuses: LocationStatus[] = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'];

  /**
   * The status choices for one location. An employee gets their three, plus
   * the location's current status shown (but not selectable) when it is one
   * only a manager sets, such as Blocked.
   */
  statusOptions(r: IssueLocationRow, canManage: boolean): LocationStatus[] {
    if (canManage) return this.statuses;
    return this.employeeStatuses.includes(r.status) ? this.employeeStatuses : [r.status, ...this.employeeStatuses];
  }

  /** Done or cancelled: employees can no longer change their locations. */
  taskClosed(): boolean {
    const s = this.data()?.taskStatus;
    return s === 'DONE' || s === 'CANCELLED';
  }
  readonly label = LOCATION_STATUS_LABEL;
  readonly today = new Date().toISOString().slice(0, 10);

  data = signal<IssueLocations | null>(null);
  master = signal<TaskLocation[]>([]);
  busy = signal(false);
  adding = signal(false);
  addIds = signal<number[]>([]);
  addDrafts = signal<LocationDraft[]>([]);
  showAddErrors = signal<boolean>(false);
  search = signal('');
  statusFilter = signal('');
  openId = signal<number | null>(null);
  history = signal<LocationActivity[]>([]);
  evidence = signal<any[]>([]);

  assigningRowId = signal<number | null>(null);

  ngOnChanges() { this.load(); }

  load() {
    this.api.forIssue(this.projectId(), this.issueId()).subscribe({
      next: (d) => {
        this.data.set(d);
        if (d.canManage && !this.master().length) this.api.list(true).subscribe((m) => this.master.set(m));
      },
      error: () => this.data.set(null),
    });
  }

  /** Active master locations not already (actively) on the task. */
  addable = computed(() => {
    const on = new Set((this.data()?.locations ?? []).filter((l) => !l.removedAt).map((l) => l.locationId));
    return this.master().filter((m) => !on.has(m.id));
  });

  shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.statusFilter();
    return (this.data()?.locations ?? []).filter((r) => {
      if (f === 'REMOVED') { if (!r.removedAt) return false; }
      else if (r.removedAt && f) return false;
      else if (f === 'OVERDUE') { if (!r.overdue) return false; }
      else if (f && r.status !== f) return false;
      return !q || this.name(r).toLowerCase().includes(q) || this.assigneeNames(r).toLowerCase().includes(q);
    });
  });

  name(r: IssueLocationRow) { return locationLabel(r.location); }

  assigneeNames(r: IssueLocationRow) {
    return r.assignees.map((a) => a.employee.firstName).join(', ');
  }

  hasAssignee(r: IssueLocationRow, id: number) {
    return r.assignees.some((a) => a.employeeId === id);
  }

  day(d: string | null) { return d ? d.slice(0, 10) : ''; }

  hours(min = 0) { return `${Math.round((min / 60) * 100) / 100}h`; }

  toggleOpen(r: IssueLocationRow) {
    if (this.openId() === r.id) {
      this.openId.set(null);
      this.assigningRowId.set(null);
      return;
    }
    this.openId.set(r.id);
    this.assigningRowId.set(null);
    this.loadHistory(r);
  }

  toggleAdding() {
    const next = !this.adding();
    this.adding.set(next);
    if (!next) {
      this.addIds.set([]);
      this.addDrafts.set([]);
      this.showAddErrors.set(false);
    }
  }

  getUnassignedPeople(r: IssueLocationRow): PanelPerson[] {
    const assignedIds = new Set(r.assignees.map((a) => a.employeeId));
    return this.people().filter((p) => !assignedIds.has(p.id));
  }

  toggleRowAssignDropdown(rowId: number) {
    this.assigningRowId.set(this.assigningRowId() === rowId ? null : rowId);
  }

  addAssigneeToRow(r: IssueLocationRow, personId: number) {
    const current = r.assignees.map((a) => a.employeeId);
    if (!current.includes(personId)) {
      this.patch(r, { assigneeIds: [...current, personId] });
    }
    this.assigningRowId.set(null);
  }

  removeAssignee(r: IssueLocationRow, personId: number) {
    const updated = r.assignees.map((a) => a.employeeId).filter((id) => id !== personId);
    this.patch(r, { assigneeIds: updated });
  }

  getPersonInitials(p: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
    if (!p) return '?';
    const f = (p.firstName || '').trim()[0] || '';
    const l = (p.lastName || '').trim()[0] || '';
    return (f + l).toUpperCase() || '?';
  }

  getPersonColor(id: number): string {
    const colors = [
      '#2563EB', '#059669', '#7C3AED', '#D97706',
      '#DB2777', '#0891B2', '#4F46E5', '#0D9488'
    ];
    return colors[Math.abs(id) % colors.length];
  }

  getTimelineActionClass(action: string): string {
    switch (action) {
      case 'TIME_LOGGED': return 'act-time';
      case 'COMMENT': return 'act-comment';
      case 'STATUS_CHANGED': return 'act-status';
      case 'ASSIGNED':
      case 'UNASSIGNED': return 'act-assign';
      case 'EVIDENCE_ADDED': return 'act-evidence';
      case 'REMOVED': return 'act-remove';
      default: return 'act-default';
    }
  }

  private loadHistory(r: IssueLocationRow) {
    this.history.set([]);
    this.evidence.set([]);
    this.api.activity(this.projectId(), this.issueId(), r.id).subscribe((h) => {
      this.history.set(h.activity);
      this.evidence.set(h.evidence);
    });
  }

  private apply(obs: any, ok?: string, row?: IssueLocationRow) {
    this.busy.set(true);
    obs.subscribe({
      next: (d: IssueLocations) => {
        this.busy.set(false);
        if (d && 'locations' in d) {
          this.data.set(d);
          this.changed.emit(d);
        } else {
          this.load();
        }
        if (ok) this.toast.success(ok);
        if (row && this.openId() === row.id) this.loadHistory(row);
      },
      error: (e: any) => {
        this.busy.set(false);
        this.toast.error(e?.error?.message || 'That did not save.');
        this.load();
      },
    });
  }

  removeAddLocation(id: number) {
    this.addIds.update((ids) => ids.filter((x) => x !== id));
  }

  updateStartDate(r: IssueLocationRow, dateVal: string, inputEl: HTMLInputElement) {
    if (!dateVal) {
      this.toast.error('Start date is required.');
      inputEl.value = this.day(r.startDate);
      return;
    }
    const due = this.day(r.dueDate);
    if (due && dateVal > due) {
      // Auto-advance due date to match the future start date
      this.patch(r, { startDate: dateVal, dueDate: dateVal });
      this.toast.info('Due date adjusted to match start date.');
      return;
    }
    this.patch(r, { startDate: dateVal });
  }

  updateDueDate(r: IssueLocationRow, dateVal: string, inputEl: HTMLInputElement) {
    if (!dateVal) {
      this.toast.error('Due date is required.');
      inputEl.value = this.day(r.dueDate);
      return;
    }
    const start = this.day(r.startDate);
    if (start && dateVal < start) {
      this.toast.error('Due date cannot be before start date.');
      inputEl.value = this.day(r.dueDate);
      return;
    }
    this.patch(r, { dueDate: dateVal });
  }

  add() {
    if (!this.addIds().length) {
      this.toast.error('Choose at least one location to add.');
      return;
    }
    // One draft per picked location, read against the picks themselves: a
    // pick whose details never arrived must stop here with a clear message
    // rather than reach the server as an empty list.
    const byId = new Map(this.addDrafts().map((d) => [d.locationId, d]));
    const missing = this.addIds().filter((id) => !byId.has(id));
    if (missing.length) {
      this.showAddErrors.set(true);
      this.toast.error('Fill in the details for each location before adding.');
      return;
    }
    const drafts = this.addIds().map((id) => byId.get(id)!);
    const incomplete = drafts.some((d) => !draftComplete(d));
    if (incomplete) {
      this.showAddErrors.set(true);
      this.toast.error('Each location needs a status, start and due dates, and at least one member.');
      return;
    }
    for (const d of drafts) {
      if (d.startDate && d.dueDate && d.dueDate < d.startDate) {
        this.showAddErrors.set(true);
        this.toast.error('Due date cannot be before start date.');
        return;
      }
    }

    const payload = drafts.map(({ touched, ...clean }) => clean);
    this.apply(
      this.api.add(this.projectId(), this.issueId(), {
        locations: payload,
      }),
      'Locations added'
    );
    this.addIds.set([]);
    this.addDrafts.set([]);
    this.showAddErrors.set(false);
    this.adding.set(false);
  }

  async setStatus(r: IssueLocationRow, status: LocationStatus) {
    const body: any = { status };
    if (status === 'BLOCKED') {
      const reason = await this.dialog.prompt(
        'What is blocking this location?',
        'Location blocked',
        { required: true, confirmLabel: 'Mark blocked' }
      );
      if (!reason?.trim()) { this.load(); return; }
      body.blockedReason = reason.trim();
    }
    this.apply(this.api.updateRow(this.projectId(), this.issueId(), r.id, body), undefined, r);
  }

  patch(r: IssueLocationRow, body: any) {
    this.apply(this.api.updateRow(this.projectId(), this.issueId(), r.id, body), 'Saved', r);
  }

  async remove(r: IssueLocationRow) {
    const ok = await this.dialog.confirm(
      `Remove ${this.name(r)} from this task? If work was recorded there, its time, files and history are kept.`,
      'Remove location', 'Remove', 'Cancel', 'danger'
    );
    if (!ok) return;
    this.apply(this.api.removeRow(this.projectId(), this.issueId(), r.id), 'Location removed');
  }

  logTime(r: IssueLocationRow, hours: string, note: string, date: string) {
    const durationMin = Math.round(Number(hours) * 60);
    if (!durationMin || durationMin <= 0) {
      this.toast.error('Enter the hours spent.');
      return;
    }
    this.apply(this.api.logTime(this.projectId(), this.issueId(), r.id, { durationMin, note, date }), 'Time logged', r);
  }

  comment(r: IssueLocationRow, body: string) {
    if (!body.trim()) return;
    this.api.comment(this.projectId(), this.issueId(), r.id, body.trim()).subscribe({
      next: () => this.loadHistory(r),
      error: (e) => this.toast.error(e?.error?.message || 'Comment not saved.'),
    });
  }

  /** The location whose evidence is uploading, and how many files — drives the spinner. */
  uploading = signal<{ rowId: number; count: number } | null>(null);

  /**
   * Upload to the task, then link the files to this location. The spinner
   * stays up through both steps, and every upload button is disabled until
   * they finish, so a slow upload cannot be started twice.
   */
  upload(r: IssueLocationRow, e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (!files.length || this.uploading()) return;
    this.uploading.set({ rowId: r.id, count: files.length });
    const fail = (err: any) => {
      this.uploading.set(null);
      this.toast.error(err?.error?.message || 'Upload failed.');
    };
    this.api.uploadToTask(this.projectId(), this.issueId(), files).subscribe({
      next: (res) => {
        const ids = (Array.isArray(res) ? res : [res]).map((a: any) => a.id);
        this.api.linkEvidence(this.projectId(), this.issueId(), r.id, ids).subscribe({
          next: (d) => {
            this.uploading.set(null);
            this.data.set(d);
            this.changed.emit(d);
            this.toast.success(files.length === 1 ? 'Evidence uploaded' : `${files.length} files uploaded`);
            if (this.openId() === r.id) this.loadHistory(r);
          },
          error: fail,
        });
      },
      error: fail,
    });
  }

  describe(a: LocationActivity): string {
    switch (a.action) {
      case 'ADDED': return 'added this location to the task';
      case 'REMOVED': return 'removed this location from the task';
      case 'RESTORED': return 'restored this location to the task';
      case 'ASSIGNED': return `assigned ${a.personName ?? 'a member'}`;
      case 'UNASSIGNED': return `unassigned ${a.personName ?? 'a member'}`;
      case 'STATUS_CHANGED':
        return `changed status from ${this.label[a.oldValue as LocationStatus] ?? a.oldValue} to ${this.label[a.newValue as LocationStatus] ?? a.newValue}`
          + (a.body ? ` — "${a.body}"` : '');
      case 'COMMENT': return `commented: "${a.body}"`;
      case 'TIME_LOGGED': return `logged ${this.hours(Number(a.newValue))}${a.body ? ` — "${a.body}"` : ''}`;
      case 'EVIDENCE_ADDED': return `attached evidence: ${a.body}`;
      case 'UPDATED': return `updated ${a.field === 'blockedReason' ? 'block reason' : a.field} to ${a.newValue || '(empty)'}`;
      default: return a.action.toLowerCase();
    }
  }
}
