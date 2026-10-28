import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideArrowLeft, LucideChevronLeft, LucideChevronRight, LucideCalendar,
  LucideCalendarCheck, LucideHouse, LucideUsers, LucideCheckCircle2,
  LucideClock, LucideXCircle, LucideSearch, LucideX, LucideDownload,
  LucideRotateCcw, LucideBuilding2, LucideTrash2, LucideAlertCircle
} from '@lucide/angular';
import { WfhService } from '../../services/wfh.service';
import { MasterDataService } from '../../services/master-data.service';
import { ProfileModalService } from '../../shared/profile-modal/profile-modal.service';

type StatusFilter = 'ALL' | 'APPROVED' | 'PENDING' | 'ASSIGNED' | 'REJECTED';

/**
 * WFH report for HR (21 Oct 2026): everyone's WFH in a month — approved,
 * pending, rejected and assigned per person, with every day — by department.
 * HR can cancel a day (e.g. assigned by mistake).
 */
@Component({
  selector: 'app-wfh-report',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterLink,
    LucideArrowLeft, LucideChevronLeft, LucideChevronRight, LucideCalendar,
    LucideCalendarCheck, LucideHouse, LucideUsers, LucideCheckCircle2,
    LucideClock, LucideXCircle, LucideSearch, LucideX, LucideDownload,
    LucideRotateCcw, LucideBuilding2, LucideTrash2, LucideAlertCircle
  ],
  template: `
  <div class="wfh-page page-container">
    <!-- ENHANCED PAGE HEADER CARD -->
    <div class="page-header wfh-header-card">
      <div class="wfh-header-left">
        <a routerLink="/attendance/shift-roster" class="btn-back-roster" title="Back to Shift Roster">
          <svg lucideArrowLeft size="16"></svg>
        </a>
        <div class="wfh-header-icon">
          <svg lucideHouse size="22"></svg>
        </div>
        <div class="wfh-header-text">
          <div class="wfh-title-row">
            <h1>WFH Report</h1>
            <span class="wfh-period-pill">
              <svg lucideCalendar size="12"></svg>
              <span>{{ monthLabel() }}</span>
            </span>
            <span class="wfh-limit-pill" *ngIf="data() as d">
              <svg lucideCalendarCheck size="12"></svg>
              <span>Monthly Limit: <strong>{{ d.limit }} {{ d.limit === 1 ? 'day' : 'days' }}</strong>/person</span>
            </span>
          </div>
          <p class="wfh-subtitle">Work From Home utilization, pending approvals, and HR-assigned remote days per employee.</p>
        </div>
      </div>

      <div class="wfh-header-actions">
        <button type="button" class="btn-wfh-outline" (click)="exportCsv()" [disabled]="loading() || !filteredPeople().length" title="Export visible WFH report to CSV">
          <svg lucideDownload size="14"></svg>
          <span>Export CSV</span>
        </button>
        <button type="button" class="btn-wfh-outline" (click)="load()" [disabled]="loading()" title="Refresh WFH report">
          <svg lucideRotateCcw size="14" [class.spinning]="loading()"></svg>
          <span>Refresh</span>
        </button>
      </div>
    </div>

    <!-- INTERACTIVE KPI SUMMARY GRID -->
    <div class="wfh-kpi-grid" *ngIf="data() as d">
      <button type="button" class="wfh-kpi-card kpi-indigo" [class.active]="statusFilter() === 'ALL'" (click)="setStatusFilter('ALL')">
        <div class="kpi-icon-box bg-indigo">
          <svg lucideUsers size="20"></svg>
        </div>
        <div class="kpi-body">
          <span class="kpi-val">{{ d.totals.people }}</span>
          <span class="kpi-label">Employees on WFH</span>
          <span class="kpi-sub">Allowance {{ d.limit }}/month</span>
        </div>
      </button>

      <button type="button" class="wfh-kpi-card kpi-emerald" [class.active]="statusFilter() === 'APPROVED'" (click)="setStatusFilter('APPROVED')">
        <div class="kpi-icon-box bg-emerald">
          <svg lucideCheckCircle2 size="20"></svg>
        </div>
        <div class="kpi-body">
          <span class="kpi-val">{{ d.totals.approved }}</span>
          <span class="kpi-label">Approved Days</span>
          <span class="kpi-sub">Active WFH schedule</span>
        </div>
      </button>

      <button type="button" class="wfh-kpi-card kpi-amber" [class.active]="statusFilter() === 'PENDING'" (click)="setStatusFilter('PENDING')">
        <div class="kpi-icon-box bg-amber">
          <svg lucideClock size="20"></svg>
        </div>
        <div class="kpi-body">
          <span class="kpi-val">{{ d.totals.pending }}</span>
          <span class="kpi-label">Pending Approval</span>
          <span class="kpi-sub">Awaiting review</span>
        </div>
      </button>

      <button type="button" class="wfh-kpi-card kpi-blue" [class.active]="statusFilter() === 'ASSIGNED'" (click)="setStatusFilter('ASSIGNED')">
        <div class="kpi-icon-box bg-blue">
          <svg lucideHouse size="20"></svg>
        </div>
        <div class="kpi-body">
          <span class="kpi-val">{{ d.totals.assigned }}</span>
          <span class="kpi-label">Assigned by HR</span>
          <span class="kpi-sub">Direct admin grant</span>
        </div>
      </button>

      <button type="button" class="wfh-kpi-card kpi-rose" [class.active]="statusFilter() === 'REJECTED'" (click)="setStatusFilter('REJECTED')">
        <div class="kpi-icon-box bg-rose">
          <svg lucideXCircle size="20"></svg>
        </div>
        <div class="kpi-body">
          <span class="kpi-val">{{ d.totals.rejected }}</span>
          <span class="kpi-label">Rejected</span>
          <span class="kpi-sub">Declined requests</span>
        </div>
      </button>
    </div>

    <!-- TOOLBAR: MONTH NAVIGATOR, STATUS TABS, SEARCH & DEPARTMENT FILTER -->
    <div class="wfh-toolbar-card">
      <div class="toolbar-left">
        <!-- Month Navigator -->
        <div class="month-stepper">
          <button type="button" class="step-btn" (click)="move(-1)" title="Previous month">
            <svg lucideChevronLeft size="16"></svg>
          </button>
          <span class="step-month-label">
            <svg lucideCalendar size="14"></svg>
            <span>{{ monthLabel() }}</span>
          </span>
          <button type="button" class="step-btn" (click)="move(1)" title="Next month">
            <svg lucideChevronRight size="16"></svg>
          </button>
        </div>

        <button *ngIf="!isCurrentMonth()" type="button" class="btn-this-month" (click)="resetToCurrentMonth()">
          Current Month
        </button>

        <!-- Status Segmented Filter -->
        <div class="status-segmented">
          <button type="button" [class.active]="statusFilter() === 'ALL'" (click)="statusFilter.set('ALL')">All</button>
          <button type="button" [class.active]="statusFilter() === 'APPROVED'" (click)="statusFilter.set('APPROVED')">Approved</button>
          <button type="button" [class.active]="statusFilter() === 'PENDING'" (click)="statusFilter.set('PENDING')">Pending</button>
          <button type="button" [class.active]="statusFilter() === 'ASSIGNED'" (click)="statusFilter.set('ASSIGNED')">HR Assigned</button>
          <button type="button" [class.active]="statusFilter() === 'REJECTED'" (click)="statusFilter.set('REJECTED')">Rejected</button>
        </div>
      </div>

      <div class="toolbar-right">
        <!-- Employee Search -->
        <div class="wfh-search-wrap">
          <svg lucideSearch size="14" class="search-icon"></svg>
          <input
            type="text"
            placeholder="Search employee, role or dept…"
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            class="wfh-search-input"
          />
          <button *ngIf="searchQuery()" type="button" class="clear-search-btn" (click)="searchQuery.set('')" title="Clear search">
            <svg lucideX size="12"></svg>
          </button>
        </div>

        <!-- Department Select -->
        <div class="wfh-dept-select-wrap">
          <svg lucideBuilding2 size="14" class="dept-icon"></svg>
          <select [value]="dept()" (change)="dept.set($any($event.target).value); load()" class="wfh-dept-select" aria-label="Filter by department">
            <option value="">All departments</option>
            <option *ngFor="let d of departments()" [value]="d.id">{{ d.name }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- LOADING STATE -->
    <div class="wfh-state-card" *ngIf="loading()">
      <div class="loading-spinner"></div>
      <h4>Loading WFH report for {{ monthLabel() }}…</h4>
      <p>Fetching employee remote work records and approval statuses.</p>
    </div>

    <!-- EMPTY STATE -->
    <div class="wfh-state-card" *ngIf="!loading() && filteredPeople().length === 0">
      <div class="empty-icon-badge">
        <svg lucideHouse size="26"></svg>
      </div>
      <h4>{{ data()?.people?.length ? 'No matching employees found' : 'No WFH records for ' + monthLabel() }}</h4>
      <p>
        {{ data()?.people?.length
          ? 'No employees match your active search or status filter criteria.'
          : 'When HR or Superadmin assigns Work From Home days, they will appear here.' }}
      </p>
      <button *ngIf="hasActiveFilters()" type="button" class="btn-reset-filters" (click)="clearFilters()">
        Reset Filters
      </button>
    </div>

    <!-- EMPLOYEE WFH RECORDS TABLE CARD -->
    <div class="wfh-table-card" *ngIf="!loading() && filteredPeople().length > 0">
      <div class="wfh-table-head">
        <div class="col-emp">Employee ({{ filteredPeople().length }})</div>
        <div class="col-counts">Monthly Breakdown</div>
        <div class="col-days">Scheduled WFH Dates &amp; Status</div>
      </div>

      <div class="wfh-table-body">
        <div class="wfh-row" *ngFor="let p of filteredPeople()">
          <!-- Employee Info -->
          <button type="button" class="wfh-person-cell" (click)="profile.open(p.employee.id)" title="View employee profile">
            <span class="wfh-avatar">
              <img *ngIf="p.employee.avatarUrl" [src]="p.employee.avatarUrl" alt="">
              <span *ngIf="!p.employee.avatarUrl">{{ (p.employee.firstName || '?').charAt(0) }}</span>
            </span>
            <span class="wfh-person-meta">
              <span class="person-name">{{ p.employee.firstName }} {{ p.employee.lastName }}</span>
              <span class="person-sub">
                {{ p.employee.designation?.name || 'Team Member' }}
                <ng-container *ngIf="p.employee.department?.name"> &bull; {{ p.employee.department.name }}</ng-container>
              </span>
            </span>
          </button>

          <!-- Summary Pills -->
          <div class="wfh-counts-cell">
            <span class="stat-pill ok" [class.dim]="!p.approved">
              <span class="dot"></span>
              {{ p.approved }} approved
            </span>
            <span class="stat-pill asg" *ngIf="p.assigned">
              <span class="dot"></span>
              {{ p.assigned }} assigned
            </span>
            <span class="stat-pill pend" *ngIf="p.pending">
              <span class="dot"></span>
              {{ p.pending }} pending
            </span>
            <span class="stat-pill rej" *ngIf="p.rejected">
              <span class="dot"></span>
              {{ p.rejected }} rejected
            </span>
          </div>

          <!-- Individual Date Chips -->
          <div class="wfh-days-cell">
            <div
              class="wfh-day-chip s-{{ d.status }}"
              [class.is-hr-assigned]="d.source === 'ASSIGNED'"
              *ngFor="let d of p.days"
              [title]="(d.reason ? 'Reason: ' + d.reason : 'WFH Day') + (d.reviewNote ? ' — Note: ' + d.reviewNote : '')">
              <span class="day-date">{{ d.date | date:'d MMM':'UTC' }}</span>
              <span class="day-weekday">{{ d.date | date:'EEE':'UTC' }}</span>
              <span class="day-tag hr-tag" *ngIf="d.source === 'ASSIGNED'">HR</span>
              <span class="day-tag pend-tag" *ngIf="d.status === 'PENDING_MANAGER' || d.status === 'PENDING_HR'">Pending</span>
              <span class="day-tag rej-tag" *ngIf="d.status === 'REJECTED'">Rejected</span>
              <button
                type="button"
                class="day-cancel-btn"
                *ngIf="d.status !== 'REJECTED'"
                (click)="promptCancel(p.employee, d)"
                title="Cancel this WFH day">
                <svg lucideX size="11"></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- CANCEL CONFIRMATION MODAL -->
  <div class="wfh-modal-overlay" *ngIf="cancelTarget() as target" (click)="cancelTarget.set(null)">
    <div class="wfh-modal-card" (click)="$event.stopPropagation()">
      <div class="modal-head">
        <div class="modal-head-left">
          <div class="danger-icon-badge">
            <svg lucideAlertCircle size="20"></svg>
          </div>
          <div>
            <h3>Cancel WFH Day</h3>
            <p>This action will revoke the scheduled WFH record and notify the employee.</p>
          </div>
        </div>
        <button type="button" class="btn-icon-close" (click)="cancelTarget.set(null)">
          <svg lucideX size="16"></svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="target-summary-box">
          <div class="summary-row">
            <span class="lbl">Employee</span>
            <strong class="val">{{ target.employee.firstName }} {{ target.employee.lastName }}</strong>
          </div>
          <div class="summary-row">
            <span class="lbl">WFH Date</span>
            <strong class="val">{{ target.day.date | date:'EEEE, d MMMM y':'UTC' }}</strong>
          </div>
          <div class="summary-row" *ngIf="target.day.source === 'ASSIGNED'">
            <span class="lbl">Type</span>
            <span class="hr-badge-inline">Assigned by HR</span>
          </div>
          <div class="summary-row" *ngIf="target.day.reason">
            <span class="lbl">Reason</span>
            <span class="val">{{ target.day.reason }}</span>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button type="button" class="btn-modal-keep" (click)="cancelTarget.set(null)" [disabled]="cancelling()">
          Keep WFH Day
        </button>
        <button type="button" class="btn-modal-danger" (click)="confirmCancel()" [disabled]="cancelling()">
          <svg lucideTrash2 size="14" *ngIf="!cancelling()"></svg>
          <span>{{ cancelling() ? 'Cancelling…' : 'Cancel WFH Day' }}</span>
        </button>
      </div>
    </div>
  </div>
  `,
  styles: [`
    .wfh-page {
      padding: 24px;
      font-family: 'Plus Jakarta Sans', system-ui, -apple-system, sans-serif;
      display: flex;
      flex-direction: column;
      gap: 18px;
      box-sizing: border-box;
    }

    /* ── PAGE HEADER CARD ── */
    .page-header.wfh-header-card {
      background: #FFFFFF !important;
      border: 1px solid #E2E8F0 !important;
      border-radius: 16px !important;
      padding: 18px 24px !important;
      margin-bottom: 0 !important;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.02) !important;
      display: flex !important;
      flex-direction: row !important;
      justify-content: space-between !important;
      align-items: center !important;
      flex-wrap: wrap !important;
      gap: 16px !important;
    }

    .wfh-header-left {
      display: flex;
      align-items: center;
      gap: 14px;
      flex: 1;
      min-width: 280px;
    }

    .btn-back-roster {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      border: 1px solid #E2E8F0;
      background: #F8FAFC;
      color: #475569;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }

    .btn-back-roster:hover {
      background: #EFF6FF;
      border-color: #BFDBFE;
      color: #1373E5;
      transform: translateX(-2px);
    }

    .wfh-header-icon {
      width: 46px;
      height: 46px;
      border-radius: 13px;
      background: linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%);
      border: 1px solid #BFDBFE;
      color: #1373E5;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(19, 115, 229, 0.12);
    }

    .wfh-header-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .wfh-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .wfh-header-card h1 {
      margin: 0 !important;
      font-size: 21px !important;
      font-weight: 800 !important;
      color: #0F172A !important;
      letter-spacing: -0.02em !important;
      line-height: 1.2 !important;
    }

    .wfh-period-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 25px;
      padding: 0 10px;
      border-radius: 999px;
      background: #EFF6FF;
      border: 1px solid #BFDBFE;
      color: #1D4ED8;
      font-size: 12px;
      font-weight: 700;
    }

    .wfh-limit-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 25px;
      padding: 0 10px;
      border-radius: 999px;
      background: #F1F5F9;
      border: 1px solid #E2E8F0;
      color: #475569;
      font-size: 12px;
      font-weight: 600;
    }

    .wfh-limit-pill strong {
      color: #0F172A;
      font-weight: 700;
    }

    .wfh-subtitle {
      margin: 0 !important;
      font-size: 13.5px !important;
      color: #64748B !important;
      line-height: 1.45 !important;
    }

    .wfh-header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .btn-wfh-outline {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      height: 38px;
      padding: 0 14px;
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
      transition: all 0.15s ease;
    }

    .btn-wfh-outline svg {
      color: #64748B;
    }

    .btn-wfh-outline:hover:not(:disabled) {
      background: #F8FAFC;
      border-color: #CBD5E1;
      color: #0F172A;
      transform: translateY(-1px);
      box-shadow: 0 4px 8px -2px rgba(15, 23, 42, 0.07);
    }

    .btn-wfh-outline:hover:not(:disabled) svg {
      color: #1373E5;
    }

    .btn-wfh-outline:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }

    @keyframes wfhSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .spinning {
      animation: wfhSpin 0.75s linear infinite;
    }

    /* ── KPI SUMMARY GRID ── */
    .wfh-kpi-grid {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
    }

    .wfh-kpi-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      padding: 15px 16px;
      display: flex;
      align-items: flex-start;
      gap: 13px;
      text-align: left;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.02);
      position: relative;
      overflow: hidden;
    }

    .wfh-kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px -4px rgba(15, 23, 42, 0.07);
      border-color: #CBD5E1;
    }

    .wfh-kpi-card.active.kpi-indigo { border-color: #6366F1; background: #F5F7FF; box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15); }
    .wfh-kpi-card.active.kpi-emerald { border-color: #10B981; background: #F0FDF4; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15); }
    .wfh-kpi-card.active.kpi-amber { border-color: #F59E0B; background: #FFFBEB; box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15); }
    .wfh-kpi-card.active.kpi-blue { border-color: #2563EB; background: #EFF6FF; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15); }
    .wfh-kpi-card.active.kpi-rose { border-color: #EF4444; background: #FEF2F2; box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.15); }

    .kpi-icon-box {
      width: 40px;
      height: 40px;
      border-radius: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .bg-indigo { background: #EEF2FF; color: #4F46E5; border: 1px solid #E0E7FF; }
    .bg-emerald { background: #ECFDF5; color: #047857; border: 1px solid #D1FAE5; }
    .bg-amber { background: #FFFBEB; color: #B45309; border: 1px solid #FDE68A; }
    .bg-blue { background: #EFF6FF; color: #1D4ED8; border: 1px solid #DBEAFE; }
    .bg-rose { background: #FEF2F2; color: #B91C1C; border: 1px solid #FECACA; }

    .kpi-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .kpi-val {
      font-size: 22px;
      font-weight: 800;
      color: #0F172A;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .kpi-emerald .kpi-val { color: #047857; }
    .kpi-amber .kpi-val { color: #B45309; }
    .kpi-blue .kpi-val { color: #1D4ED8; }
    .kpi-rose .kpi-val { color: #B91C1C; }

    .kpi-label {
      font-size: 12.5px;
      font-weight: 700;
      color: #334155;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .kpi-sub {
      font-size: 11px;
      font-weight: 500;
      color: #64748B;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* ── TOOLBAR CARD ── */
    .wfh-toolbar-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 14px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.02);
    }

    .toolbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .month-stepper {
      display: inline-flex;
      align-items: center;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      background: #F8FAFC;
      overflow: hidden;
      height: 36px;
    }

    .step-btn {
      width: 34px;
      height: 36px;
      border: none;
      background: transparent;
      color: #475569;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.12s;
    }

    .step-btn:hover {
      background: #EFF6FF;
      color: #1373E5;
    }

    .step-month-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 14px;
      min-width: 148px;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: #0F172A;
      background: #FFFFFF;
      height: 100%;
      border-left: 1px solid #E2E8F0;
      border-right: 1px solid #E2E8F0;
    }

    .step-month-label svg {
      color: #1373E5;
    }

    .btn-this-month {
      height: 36px;
      padding: 0 12px;
      border-radius: 9px;
      border: 1px dashed #93C5FD;
      background: #EFF6FF;
      color: #1D4ED8;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }

    .btn-this-month:hover {
      background: #DBEAFE;
    }

    .status-segmented {
      display: inline-flex;
      background: #F1F5F9;
      padding: 3px;
      border-radius: 10px;
      border: 1px solid #E2E8F0;
      gap: 2px;
    }

    .status-segmented button {
      border: none;
      background: transparent;
      padding: 5px 11px;
      border-radius: 7px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 600;
      color: #64748B;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .status-segmented button:hover {
      color: #0F172A;
    }

    .status-segmented button.active {
      background: #FFFFFF;
      color: #1373E5;
      font-weight: 700;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }

    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .wfh-search-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .wfh-search-wrap .search-icon {
      position: absolute;
      left: 11px;
      color: #94A3B8;
      pointer-events: none;
    }

    .wfh-search-input {
      height: 36px !important;
      width: 230px !important;
      padding: 0 30px 0 33px !important;
      border: 1px solid #E2E8F0 !important;
      border-radius: 10px !important;
      font-size: 13px !important;
      color: #0F172A !important;
      background: #F8FAFC !important;
      transition: all 0.15s !important;
    }

    .wfh-search-input:focus {
      background: #FFFFFF !important;
      border-color: #1373E5 !important;
      box-shadow: 0 0 0 3px rgba(19, 115, 229, 0.12) !important;
      outline: none !important;
    }

    .clear-search-btn {
      position: absolute;
      right: 8px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: none;
      background: #E2E8F0;
      color: #475569;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .wfh-dept-select-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .wfh-dept-select-wrap .dept-icon {
      position: absolute;
      left: 11px;
      color: #64748B;
      pointer-events: none;
    }

    .wfh-dept-select {
      height: 36px;
      padding: 0 28px 0 32px;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      background: #FFFFFF;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      outline: none;
      transition: border-color 0.15s;
    }

    .wfh-dept-select:hover,
    .wfh-dept-select:focus {
      border-color: #CBD5E1;
    }

    /* ── LOADING & EMPTY STATES ── */
    .wfh-state-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 16px;
      padding: 48px 24px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .empty-icon-badge {
      width: 54px;
      height: 54px;
      border-radius: 16px;
      background: #EFF6FF;
      color: #1373E5;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 4px;
    }

    .wfh-state-card h4 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #0F172A;
    }

    .wfh-state-card p {
      margin: 0;
      font-size: 13px;
      color: #64748B;
      max-width: 420px;
    }

    .btn-reset-filters {
      margin-top: 8px;
      padding: 7px 14px;
      border-radius: 8px;
      border: 1px solid #CBD5E1;
      background: #FFFFFF;
      color: #0F172A;
      font-family: inherit;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-reset-filters:hover {
      background: #F8FAFC;
    }

    .loading-spinner {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 3px solid #E2E8F0;
      border-top-color: #1373E5;
      animation: wfhSpin 0.75s linear infinite;
      margin-bottom: 6px;
    }

    /* ── EMPLOYEE WFH TABLE CARD ── */
    .wfh-table-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.03);
    }

    .wfh-table-head {
      display: grid;
      grid-template-columns: minmax(250px, 1.3fr) minmax(200px, 1fr) 2.2fr;
      gap: 16px;
      padding: 12px 20px;
      background: #F8FAFC;
      border-bottom: 1px solid #E2E8F0;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748B;
    }

    .wfh-row {
      display: grid;
      grid-template-columns: minmax(250px, 1.3fr) minmax(200px, 1fr) 2.2fr;
      gap: 16px;
      align-items: center;
      padding: 14px 20px;
      border-bottom: 1px solid #F1F5F9;
      transition: background 0.12s ease;
    }

    .wfh-row:last-child {
      border-bottom: none;
    }

    .wfh-row:hover {
      background: #FAFBFD;
    }

    .wfh-person-cell {
      display: flex;
      align-items: center;
      gap: 12px;
      border: none;
      background: transparent;
      padding: 0;
      cursor: pointer;
      text-align: left;
      min-width: 0;
      font-family: inherit;
    }

    .wfh-avatar {
      width: 40px;
      height: 40px;
      flex: 0 0 40px;
      border-radius: 50%;
      background: linear-gradient(135deg, #E0E7FF 0%, #C7D2FE 100%);
      color: #3730A3;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 800;
      overflow: hidden;
      border: 2px solid #FFFFFF;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }

    .wfh-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .wfh-person-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .person-name {
      font-size: 14px;
      font-weight: 700;
      color: #0F172A;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.12s;
    }

    .wfh-person-cell:hover .person-name {
      color: #1373E5;
    }

    .person-sub {
      font-size: 12px;
      color: #64748B;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Breakdown Pills */
    .wfh-counts-cell {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .stat-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      white-space: nowrap;
    }

    .stat-pill .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .stat-pill.ok {
      background: #ECFDF5;
      color: #047857;
      border: 1px solid #A7F3D0;
    }

    .stat-pill.ok.dim {
      background: #F8FAFC;
      color: #94A3B8;
      border-color: #E2E8F0;
    }

    .stat-pill.asg {
      background: #EFF6FF;
      color: #1D4ED8;
      border: 1px solid #BFDBFE;
    }

    .stat-pill.pend {
      background: #FFFBEB;
      color: #B45309;
      border: 1px solid #FDE68A;
    }

    .stat-pill.rej {
      background: #FEF2F2;
      color: #B91C1C;
      border: 1px solid #FECACA;
    }

    /* Scheduled Date Chips */
    .wfh-days-cell {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .wfh-day-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 6px 5px 11px;
      border-radius: 10px;
      background: #ECFDF5;
      border: 1px solid #A7F3D0;
      color: #065F46;
      font-size: 12px;
      font-weight: 700;
      transition: all 0.14s ease;
    }

    .wfh-day-chip:hover {
      transform: translateY(-1px);
      box-shadow: 0 3px 6px rgba(15, 23, 42, 0.06);
    }

    .wfh-day-chip.is-hr-assigned {
      background: #EFF6FF;
      border-color: #BFDBFE;
      color: #1E40AF;
    }

    .wfh-day-chip.s-PENDING_MANAGER,
    .wfh-day-chip.s-PENDING_HR {
      background: #FFFBEB;
      border-color: #FDE68A;
      color: #92400E;
    }

    .wfh-day-chip.s-REJECTED {
      background: #FEF2F2;
      border-color: #FECACA;
      color: #991B1B;
      padding-right: 11px;
    }

    .day-date {
      font-weight: 800;
    }

    .day-weekday {
      font-size: 11px;
      font-weight: 600;
      opacity: 0.75;
    }

    .day-tag {
      font-size: 10px;
      font-weight: 800;
      padding: 1px 6px;
      border-radius: 5px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .hr-tag {
      background: #DBEAFE;
      color: #1D4ED8;
    }

    .pend-tag {
      background: #FDE68A;
      color: #92400E;
    }

    .rej-tag {
      background: #FECACA;
      color: #991B1B;
    }

    .day-cancel-btn {
      width: 20px;
      height: 20px;
      border-radius: 6px;
      border: none;
      background: rgba(255, 255, 255, 0.75);
      color: #64748B;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.12s;
      margin-left: 2px;
    }

    .day-cancel-btn:hover {
      background: #EF4444;
      color: #FFFFFF;
    }

    /* ── CANCEL CONFIRMATION MODAL ── */
    .wfh-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 1400;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .wfh-modal-card {
      width: 100%;
      max-width: 440px;
      background: #FFFFFF;
      border-radius: 18px;
      box-shadow: 0 25px 60px -15px rgba(15, 23, 42, 0.35);
      overflow: hidden;
    }

    .modal-head {
      padding: 18px 22px;
      border-bottom: 1px solid #F1F5F9;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .modal-head-left {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .danger-icon-badge {
      width: 40px;
      height: 40px;
      border-radius: 11px;
      background: #FEF2F2;
      border: 1px solid #FECACA;
      color: #DC2626;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .modal-head h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 800;
      color: #0F172A;
    }

    .modal-head p {
      margin: 3px 0 0;
      font-size: 12.5px;
      color: #64748B;
      line-height: 1.4;
    }

    .btn-icon-close {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      border: 1px solid #E2E8F0;
      background: #FFFFFF;
      color: #64748B;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }

    .modal-body {
      padding: 18px 22px;
    }

    .target-summary-box {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .summary-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 13px;
    }

    .summary-row .lbl {
      color: #64748B;
      font-weight: 600;
    }

    .summary-row .val {
      color: #0F172A;
      text-align: right;
    }

    .hr-badge-inline {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 999px;
      background: #EFF6FF;
      color: #1D4ED8;
      border: 1px solid #BFDBFE;
    }

    .modal-foot {
      padding: 14px 22px;
      background: #F8FAFC;
      border-top: 1px solid #F1F5F9;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .btn-modal-keep {
      height: 36px;
      padding: 0 15px;
      border-radius: 9px;
      border: 1px solid #CBD5E1;
      background: #FFFFFF;
      color: #334155;
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .btn-modal-danger {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 16px;
      border-radius: 9px;
      border: 1px solid #DC2626;
      background: #DC2626;
      color: #FFFFFF;
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    .btn-modal-danger:hover:not(:disabled) {
      background: #B91C1C;
    }

    @media (max-width: 1024px) {
      .wfh-kpi-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .wfh-table-head {
        display: none;
      }
      .wfh-row {
        grid-template-columns: 1fr;
        gap: 10px;
      }
    }

    @media (max-width: 640px) {
      .wfh-kpi-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `],
})
export class WfhReportComponent implements OnInit {
  private api = inject(WfhService);
  private master = inject(MasterDataService);
  private toast = inject(HotToastService);
  profile = inject(ProfileModalService);

