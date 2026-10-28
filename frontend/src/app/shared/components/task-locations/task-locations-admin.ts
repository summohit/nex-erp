import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucidePlus, LucideX, LucideSearch, LucideGlobe, LucideBuilding, LucideBuilding2,
  LucideMapPin, LucideChevronDown, LucideChevronRight, LucidePencil, LucideTrash2,
  LucideLayers, LucideRotateCcw, LucideCheck, LucideUpload, LucideSliders,
  LucideChevronsUpDown, LucideFolderPlus, LucideAlertCircle, LucideInfo
} from '@lucide/angular';
import { DialogService } from '../../services/dialog.service';
import { TaskLocationsService, TaskLocation } from '../../../services/task-locations.service';
import { INDIA_LOCATIONS, suggestedCities } from './india-locations';

interface ChildStats {
  cities: number;
  sites: number;
  total: number;
}

interface TreeRow {
  loc: TaskLocation;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  childStats: ChildStats;
  parentPath: string | null;
}

@Component({
  selector: 'app-task-locations-admin',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucidePlus, LucideX, LucideSearch, LucideGlobe, LucideBuilding, LucideBuilding2,
    LucideMapPin, LucideChevronDown, LucideChevronRight, LucidePencil, LucideTrash2,
    LucideLayers, LucideRotateCcw, LucideCheck, LucideUpload, LucideSliders,
    LucideChevronsUpDown, LucideFolderPlus, LucideAlertCircle, LucideInfo
  ],
  template: `
    <div class="tla-wrapper">
      <!-- ── STATS DASHBOARD ─────────────────────────────────────────── -->
      <div class="tla-stats-grid">
        <div class="stat-card" [class.active-filter]="levelFilter() === 'ALL'" (click)="setLevelFilter('ALL')">
          <div class="stat-icon-wrapper total">
            <svg lucideMapPin size="18"></svg>
          </div>
          <div class="stat-details">
            <span class="stat-num">{{ stats().total }}</span>
            <span class="stat-label">Total Locations</span>
          </div>
        </div>

        <div class="stat-card" [class.active-filter]="levelFilter() === 'STATE'" (click)="setLevelFilter('STATE')">
          <div class="stat-icon-wrapper states">
            <svg lucideGlobe size="18"></svg>
          </div>
          <div class="stat-details">
            <span class="stat-num">{{ stats().states }}</span>
            <span class="stat-label">States / Regions</span>
          </div>
        </div>

        <div class="stat-card" [class.active-filter]="levelFilter() === 'CITY'" (click)="setLevelFilter('CITY')">
          <div class="stat-icon-wrapper cities">
            <svg lucideBuilding2 size="18"></svg>
          </div>
          <div class="stat-details">
            <span class="stat-num">{{ stats().cities }}</span>
            <span class="stat-label">Cities / Districts</span>
          </div>
        </div>

        <div class="stat-card" [class.active-filter]="levelFilter() === 'SITE'" (click)="setLevelFilter('SITE')">
          <div class="stat-icon-wrapper sites">
            <svg lucideMapPin size="18"></svg>
          </div>
          <div class="stat-details">
            <span class="stat-num">{{ stats().sites }}</span>
            <span class="stat-label">Work Sites / Branches</span>
          </div>
        </div>

        <div class="stat-card status-stat">
          <div class="status-indicator-pills">
            <div class="status-item active">
              <span class="status-dot green"></span>
              <span class="status-count">{{ stats().active }}</span>
              <span class="status-text">Active</span>
            </div>
            <div class="status-item disabled">
              <span class="status-dot gray"></span>
              <span class="status-count">{{ stats().disabled }}</span>
              <span class="status-text">Disabled</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ── TOOLBAR ────────────────────────────────────────────────── -->
      <div class="tla-toolbar">
        <div class="toolbar-left">
          <div class="search-box">
            <svg lucideSearch size="16" class="search-icon"></svg>
            <input
              type="text"
              class="search-input"
              placeholder="Search by name, code, or hierarchy…"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
            @if (query()) {
              <button type="button" class="clear-search-btn" (click)="query.set('')" title="Clear search">
                <svg lucideX size="14"></svg>
              </button>
            }
          </div>

          <div class="level-tabs">
            <button
              type="button"
              class="level-tab-btn"
              [class.active]="levelFilter() === 'ALL'"
              (click)="setLevelFilter('ALL')">
              All <span class="tab-badge">{{ stats().total }}</span>
            </button>
            <button
              type="button"
              class="level-tab-btn"
              [class.active]="levelFilter() === 'STATE'"
              (click)="setLevelFilter('STATE')">
              States <span class="tab-badge">{{ stats().states }}</span>
            </button>
            <button
              type="button"
              class="level-tab-btn"
              [class.active]="levelFilter() === 'CITY'"
              (click)="setLevelFilter('CITY')">
              Cities <span class="tab-badge">{{ stats().cities }}</span>
            </button>
            <button
              type="button"
              class="level-tab-btn"
              [class.active]="levelFilter() === 'SITE'"
              (click)="setLevelFilter('SITE')">
              Sites <span class="tab-badge">{{ stats().sites }}</span>
            </button>
          </div>
        </div>

        <div class="toolbar-right">
          @if (!query() && levelFilter() === 'ALL' && stats().states > 0) {
            <div class="tree-controls">
              <button type="button" class="btn-subtle" (click)="expandAll()" title="Expand all branches">
                <svg lucideChevronDown size="14"></svg>
                <span>Expand all</span>
              </button>
              <button type="button" class="btn-subtle" (click)="collapseAll()" title="Collapse all branches">
                <svg lucideChevronRight size="14"></svg>
                <span>Collapse all</span>
              </button>
            </div>
          }

          <label class="toggle-label" title="Toggle visibility of deactivated locations">
            <input
              type="checkbox"
              class="custom-checkbox"
              [checked]="showInactive()"
              (change)="showInactive.set(!showInactive())"
            />
            <span>Show disabled</span>
          </label>

          <button
            type="button"
            class="btn-icon-subtle"
            (click)="load()"
            [disabled]="loading()"
            title="Refresh locations">
            <svg lucideRotateCcw size="15" [class.spin]="loading()"></svg>
          </button>

          <button type="button" class="btn-primary" (click)="openCreateModal()">
            <svg lucidePlus size="16"></svg>
            <span>Add Location</span>
          </button>
        </div>
      </div>

      <!-- ── LOCATION HIERARCHY TABLE ────────────────────────────────── -->
      <div class="table-card">
        <table class="tla-table">
          <thead>
            <tr>
              <th class="th-name">Location & Hierarchy</th>
              <th class="th-level">Level</th>
              <th class="th-code">Code</th>
              <th class="th-usage">Usage</th>
              <th class="th-status">Status</th>
              <th class="th-actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.loc.id) {
              <tr class="tla-row" [class.row-inactive]="!r.loc.isActive" [class.is-state]="r.loc.level === 'STATE'"
                  [class.row-expandable]="canToggle(r)" (click)="onRowClick(r, $event)">
                <!-- Name Column with Hierarchy Indent & Connectors -->
                <td class="td-name">
                  <div class="name-cell-inner" [style.padding-left.px]="r.depth * 28">
                    <!-- Tree guide line -->
                    @if (r.depth > 0) {
                      <!-- Hangs from the centre of the parent's icon: its indent, the 20px chevron, the 8px gap, half the 26px badge. -->
                      <span class="tree-connector" aria-hidden="true" [style.left.px]="(r.depth - 1) * 28 + 41"></span>
                    }

                    <!-- Expand/Collapse Chevron -->
                    @if (r.hasChildren && !query() && levelFilter() === 'ALL') {
                      <button
                        type="button"
                        class="chevron-btn"
                        [class.expanded]="!r.isCollapsed"
                        (click)="toggleCollapse(r.loc.id)"
                        [title]="r.isCollapsed ? 'Expand child locations' : 'Collapse child locations'">
                        @if (r.isCollapsed) { <svg lucideChevronRight size="14"></svg> } @else { <svg lucideChevronDown size="14"></svg> }
                      </button>
                    } @else {
                      <span class="chevron-placeholder"></span>
                    }

                    <!-- Level Icon Badge -->
                    <div class="level-icon-badge" [ngClass]="r.loc.level.toLowerCase()">
                      @if (r.loc.level === 'STATE') {
                        <svg lucideGlobe size="14"></svg>
                      } @else if (r.loc.level === 'CITY') {
                        <svg lucideBuilding2 size="14"></svg>
                      } @else {
                        <svg lucideMapPin size="14"></svg>
                      }
                    </div>

                    <!-- Location Name & Breadcrumbs -->
                    <div class="name-text-col">
                      @if (r.parentPath && (query() || levelFilter() !== 'ALL')) {
                        <span class="parent-breadcrumb">{{ r.parentPath }}</span>
                      }
                      <span class="location-name" [title]="r.loc.name">
                        {{ r.loc.name }}
                      </span>
                    </div>

                    <!-- Child Counter Badges -->
                    @if (r.childStats.total > 0 && !query() && levelFilter() === 'ALL') {
                      <div class="child-count-pill" [class.collapsed-pill]="r.isCollapsed">
                        @if (r.loc.level === 'STATE') {
                          <span>{{ r.childStats.cities }} {{ r.childStats.cities === 1 ? 'city' : 'cities' }}</span>
                          @if (r.childStats.sites > 0) {
                            <span class="dot-sep">•</span>
                            <span>{{ r.childStats.sites }} {{ r.childStats.sites === 1 ? 'site' : 'sites' }}</span>
                          }
                        } @else if (r.loc.level === 'CITY' && r.childStats.sites > 0) {
                          <span>{{ r.childStats.sites }} {{ r.childStats.sites === 1 ? 'site' : 'sites' }}</span>
                        }
                      </div>
                    }
                  </div>
                </td>

                <!-- Level Badge -->
                <td class="td-level">
                  <span class="level-pill" [ngClass]="r.loc.level.toLowerCase()">
                    {{ r.loc.level === 'STATE' ? 'State' : r.loc.level === 'CITY' ? 'City' : 'Site' }}
                  </span>
                </td>

                <!-- Code Input (Monospace with auto-save) -->
                <td class="td-code">
                  <div class="code-wrapper">
                    <input
                      type="text"
                      class="code-input"
                      placeholder="e.g. MH"
                      [value]="r.loc.code ?? ''"
                      (change)="saveCode(r.loc, $any($event.target).value)"
                      maxlength="20"
                    />
                    @if (codeSavingId() === r.loc.id) {
                      <span class="code-indicator saving" title="Saving code…">…</span>
                    } @else if (codeSavedId() === r.loc.id) {
                      <span class="code-indicator saved" title="Saved!">
                        <svg lucideCheck size="12"></svg>
                      </span>
                    }
                  </div>
                </td>

                <!-- Usage Count -->
                <td class="td-usage">
                  <span
                    class="usage-pill"
                    [class.has-usage]="(r.loc.usageCount || 0) > 0"
                    [title]="r.loc.usageCount ? 'Referenced by ' + r.loc.usageCount + ' project task(s)' : 'Not assigned to any tasks yet'">
                    <svg lucideLayers size="12"></svg>
                    <span>{{ r.loc.usageCount || 0 }} tasks</span>
                  </span>
                </td>

                <!-- Status (Active / Disabled Toggle Switch) -->
                <td class="td-status">
                  <div class="status-toggle-wrapper">
                    <button
                      type="button"
                      class="switch-control"
                      [class.checked]="r.loc.isActive"
                      (click)="toggleActive(r.loc, $event)"
                      role="switch"
                      [attr.aria-checked]="r.loc.isActive"
                      [title]="r.loc.isActive ? 'Deactivate location' : 'Activate location'">
                      <span class="switch-knob"></span>
                    </button>
                    <span class="status-label" [class.on]="r.loc.isActive">
                      {{ r.loc.isActive ? 'Active' : 'Disabled' }}
                    </span>
                  </div>
                </td>

                <!-- Action Buttons -->
                <td class="td-actions">
                  <div class="action-buttons-group">
                    <!-- Quick Add Child Button -->
                    @if (r.loc.level !== 'SITE' && r.loc.isActive) {
                      <button
                        type="button"
                        class="btn-action-pill"
                        (click)="openAddChild(r.loc, $event)"
                        [title]="'Add child ' + (r.loc.level === 'STATE' ? 'city' : 'site') + ' inside ' + r.loc.name">
                        <svg lucidePlus size="13"></svg>
                        <span>{{ r.loc.level === 'STATE' ? 'City' : 'Site' }}</span>
                      </button>
                    }

                    <!-- Edit Button -->
                    <button
                      type="button"
                      class="btn-row-action"
                      (click)="openEdit(r.loc, $event)"
                      title="Edit location name, code or hierarchy">
                      <svg lucidePencil size="14"></svg>
                    </button>

                    <!-- Delete Button -->
                    <button
                      type="button"
                      class="btn-row-action danger"
                      (click)="remove(r.loc, $event)"
                      [title]="(r.loc.usageCount || 0) > 0 ? 'Used in tasks — will deactivate' : 'Delete location'">
                      <svg lucideTrash2 size="14"></svg>
                    </button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="empty-state-cell">
                  @if (all().length === 0) {
                    <div class="empty-state-box">
                      <div class="empty-icon-circle">
                        <svg lucideGlobe size="28"></svg>
                      </div>
                      <h3>No Task Locations Configured</h3>
                      <p>
                        Build your geographical hierarchy (<strong>States › Cities › Sites</strong>)
                        to organize tasks and field activities across multiple regions.
                      </p>
                      <div class="empty-actions">
                        <button type="button" class="btn-primary" (click)="openCreateModal('STATE')">
                          <svg lucidePlus size="16"></svg>
                          <span>Add First State</span>
                        </button>
                      </div>
                    </div>
                  } @else {
                    <div class="empty-search-box">
                      <svg lucideSearch size="24"></svg>
                      <p>No locations match "<strong>{{ query() }}</strong>"</p>
                      <button type="button" class="btn-subtle" (click)="query.set(''); setLevelFilter('ALL')">
                        Clear filters
                      </button>
                    </div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      <!-- ── ADD / EDIT LOCATION MODAL ──────────────────────────────── -->
      @if (modalMode()) {
        <div class="modal-backdrop" (click)="closeModal()">
          <div class="modal-card" (click)="$event.stopPropagation()">
            <!-- Modal Header -->
            <div class="modal-header">
              <div class="modal-title-group">
                <div class="modal-badge-icon" [ngClass]="modalMode() === 'edit' ? 'edit' : 'create'">
                  @if (modalMode() === 'edit') {
                    <svg lucidePencil size="18"></svg>
                  } @else {
                    <svg lucidePlus size="18"></svg>
                  }
                </div>
                <div>
                  <h2>
                    @if (modalMode() === 'edit') {
                      Edit Location: {{ editTargetLoc()?.name }}
                    } @else {
                      Add New Location
                    }
                  </h2>
                  <p class="modal-subtitle">
                    @if (modalMode() === 'edit') {
                      Update the name, hierarchy level, or parent of this location.
                    } @else {
                      Add a state, city, or operational site into your task hierarchy.
                    }
                  </p>
                </div>
              </div>
              <button type="button" class="btn-close" (click)="closeModal()" title="Close dialog">
                <svg lucideX size="18"></svg>
              </button>
            </div>

            <!-- Modal Body -->
            <div class="modal-body">
                <!-- SINGLE CREATE / EDIT FORM -->
                <div class="form-flow">
                  <!-- Level Selection -->
                  <div class="form-group">
                    <label class="form-label">Hierarchy Level</label>
                    <div class="level-selector-cards">
                      <label class="level-card" [class.selected]="formLevel() === 'STATE'">
                        <input
                          type="radio"
                          name="formLevel"
                          value="STATE"
                          [checked]="formLevel() === 'STATE'"
                          (change)="setFormLevel('STATE')"
                        />
                        <div class="card-icon state"><svg lucideGlobe size="16"></svg></div>
                        <div class="card-text">
                          <strong>State</strong>
                          <span>Top-level region</span>
                        </div>
                      </label>

                      <label class="level-card" [class.selected]="formLevel() === 'CITY'">
                        <input
                          type="radio"
                          name="formLevel"
                          value="CITY"
                          [checked]="formLevel() === 'CITY'"
                          (change)="setFormLevel('CITY')"
                        />
                        <div class="card-icon city"><svg lucideBuilding2 size="16"></svg></div>
                        <div class="card-text">
                          <strong>City</strong>
                          <span>Inside a state</span>
                        </div>
                      </label>

                      <label class="level-card" [class.selected]="formLevel() === 'SITE'">
                        <input
                          type="radio"
                          name="formLevel"
                          value="SITE"
                          [checked]="formLevel() === 'SITE'"
                          (change)="setFormLevel('SITE')"
                        />
                        <div class="card-icon site"><svg lucideMapPin size="16"></svg></div>
                        <div class="card-text">
                          <strong>Site</strong>
                          <span>Branch or facility</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <!-- Parent Location Selection -->
                  @if (formLevel() !== 'STATE') {
                    <div class="form-group">
                      <label class="form-label" for="formParent">
                        Parent Location (Inside) <span class="required">*</span>
                      </label>
                      <select
                        id="formParent"
                        class="form-select"
                        [value]="formParentId() ?? ''"
                        (change)="formParentId.set(+$any($event.target).value || null)">
                        <option value="">Choose parent {{ formLevel() === 'CITY' ? 'state' : 'city or state' }}…</option>
                        @for (p of singleParentOptions(); track p.id) {
                          <option [value]="p.id">{{ pathOf(p) }}</option>
                        }
                      </select>
                      @if (!singleParentOptions().length) {
                        <p class="form-hint error">
                          <svg lucideAlertCircle size="13"></svg>
                          No active parent locations found. Please create a State first.
                        </p>
                      }
                    </div>
                  }

                  <!-- Name and Code Row -->
                  <div class="form-row-2">
                    <div class="form-group flex-2">
                      <label class="form-label" for="formName">
                        Location Name <span class="required">*</span>
                      </label>
                      <input
                        id="formName"
                        type="text"
                        class="form-input"
                        [value]="formName()"
                        (input)="formName.set($any($event.target).value)"
                        [placeholder]="formLevel() === 'STATE' ? 'e.g. Maharashtra' : formLevel() === 'CITY' ? 'e.g. Mumbai' : 'e.g. Bandra Kurla Office'"
                        [attr.list]="formLevel() === 'SITE' ? null : 'tla-name-suggestions'"
                        autocomplete="off"
                        autofocus
                      />
                      <datalist id="tla-name-suggestions">
                        @for (n of formSuggestions(); track n) { <option [value]="n"></option> }
                      </datalist>
                    </div>

                    <div class="form-group flex-1">
                      <label class="form-label" for="formCode">
                        Code <span class="optional">(Optional)</span>
                      </label>
                      <input
                        id="formCode"
                        type="text"
                        class="form-input uppercase"
                        [value]="formCode()"
                        (input)="formCode.set($any($event.target).value)"
                        [placeholder]="formLevel() === 'STATE' ? 'e.g. MH' : formLevel() === 'CITY' ? 'e.g. MUM' : 'e.g. BKC-01'"
                        maxlength="20"
                      />
                    </div>
                  </div>

                  <!-- Active Switch -->
                  <div class="form-group checkbox-row">
                    <label class="switch-toggle-label">
                      <button
                        type="button"
                        class="switch-control"
                        [class.checked]="formIsActive()"
                        (click)="formIsActive.set(!formIsActive())"
                        role="switch"
                        [attr.aria-checked]="formIsActive()">
                        <span class="switch-knob"></span>
                      </button>
                      <div class="switch-text-desc">
                        <strong>Active Status</strong>
                        <span>Enabled locations can be assigned to tasks and project issues.</span>
                      </div>
                    </label>
                  </div>
                </div>
            </div>

            <!-- Modal Footer -->
            <div class="modal-footer">
              <button type="button" class="btn-cancel" (click)="closeModal()">Cancel</button>

                <button
                  type="button"
                  class="btn-primary"
                  [disabled]="busy() || !formName().trim() || (formLevel() !== 'STATE' && !formParentId())"
                  (click)="submitSingle()">
                  @if (busy()) {
                    <span>Saving…</span>
                  } @else {
                    <span>{{ modalMode() === 'edit' ? 'Update Location' : 'Create Location' }}</span>
                  }
                </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    /* ── BASE WRAPPER ────────────────────────────────────────── */
    .tla-wrapper {
      display: flex;
      flex-direction: column;
      gap: 16px;
      font-family: inherit;
    }

    /* ── STATS DASHBOARD ─────────────────────────────────────── */
    .tla-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }

    .stat-card {
      background: #ffffff;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      transition: all 0.18s ease;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
    }

    .stat-card:hover {
      border-color: #CBD5E1;
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.05);
    }

    .stat-card.active-filter {
      border-color: #1373E5;
      background: #F0F7FF;
      box-shadow: 0 0 0 1px #1373E5;
    }

    .stat-icon-wrapper {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .stat-icon-wrapper.total { background: #EEF2F6; color: #334155; }
    .stat-icon-wrapper.states { background: #EFF6FF; color: #1373E5; }
    .stat-icon-wrapper.cities { background: #ECFDF5; color: #059669; }
    .stat-icon-wrapper.sites { background: #F5F3FF; color: #7C3AED; }

    .stat-details {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .stat-num {
      font-size: 20px;
      font-weight: 700;
      color: #0F172A;
      line-height: 1.1;
    }

    .stat-label {
      font-size: 11.5px;
      color: #64748B;
      font-weight: 500;
      white-space: nowrap;
    }

    .stat-card.status-stat {
      cursor: default;
      justify-content: center;
    }

    .status-indicator-pills {
      display: flex;
      gap: 12px;
      align-items: center;
    }

    .status-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #334155;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .status-dot.green { background: #10B981; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2); }
    .status-dot.gray { background: #94A3B8; }
    .status-count { font-weight: 700; color: #0F172A; }
    .status-text { color: #64748B; font-size: 11.5px; }

    /* ── TOOLBAR ─────────────────────────────────────────────── */
    .tla-toolbar {
      background: #ffffff;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 10px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
    }

    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      flex: 1;
    }

    .search-box {
      position: relative;
      display: flex;
      align-items: center;
      min-width: 240px;
      flex: 1;
      max-width: 360px;
    }

    .search-icon {
      position: absolute;
      left: 11px;
      color: #94A3B8;
      pointer-events: none;
    }

    .search-input {
      width: 100%;
      height: 36px;
      padding: 0 32px 0 34px;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      font-size: 13px;
      background: #F8FAFC;
      color: #0F172A;
      outline: none;
      transition: all 0.15s ease;
    }

    .search-input:focus {
      background: #FFFFFF;
      border-color: #1373E5;
      box-shadow: 0 0 0 3px rgba(19, 115, 229, 0.12);
    }

    .clear-search-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      color: #94A3B8;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .clear-search-btn:hover {
      color: #334155;
      background: #E2E8F0;
    }

    .level-tabs {
      display: inline-flex;
      background: #F1F5F9;
      padding: 3px;
      border-radius: 8px;
      gap: 2px;
    }

    .level-tab-btn {
      background: transparent;
      border: none;
      padding: 5px 11px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      color: #64748B;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }

    .level-tab-btn:hover {
      color: #0F172A;
    }

    .level-tab-btn.active {
      background: #FFFFFF;
      color: #1373E5;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
    }

    .tab-badge {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 10px;
      background: #E2E8F0;
      color: #475569;
    }

    .level-tab-btn.active .tab-badge {
      background: #E0EDFD;
      color: #1373E5;
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .tree-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      border-right: 1px solid #E2E8F0;
      padding-right: 8px;
    }

    .btn-subtle {
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 5px 9px;
      font-size: 12px;
      font-weight: 500;
      color: #64748B;
      display: flex;
      align-items: center;
      gap: 5px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-subtle:hover {
      background: #F1F5F9;
      color: #0F172A;
    }

    .toggle-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12.5px;
      color: #475569;
      cursor: pointer;
      user-select: none;
      padding: 4px 6px;
    }

    .custom-checkbox {
      accent-color: #1373E5;
      width: 15px;
      height: 15px;
      cursor: pointer;
    }

    .btn-icon-subtle {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748B;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-icon-subtle:hover {
      background: #EDF2F7;
      color: #0F172A;
    }

    .spin {
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      100% { transform: rotate(360deg); }
    }

    .btn-secondary {
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      height: 36px;
      padding: 0 14px;
      font-size: 13px;
      font-weight: 500;
      color: #334155;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-secondary:hover {
      background: #F8FAFC;
      border-color: #94A3B8;
      color: #0F172A;
    }

    .btn-primary {
      background: #1373E5;
      border: 1px solid #1373E5;
      border-radius: 8px;
      height: 36px;
      padding: 0 16px;
      font-size: 13px;
      font-weight: 600;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(19, 115, 229, 0.25);
      transition: all 0.15s ease;
    }

    .btn-primary:hover {
      background: #0F5FBE;
      border-color: #0F5FBE;
      box-shadow: 0 3px 8px rgba(19, 115, 229, 0.35);
    }

    .btn-primary:disabled {
      background: #94A3B8;
      border-color: #94A3B8;
      cursor: not-allowed;
      box-shadow: none;
    }

    /* ── TABLE CARD ──────────────────────────────────────────── */
    .table-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
    }

    .tla-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }

    .tla-table thead tr {
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
    }

    .tla-table th {
      padding: 11px 14px;
      font-size: 11.5px;
      font-weight: 600;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .th-name { width: 38%; }
    .th-level { width: 12%; }
    .th-code { width: 14%; }
    .th-usage { width: 12%; }
    .th-status { width: 12%; }
    .th-actions { width: 12%; text-align: right; }

    .tla-row {
      border-bottom: 1px solid #F1F5F9;
      transition: background-color 0.15s ease;
    }

    .tla-row.row-expandable {
      cursor: pointer;
    }

    .tla-row:last-child {
      border-bottom: none;
    }

    .tla-row:hover {
      background: #F8FAFC;
    }

    .tla-row.is-state {
      background: #FAFCFE;
    }

    .tla-row.is-state:hover {
      background: #F0F6FD;
    }

    .tla-row.row-inactive td {
      opacity: 0.65;
    }

    .tla-table td {
      padding: 9px 14px;
      vertical-align: middle;
      color: #1E293B;
    }

    /* ── NAME CELL INNER ─────────────────────────────────────── */
    .name-cell-inner {
      display: flex;
      align-items: center;
      gap: 8px;
      position: relative;
    }

    .tree-connector {
      position: absolute;
      width: 12px;
      height: 16px;
      border-left: 1.5px solid #CBD5E1;
      border-bottom: 1.5px solid #CBD5E1;
      border-bottom-left-radius: 4px;
      top: 50%;
      transform: translateY(-90%);
      pointer-events: none;
    }

    .chevron-btn {
      background: transparent;
      border: none;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748B;
      cursor: pointer;
      padding: 0;
      flex-shrink: 0;
      transition: all 0.15s ease;
    }

    .chevron-btn:hover {
      background: #E2E8F0;
      color: #0F172A;
    }

    .chevron-placeholder {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .level-icon-badge {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .level-icon-badge.state { background: #EBF5FF; color: #1373E5; }
    .level-icon-badge.city { background: #ECFDF5; color: #059669; }
    .level-icon-badge.site { background: #F5F3FF; color: #7C3AED; }

    .name-text-col {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .parent-breadcrumb {
      font-size: 11px;
      color: #64748B;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .location-name {
      font-weight: 500;
      color: #0F172A;
      font-size: 13.5px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .is-state .location-name {
      font-weight: 700;
      font-size: 14px;
    }

    .child-count-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 10px;
      background: #F1F5F9;
      color: #475569;
      white-space: nowrap;
      margin-left: 4px;
    }

    .child-count-pill.collapsed-pill {
      background: #E0EDFD;
      color: #1373E5;
      font-weight: 600;
    }

    .dot-sep { opacity: 0.5; }

    /* ── LEVEL PILLS ─────────────────────────────────────────── */
    .level-pill {
      display: inline-flex;
      align-items: center;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 600;
      text-transform: capitalize;
    }

    .level-pill.state { background: #EFF6FF; color: #1E40AF; border: 1px solid #BFDBFE; }
    .level-pill.city { background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; }
    .level-pill.site { background: #F5F3FF; color: #5B21B6; border: 1px solid #DDD6FE; }

    /* ── CODE INPUT ──────────────────────────────────────────── */
    .code-wrapper {
      position: relative;
      display: inline-flex;
      align-items: center;
    }

    .code-input {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 8px;
      border: 1px solid #E2E8F0;
      border-radius: 6px;
      background: #FFFFFF;
      color: #334155;
      width: 90px;
      text-transform: uppercase;
      outline: none;
      transition: all 0.15s ease;
    }

    .code-input:hover {
      border-color: #CBD5E1;
    }

    .code-input:focus {
      border-color: #1373E5;
      background: #FFFFFF;
      box-shadow: 0 0 0 2px rgba(19, 115, 229, 0.15);
      width: 100px;
    }

    .code-indicator {
      position: absolute;
      right: 6px;
      font-size: 11px;
      pointer-events: none;
    }

    .code-indicator.saved { color: #10B981; }
    .code-indicator.saving { color: #64748B; }

    /* ── USAGE PILL ──────────────────────────────────────────── */
    .usage-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 6px;
      background: #F8FAFC;
      color: #64748B;
      border: 1px solid #E2E8F0;
    }

    .usage-pill.has-usage {
      background: #EFF6FF;
      color: #1373E5;
      border-color: #BFDBFE;
      font-weight: 600;
    }

    /* ── STATUS TOGGLE SWITCH ────────────────────────────────── */
    .status-toggle-wrapper {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .switch-control {
      position: relative;
      width: 32px;
      height: 18px;
      background: #CBD5E1;
      border: none;
      border-radius: 18px;
      padding: 2px;
      cursor: pointer;
      outline: none;
      transition: background-color 0.2s ease;
      display: inline-flex;
      align-items: center;
    }

    .switch-control.checked {
      background: #10B981;
    }

    .switch-knob {
      width: 14px;
      height: 14px;
      background: #FFFFFF;
      border-radius: 50%;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .switch-control.checked .switch-knob {
      transform: translateX(14px);
    }

    .status-label {
      font-size: 12px;
      color: #64748B;
      font-weight: 500;
    }

    .status-label.on {
      color: #0F172A;
    }

    /* ── ROW ACTIONS ─────────────────────────────────────────── */
    .action-buttons-group {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 4px;
    }

    .btn-action-pill {
      background: #F0F6FD;
      border: 1px solid #BFDBFE;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 11.5px;
      font-weight: 600;
      color: #1373E5;
      display: flex;
      align-items: center;
      gap: 3px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-action-pill:hover {
      background: #1373E5;
      color: #FFFFFF;
      border-color: #1373E5;
    }

    .btn-row-action {
      background: transparent;
      border: none;
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748B;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-row-action:hover {
      background: #F1F5F9;
      color: #0F172A;
    }

    .btn-row-action.danger:hover {
      background: #FEE2E2;
      color: #DC2626;
    }

    /* ── EMPTY STATES ────────────────────────────────────────── */
    .empty-state-cell {
      padding: 48px 16px !important;
      text-align: center;
    }

    .empty-state-box {
      max-width: 440px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
    }

    .empty-icon-circle {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #EFF6FF;
      color: #1373E5;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 4px;
    }

    .empty-state-box h3 {
      font-size: 16px;
      font-weight: 700;
      color: #0F172A;
      margin: 0;
    }

    .empty-state-box p {
      font-size: 13px;
      color: #64748B;
      margin: 0;
      line-height: 1.5;
    }

    .empty-actions {
      display: flex;
      gap: 10px;
      margin-top: 8px;
    }

    .empty-search-box {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: #64748B;
    }

    /* ── MODAL DIALOG STYLES ─────────────────────────────────── */
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
      animation: fadeIn 0.15s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .modal-card {
      background: #FFFFFF;
      border-radius: 14px;
      width: 100%;
      max-width: 540px;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      overflow: hidden;
      animation: slideUp 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slideUp {
      from { transform: translateY(12px) scale(0.98); opacity: 0; }
      to { transform: translateY(0) scale(1); opacity: 1; }
    }

    .modal-header {
      padding: 20px 24px 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid #F1F5F9;
    }

    .modal-title-group {
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }

    .modal-badge-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .modal-badge-icon.create { background: #EFF6FF; color: #1373E5; }
    .modal-badge-icon.edit { background: #FEF3C7; color: #D97706; }

    .modal-title-group h2 {
      font-size: 16.5px;
      font-weight: 700;
      color: #0F172A;
      margin: 0 0 3px;
    }

    .modal-subtitle {
      font-size: 12.5px;
      color: #64748B;
      margin: 0;
    }

    .btn-close {
      background: transparent;
      border: none;
      width: 32px;
      height: 32px;
      border-radius: 6px;
      color: #94A3B8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
    }

    .btn-close:hover {
      background: #F1F5F9;
      color: #0F172A;
    }

    .modal-tabs {
      display: flex;
      border-bottom: 1px solid #E2E8F0;
      padding: 0 24px;
      background: #F8FAFC;
    }

    .modal-tab-btn {
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 10px 16px;
      font-size: 13px;
      font-weight: 500;
      color: #64748B;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .modal-tab-btn:hover {
      color: #0F172A;
    }

    .modal-tab-btn.active {
      color: #1373E5;
      font-weight: 600;
      border-bottom-color: #1373E5;
    }

    .modal-body {
      padding: 20px 24px;
      overflow-y: auto;
      max-height: calc(90vh - 170px);
    }

    .form-flow {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 12.5px;
      font-weight: 600;
      color: #334155;
    }

    .required { color: #DC2626; }
    .optional { color: #94A3B8; font-weight: normal; font-size: 11.5px; }

    .level-selector-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .level-card {
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      transition: all 0.15s ease;
      background: #FFFFFF;
      position: relative;
    }

    .level-card input[type="radio"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }

    .level-card:hover {
      border-color: #CBD5E1;
      background: #F8FAFC;
    }

    .level-card.selected {
      border-color: #1373E5;
      background: #F0F7FF;
      box-shadow: 0 0 0 1px #1373E5;
    }

    .card-icon {
      width: 30px;
      height: 30px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .card-icon.state { background: #EFF6FF; color: #1373E5; }
    .card-icon.city { background: #ECFDF5; color: #059669; }
    .card-icon.site { background: #F5F3FF; color: #7C3AED; }

    .card-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .card-text strong {
      font-size: 13px;
      color: #0F172A;
    }

    .card-text span {
      font-size: 11px;
      color: #64748B;
    }

    .form-input, .form-select, .form-textarea {
      font-family: inherit;
      font-size: 13px;
      padding: 8px 12px;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      background: #FFFFFF;
      color: #0F172A;
      outline: none;
      transition: all 0.15s ease;
    }

    .form-input:focus, .form-select:focus, .form-textarea:focus {
      border-color: #1373E5;
      box-shadow: 0 0 0 3px rgba(19, 115, 229, 0.12);
    }

    .form-input.uppercase {
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }

    .form-textarea {
      resize: vertical;
      line-height: 1.5;
    }

    .form-row-2 {
      display: flex;
      gap: 12px;
    }

    .flex-1 { flex: 1; }
    .flex-2 { flex: 2; }

    .form-hint {
      font-size: 11.5px;
      color: #64748B;
      margin: 3px 0 0;
      display: flex;
      align-items: center;
      gap: 5px;
    }

    .form-hint.error { color: #DC2626; }

    .label-with-count {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .count-hint {
      font-size: 11.5px;
      color: #1373E5;
      font-weight: 500;
    }

    .checkbox-row {
      padding-top: 4px;
    }

    .switch-toggle-label {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      cursor: pointer;
    }

    .switch-text-desc {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .switch-text-desc strong {
      font-size: 13px;
      color: #0F172A;
    }

    .switch-text-desc span {
      font-size: 11.5px;
      color: #64748B;
    }

    .modal-footer {
      padding: 16px 24px;
      border-top: 1px solid #F1F5F9;
      background: #F8FAFC;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .btn-cancel {
      background: #FFFFFF;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      height: 36px;
      padding: 0 16px;
      font-size: 13px;
      font-weight: 500;
      color: #475569;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .btn-cancel:hover {
      background: #F1F5F9;
      color: #0F172A;
    }

  `]
})
export class TaskLocationsAdminComponent implements OnInit {
  private api = inject(TaskLocationsService);
  private toast = inject(HotToastService);
  private dialog = inject(DialogService);

  all = signal<TaskLocation[]>([]);
  query = signal('');
  levelFilter = signal<'ALL' | 'STATE' | 'CITY' | 'SITE'>('ALL');
  showInactive = signal(true);
  loading = signal(false);
  busy = signal(false);

  // Collapse / Expand tree tracking
  collapsedIds = signal<Set<number>>(new Set());

  // Inline code saving indicators
  codeSavingId = signal<number | null>(null);
  codeSavedId = signal<number | null>(null);

  // Modal dialog states
  modalMode = signal<'create' | 'edit' | null>(null);
  editTargetLoc = signal<TaskLocation | null>(null);

  // Single Form fields
  formName = signal('');
  formCode = signal('');
  formLevel = signal<'STATE' | 'CITY' | 'SITE'>('STATE');
  formParentId = signal<number | null>(null);
  formIsActive = signal(true);

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.list(false).subscribe({
      next: (list) => {
        this.loading.set(false);
        this.all.set(list);
        // Open on states only — 36 states with 400 cities is too long a page
        // to scroll. Later reloads keep whatever the admin has opened.
        if (!this.loadedOnce) {
          this.loadedOnce = true;
          this.collapseAll();
        }
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Could not load task locations.');
      },
    });
  }

  // ── COMPUTED LOOKUPS & STATS ──────────────────────────────────────────

  byId = computed(() => new Map(this.all().map((l) => [l.id, l])));

  stats = computed(() => {
    const list = this.all();
    let states = 0;
    let cities = 0;
    let sites = 0;
    let active = 0;
    let disabled = 0;

    for (const l of list) {
      if (l.level === 'STATE') states++;
      else if (l.level === 'CITY') cities++;
      else if (l.level === 'SITE') sites++;

      if (l.isActive) active++;
      else disabled++;
    }

    return { total: list.length, states, cities, sites, active, disabled };
  });

  /** Typing suggestions for the single-location name field. */
  formSuggestions = computed(() => {
    if (this.formLevel() === 'STATE') return Object.keys(INDIA_LOCATIONS);
    if (this.formLevel() === 'CITY') {
      const parent = this.all().find((l) => l.id === this.formParentId());
      return parent ? suggestedCities(parent.name) : [];
    }
    return [];
  });

  /** Full breadcrumb path (e.g. "Maharashtra › Mumbai › Bandra Branch") */
  pathOf(l: TaskLocation): string {
    const parts = [l.name];
    let p = l.parentId != null ? this.byId().get(l.parentId) : undefined;
    while (p) {
      parts.unshift(p.name);
      p = p.parentId != null ? this.byId().get(p.parentId) : undefined;
    }
    return parts.join(' › ');
  }

  /** Parent breadcrumb path only (e.g. "Maharashtra › Mumbai") */
  parentPathOf(l: TaskLocation): string | null {
    if (l.parentId == null) return null;
    const parts: string[] = [];
    let p = this.byId().get(l.parentId);
    while (p) {
      parts.unshift(p.name);
      p = p.parentId != null ? this.byId().get(p.parentId) : undefined;
    }
    return parts.length ? parts.join(' › ') : null;
  }

  /** Child stats per location (how many cities and sites are inside it) */
  private statsMap = computed(() => {
    const map = new Map<number, ChildStats>();
    const allLocs = this.all();

    const childrenLookup = new Map<number, TaskLocation[]>();
    for (const l of allLocs) {
      if (l.parentId != null) {
        const arr = childrenLookup.get(l.parentId) || [];
        arr.push(l);
        childrenLookup.set(l.parentId, arr);
      }
    }

    const calc = (id: number): ChildStats => {
      if (map.has(id)) return map.get(id)!;
      const direct = childrenLookup.get(id) || [];
      let cities = 0;
      let sites = 0;
      let total = direct.length;
      for (const c of direct) {
        if (c.level === 'CITY') cities++;
        else if (c.level === 'SITE') sites++;
        const sub = calc(c.id);
        cities += sub.cities;
        sites += sub.sites;
        total += sub.total;
      }
      const res = { cities, sites, total };
      map.set(id, res);
      return res;
    };

    for (const l of allLocs) calc(l.id);
    return map;
  });

  // ── PARENT OPTIONS FOR FORMS ──────────────────────────────────────────

  singleParentOptions = computed(() => {
    const lvl = this.formLevel();
    if (lvl === 'STATE') return [];
    const editingId = this.editTargetLoc()?.id;
    const excludeIds = editingId ? this.descendantIds(editingId) : new Set<number>();

    return this.all().filter((l) =>
      l.isActive &&
      !excludeIds.has(l.id) &&
      (lvl === 'CITY' ? l.level === 'STATE' : l.level !== 'SITE')
    );
  });

  private descendantIds(id: number): Set<number> {
    const set = new Set<number>([id]);
    const addChildren = (parentId: number) => {
      for (const l of this.all()) {
        if (l.parentId === parentId && !set.has(l.id)) {
          set.add(l.id);
          addChildren(l.id);
        }
      }
    };
    addChildren(id);
    return set;
  }

  // ── TABLE ROWS COMPUTATION ────────────────────────────────────────────

  rows = computed<TreeRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    const filter = this.levelFilter();
    const showOff = this.showInactive();
    const collapsed = this.collapsedIds();
    const list = this.all().filter((l) => showOff || l.isActive);
    const statsMap = this.statsMap();
    const ids = new Set(list.map((l) => l.id));

    // When querying or filtering by a specific level, display flattened matching rows
    if (q || filter !== 'ALL') {
      return list
        .filter((l) => {
          if (filter !== 'ALL' && l.level !== filter) return false;
          if (q) {
            const matchesName = l.name.toLowerCase().includes(q);
            const matchesCode = (l.code || '').toLowerCase().includes(q);
            const matchesPath = this.pathOf(l).toLowerCase().includes(q);
            return matchesName || matchesCode || matchesPath;
          }
          return true;
        })
        .map((l) => ({
          loc: l,
          depth: 0,
          hasChildren: (statsMap.get(l.id)?.total || 0) > 0,
          isCollapsed: false,
          childStats: statsMap.get(l.id) || { cities: 0, sites: 0, total: 0 },
          parentPath: this.parentPathOf(l),
        }));
    }

    // Default: Hierarchical tree walk (State → City → Site)
    const out: TreeRow[] = [];
    const walk = (parent: number | null, depth: number) => {
      const children = list.filter((x) =>
        parent == null ? x.parentId == null || !ids.has(x.parentId) : x.parentId === parent
      );

      for (const l of children) {
        const childStats = statsMap.get(l.id) || { cities: 0, sites: 0, total: 0 };
        const hasChildren = childStats.total > 0;
        const isCollapsed = collapsed.has(l.id);

        out.push({
          loc: l,
          depth,
          hasChildren,
          isCollapsed,
          childStats,
          parentPath: depth > 0 ? this.parentPathOf(l) : null,
        });

        // Recurse into children if not collapsed
        if (hasChildren && !isCollapsed) {
          walk(l.id, depth + 1);
        }
      }
    };

    walk(null, 0);
    return out;
  });

  // ── TREE EXPAND & COLLAPSE ────────────────────────────────────────────

  toggleCollapse(id: number) {
    const s = new Set(this.collapsedIds());
    if (s.has(id)) s.delete(id);
    else s.add(id);
    this.collapsedIds.set(s);
  }

  private loadedOnce = false;

  /** A row expands from anywhere on it, as long as the tree is showing. */
  canToggle(r: TreeRow): boolean {
    return r.hasChildren && !this.query() && this.levelFilter() === 'ALL';
  }

  onRowClick(r: TreeRow, event: MouseEvent) {
    if (!this.canToggle(r)) return;
    // Buttons, inputs and toggles in the row do their own thing.
    if ((event.target as HTMLElement).closest('button, input, select, textarea, a, label')) return;
    this.toggleCollapse(r.loc.id);
  }

  collapseAll() {
    const s = new Set<number>();
    const statsMap = this.statsMap();
    for (const l of this.all()) {
      if ((statsMap.get(l.id)?.total || 0) > 0) s.add(l.id);
    }
    this.collapsedIds.set(s);
  }

  expandAll() {
    this.collapsedIds.set(new Set());
  }

  setLevelFilter(filter: 'ALL' | 'STATE' | 'CITY' | 'SITE') {
    this.levelFilter.set(filter);
  }

  // ── MODAL ACTIONS & CONTROLS ──────────────────────────────────────────

  openCreateModal(defaultLevel: 'STATE' | 'CITY' | 'SITE' = 'STATE', parentId: number | null = null) {
    this.modalMode.set('create');
    this.editTargetLoc.set(null);
    this.formName.set('');
    this.formCode.set('');
    this.formLevel.set(defaultLevel);
    this.formParentId.set(parentId);
    this.formIsActive.set(true);
  }

  openAddChild(parentLoc: TaskLocation, event?: Event) {
    event?.stopPropagation();
    const nextLevel = parentLoc.level === 'STATE' ? 'CITY' : 'SITE';
    this.openCreateModal(nextLevel, parentLoc.id);
  }

  openEdit(loc: TaskLocation, event?: Event) {
    event?.stopPropagation();
    this.editTargetLoc.set(loc);
    this.formName.set(loc.name);
    this.formCode.set(loc.code ?? '');
    this.formLevel.set(loc.level);
    this.formParentId.set(loc.parentId);
    this.formIsActive.set(loc.isActive);
    this.modalMode.set('edit');
  }

  closeModal() {
    this.modalMode.set(null);
    this.editTargetLoc.set(null);
    this.busy.set(false);
  }

  setFormLevel(level: 'STATE' | 'CITY' | 'SITE') {
    this.formLevel.set(level);
    if (level === 'STATE') {
      this.formParentId.set(null);
    } else {
      const opts = this.singleParentOptions();
      if (!opts.some((p) => p.id === this.formParentId())) {
        this.formParentId.set(opts.length ? opts[0].id : null);
      }
    }
  }

  // ── SAVE & SUBMIT OPERATIONS ──────────────────────────────────────────

  submitSingle() {
    const name = this.formName().trim();
    if (!name) {
      this.toast.error('Location name is required');
      return;
    }

    const level = this.formLevel();
    const parentId = level === 'STATE' ? null : this.formParentId();
    if (level !== 'STATE' && !parentId) {
      this.toast.error(`Please select a parent ${level === 'CITY' ? 'state' : 'city or state'}`);
      return;
    }

    this.busy.set(true);

    if (this.modalMode() === 'edit') {
      const target = this.editTargetLoc();
      if (!target) return;
      this.api.update(target.id, {
        name,
        code: this.formCode().trim() || null,
        level,
        parentId,
        isActive: this.formIsActive(),
      }).subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success(`"${name}" updated successfully`);
          this.closeModal();
          this.load();
        },
        error: (e) => {
          this.busy.set(false);
          this.toast.error(e?.error?.message || 'Could not update location');
        },
      });
    } else {
      this.api.create({
        name,
        code: this.formCode().trim() || null,
        level,
        parentId,
        isActive: this.formIsActive(),
      }).subscribe({
        next: () => {
          this.busy.set(false);
          this.toast.success(`Location "${name}" created successfully`);
          this.closeModal();
          this.load();
        },
        error: (e) => {
          this.busy.set(false);
          this.toast.error(e?.error?.message || 'Could not create location');
        },
      });
    }
  }

  saveCode(loc: TaskLocation, newCode: string) {
    const code = newCode.trim() || null;
    if (code === (loc.code || null)) return;

    this.codeSavingId.set(loc.id);
    this.api.update(loc.id, { code }).subscribe({
      next: () => {
        this.codeSavingId.set(null);
        this.codeSavedId.set(loc.id);
        setTimeout(() => {
          if (this.codeSavedId() === loc.id) this.codeSavedId.set(null);
        }, 2000);
        this.load();
      },
      error: (e) => {
        this.codeSavingId.set(null);
        this.toast.error(e?.error?.message || 'Could not save code');
        this.load();
      },
    });
  }

  toggleActive(loc: TaskLocation, event?: Event) {
    event?.stopPropagation();
    const newActive = !loc.isActive;
    this.api.update(loc.id, { isActive: newActive }).subscribe({
      next: () => {
        this.toast.success(`"${loc.name}" ${newActive ? 'activated' : 'disabled'}`);
        this.load();
      },
      error: (e) => {
        this.toast.error(e?.error?.message || 'Could not update status');
        this.load();
      },
    });
  }

  async remove(loc: TaskLocation, event?: Event) {
    event?.stopPropagation();
    const isUsed = (loc.usageCount || 0) > 0;
    const message = isUsed
      ? `"${loc.name}" is used by ${loc.usageCount} task(s). Deleting will disable it to protect historical task data.`
      : `Are you sure you want to delete "${loc.name}" and any sub-locations inside it?`;

    const ok = await this.dialog.confirm(
      message,
      `Delete Location: ${loc.name}`,
      isUsed ? 'Disable' : 'Delete',
      'Cancel',
      'danger'
    );
    if (!ok) return;

    this.api.remove(loc.id).subscribe({
      next: (r) => {
        this.toast.success(r.deleted ? `"${loc.name}" deleted` : (r.message || `"${loc.name}" disabled`));
        this.load();
      },
      error: (e) => this.toast.error(e?.error?.message || 'Could not delete location'),
    });
  }
}