  private now = new Date(Date.now() + 330 * 60_000);
  month = signal(this.now.getUTCMonth() + 1);
  year = signal(this.now.getUTCFullYear());
  dept = signal('');
  searchQuery = signal('');
  statusFilter = signal<StatusFilter>('ALL');

  departments = signal<any[]>([]);
  data = signal<any>(null);
  loading = signal(true);

  cancelTarget = signal<{ employee: any; day: any } | null>(null);
  cancelling = signal(false);

  monthLabel = computed(() =>
    new Date(Date.UTC(this.year(), this.month() - 1, 1)).toLocaleDateString('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
  );

  isCurrentMonth = computed(
    () => this.month() === this.now.getUTCMonth() + 1 && this.year() === this.now.getUTCFullYear()
  );

  filteredPeople = computed(() => {
    const raw = this.data()?.people || [];
    const q = this.searchQuery().trim().toLowerCase();
    const filter = this.statusFilter();

    return raw.filter((p: any) => {
      if (filter === 'APPROVED' && !p.approved) return false;
      if (filter === 'PENDING' && !p.pending) return false;
      if (filter === 'ASSIGNED' && !p.assigned) return false;
      if (filter === 'REJECTED' && !p.rejected) return false;

      if (q) {
        const fullName = `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.toLowerCase();
        const desig = (p.employee?.designation?.name || '').toLowerCase();
        const deptName = (p.employee?.department?.name || '').toLowerCase();
        if (!fullName.includes(q) && !desig.includes(q) && !deptName.includes(q)) {
          return false;
        }
      }
      return true;
    });
  });

  ngOnInit() {
    this.master.getDepartments(true).subscribe({
      next: (d: any) => this.departments.set(d || []),
      error: () => {},
    });
    this.load();
  }

  load() {
    this.loading.set(true);
    this.api.report(this.month(), this.year(), this.dept() || undefined).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.toast.error(e.error?.message || 'Could not load the WFH report');
      },
    });
  }

  move(step: number) {
    let m = this.month() + step;
    let y = this.year();
    if (m < 1) {
      m = 12;
      y--;
    } else if (m > 12) {
      m = 1;
      y++;
    }
    this.month.set(m);
    this.year.set(y);
    this.load();
  }

  resetToCurrentMonth() {
    this.month.set(this.now.getUTCMonth() + 1);
    this.year.set(this.now.getUTCFullYear());
    this.load();
  }

  setStatusFilter(f: StatusFilter) {
    this.statusFilter.set(this.statusFilter() === f ? 'ALL' : f);
  }

  hasActiveFilters(): boolean {
    return !!this.searchQuery().trim() || this.statusFilter() !== 'ALL' || !!this.dept();
  }

  clearFilters() {
    this.searchQuery.set('');
    this.statusFilter.set('ALL');
    if (this.dept()) {
      this.dept.set('');
      this.load();
    }
  }

  promptCancel(employee: any, day: any) {
    this.cancelTarget.set({ employee, day });
  }

  confirmCancel() {
    const target = this.cancelTarget();
    if (!target) return;
    this.cancelling.set(true);
    this.api.adminCancel(target.day.id).subscribe({
      next: () => {
        this.cancelling.set(false);
        this.cancelTarget.set(null);
        this.toast.success('WFH day cancelled');
        this.load();
      },
      error: (e) => {
        this.cancelling.set(false);
        this.toast.error(e.error?.message || 'Could not cancel');
      },
    });
  }

  exportCsv() {
    const people = this.filteredPeople();
    if (!people.length) return;

    const rows = [
      ['Employee Name', 'Designation', 'Department', 'Approved Days', 'HR Assigned Days', 'Pending Days', 'Rejected Days', 'Dates'],
    ];

    for (const p of people) {
      const name = `${p.employee?.firstName || ''} ${p.employee?.lastName || ''}`.trim();
      const desig = p.employee?.designation?.name || '';
      const deptName = p.employee?.department?.name || '';
      const datesList = (p.days || [])
        .map((d: any) => `${String(d.date).slice(0, 10)} (${d.source === 'ASSIGNED' ? 'HR Assigned' : d.status})`)
        .join('; ');
      rows.push([
        name,
        desig,
        deptName,
        String(p.approved || 0),
        String(p.assigned || 0),
        String(p.pending || 0),
        String(p.rejected || 0),
        datesList,
      ]);
    }

    const csv = rows
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wfh-report-${this.year()}-${String(this.month()).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}
