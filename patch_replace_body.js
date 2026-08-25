const fs = require('fs');
const path = '/Users/mohitsingh/Documents/nex-erp/frontend/src/app/crm/leads/leads.html';

let content = fs.readFileSync(path, 'utf8');

// Find where <div class="modal-body enhanced-body"> starts and ends.
const startIdx = content.indexOf('<div class="modal-body enhanced-body">');
const endIdx = content.indexOf('<div class="modal-footer enhanced-footer">');

if (startIdx !== -1 && endIdx !== -1) {
  const newBody = `<div class="modal-body enhanced-body">
      <!-- Step 1: Primary Contact Information -->
      <div *ngIf="activeTab === 1" class="step-content-anim">
        <div class="form-row">
          <div class="form-group" [class.has-error]="isSubmitted && !newLeadData.title.trim()">
            <label>Opportunity Title <span class="required-asterisk">*</span></label>
            <input type="text" [(ngModel)]="newLeadData.title" placeholder="e.g., Enterprise Software Package" [disabled]="isSaving" />
            <span class="error-msg" *ngIf="isSubmitted && !newLeadData.title.trim()">Opportunity Title is required.</span>
          </div>
          <div class="form-group">
            <label>Subject Line / Deal Summary</label>
            <input type="text" [(ngModel)]="newLeadData.subjectLine" placeholder="e.g., SD-WAN Multi-Branch Setup" [disabled]="isSaving" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group" [class.has-error]="isSubmitted && !newLeadData.companyName.trim()">
            <label>Company Name <span class="required-asterisk">*</span></label>
            <input type="text" [(ngModel)]="newLeadData.companyName" placeholder="e.g., Acme Technologies Inc." [disabled]="isSaving" />
            <span class="error-msg" *ngIf="isSubmitted && !newLeadData.companyName.trim()">Company Name is required.</span>
          </div>
          <div class="form-group">
            <label>Primary Contact Name</label>
            <input type="text" [(ngModel)]="newLeadData.contactName" placeholder="e.g., John Doe" [disabled]="isSaving" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group" [class.has-error]="isSubmitted && !newLeadData.email.trim()">
            <label>Email Address <span class="required-asterisk">*</span></label>
            <input type="email" [(ngModel)]="newLeadData.email" placeholder="john@acme.com" [disabled]="isSaving" />
            <span class="error-msg" *ngIf="isSubmitted && !newLeadData.email.trim()">Email is required.</span>
          </div>
          <div class="form-group" [class.has-error]="isSubmitted && !newLeadData.phone.trim()">
            <label>WhatsApp / Phone Number <span class="required-asterisk">*</span></label>
            <input type="text" [(ngModel)]="newLeadData.phone" placeholder="+1 (555) 000-0000" [disabled]="isSaving" />
            <span class="error-msg" *ngIf="isSubmitted && !newLeadData.phone.trim()">WhatsApp/Phone is required.</span>
          </div>
        </div>
      </div>

      <!-- Step 2: Deal & Pipeline Tracking -->
      <div *ngIf="activeTab === 2" class="step-content-anim">
        <div class="form-row">
          <div class="form-group">
            <label>Initial Pipeline Status</label>
            <select [(ngModel)]="newLeadData.status" [disabled]="isSaving" class="enhanced-select">
              <option *ngFor="let status of LEAD_STATUSES" [value]="status">{{status}}</option>
            </select>
          </div>
          <div class="form-group">
            <label>Deal Category</label>
            <select [(ngModel)]="newLeadData.dealCategory" [disabled]="isSaving" class="enhanced-select">
              <option *ngFor="let cat of DEAL_CATEGORIES" [value]="cat.id">{{cat.name}}</option>
            </select>
          </div>
          <div class="form-group">
            <label>Lead Source</label>
            <select [(ngModel)]="newLeadData.source" [disabled]="isSaving" class="enhanced-select">
              <option *ngFor="let src of LEAD_SOURCES" [value]="src">{{src}}</option>
            </select>
            <input 
              *ngIf="newLeadData.source === 'Other'" 
              type="text" 
              [(ngModel)]="customSource" 
              placeholder="Specify custom source channel..." 
              style="margin-top: 8px;" 
              [disabled]="isSaving" 
            />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Expected Deal Value</label>
            <div class="input-with-icon">
              <span class="input-prefix">$</span>
              <input type="number" [(ngModel)]="newLeadData.value" placeholder="0.00" [disabled]="isSaving" class="currency-input" />
            </div>
          </div>
          <div class="form-group">
            <label>Expected Close Date</label>
            <input type="date" [(ngModel)]="newLeadData.expectedCloseDate" [disabled]="isSaving" />
          </div>
        </div>

        <div class="form-row">
          <!-- 1. Lead Brought By -->
          <div class="form-group custom-select-group">
            <label>Lead Brought By (Source Generator)</label>
            <div class="owner-select-trigger" (click)="showBroughtByDropdown = !showBroughtByDropdown" [class.active]="showBroughtByDropdown">
              <div *ngIf="getSelectedBroughtBy() as broughtBy" class="selected-owner-display">
                <div class="owner-avatar-circle" *ngIf="!broughtBy.avatarUrl">
                  {{broughtBy.firstName ? broughtBy.firstName[0] : ''}}{{broughtBy.lastName ? broughtBy.lastName[0] : ''}}
                </div>
                <img *ngIf="broughtBy.avatarUrl" [src]="broughtBy.avatarUrl" class="owner-avatar-img" />
                <div class="owner-info-text">
                  <span class="owner-name">{{broughtBy.firstName}} {{broughtBy.lastName}}</span>
                  <span class="owner-designation" *ngIf="broughtBy.designation?.name">{{broughtBy.designation?.name}}</span>
                </div>
                <button type="button" class="btn-clear-owner" (click)="$event.stopPropagation(); selectBroughtBy(null)">
                  <svg lucideX size="14"></svg>
                </button>
              </div>
              <div *ngIf="!getSelectedBroughtBy()" class="unassigned-placeholder">
                <div class="owner-avatar-circle unassigned-avatar">
                  <svg lucideUser size="14"></svg>
                </div>
                <span class="placeholder-text">Select Person Who Brought Lead...</span>
                <svg lucideChevronDown size="16" class="chevron-icon"></svg>
              </div>
            </div>
            <div class="owner-dropdown-menu" *ngIf="showBroughtByDropdown">
              <div class="owner-search-box">
                <svg lucideSearch size="14" class="owner-search-icon"></svg>
                <input type="text" placeholder="Search by name, role..." [(ngModel)]="broughtBySearchQuery" (click)="$event.stopPropagation()" />
              </div>
              <div class="owner-list-scroll">
                <div class="owner-item" (click)="selectBroughtBy(null)" [class.selected]="!newLeadData.addedById">
                  <div class="owner-avatar-circle unassigned-avatar">
                    <svg lucideUser size="14"></svg>
                  </div>
                  <div class="owner-item-details">
                    <span class="owner-item-name">None / External</span>
                    <span class="owner-item-sub">Direct or external source</span>
                  </div>
                </div>
                <div class="owner-item" *ngFor="let emp of getFilteredBroughtByEmployees()" (click)="selectBroughtBy(emp)" [class.selected]="newLeadData.addedById === emp.id">
                  <div class="owner-avatar-circle" *ngIf="!emp.avatarUrl">
                    {{emp.firstName ? emp.firstName[0] : ''}}{{emp.lastName ? emp.lastName[0] : ''}}
                  </div>
                  <img *ngIf="emp.avatarUrl" [src]="emp.avatarUrl" class="owner-avatar-img" />
                  <div class="owner-item-details">
                    <span class="owner-item-name">{{emp.firstName}} {{emp.lastName}}</span>
                    <span class="owner-designation" *ngIf="emp.designation?.name">{{emp.designation?.name}}</span>
                    <span class="owner-designation" *ngIf="!emp.designation?.name && emp.department?.name">{{emp.department.name}}</span>
                  </div>
                </div>
                <div *ngIf="getFilteredBroughtByEmployees().length === 0" class="no-owners-found">
                  No matching team members found
                </div>
              </div>
            </div>
          </div>

          <!-- 2. Lead Owner / Assigned To -->
          <div class="form-group custom-select-group">
            <label>Lead Owner / Assigned Rep (Finance Dept)</label>
            <div class="owner-select-trigger" (click)="showOwnerDropdown = !showOwnerDropdown" [class.active]="showOwnerDropdown">
              <div *ngIf="getSelectedOwner() as owner" class="selected-owner-display">
                <div class="owner-avatar-circle" *ngIf="!owner.avatarUrl">
                  {{owner.firstName ? owner.firstName[0] : ''}}{{owner.lastName ? owner.lastName[0] : ''}}
                </div>
                <img *ngIf="owner.avatarUrl" [src]="owner.avatarUrl" class="owner-avatar-img" />
                <div class="owner-info-text">
                  <span class="owner-name">{{owner.firstName}} {{owner.lastName}}</span>
                  <span class="owner-designation" *ngIf="owner.designation?.name">{{owner.designation?.name}}</span>
                </div>
                <button type="button" class="btn-clear-owner" (click)="$event.stopPropagation(); selectOwner(null)">
                  <svg lucideX size="14"></svg>
                </button>
              </div>
              <div *ngIf="!getSelectedOwner()" class="unassigned-placeholder">
                <div class="owner-avatar-circle unassigned-avatar">
                  <svg lucideUser size="14"></svg>
                </div>
                <span class="placeholder-text">Select Rep...</span>
                <svg lucideChevronDown size="16" class="chevron-icon"></svg>
              </div>
            </div>
            <div class="owner-dropdown-menu" *ngIf="showOwnerDropdown">
              <div class="owner-search-box">
                <svg lucideSearch size="14" class="owner-search-icon"></svg>
                <input type="text" placeholder="Search by name, role..." [(ngModel)]="ownerSearchQuery" (click)="$event.stopPropagation()" />
              </div>
              <div class="owner-list-scroll">
                <div class="owner-item" (click)="selectOwner(null)" [class.selected]="!newLeadData.assignedToId">
                  <div class="owner-avatar-circle unassigned-avatar">
                    <svg lucideUser size="14"></svg>
                  </div>
                  <div class="owner-item-details">
                    <span class="owner-item-name">Unassigned</span>
                    <span class="owner-item-sub">No owner assigned yet</span>
                  </div>
                </div>
                <div class="owner-item" *ngFor="let emp of getFilteredEmployees()" (click)="selectOwner(emp)" [class.selected]="newLeadData.assignedToId === emp.id">
                  <div class="owner-avatar-circle" *ngIf="!emp.avatarUrl">
                    {{emp.firstName ? emp.firstName[0] : ''}}{{emp.lastName ? emp.lastName[0] : ''}}
                  </div>
                  <img *ngIf="emp.avatarUrl" [src]="emp.avatarUrl" class="owner-avatar-img" />
                  <div class="owner-item-details">
                    <span class="owner-item-name">{{emp.firstName}} {{emp.lastName}}</span>
                    <span class="owner-designation" *ngIf="emp.designation?.name">{{emp.designation?.name}}</span>
                    <span class="owner-designation" *ngIf="!emp.designation?.name && emp.department?.name">{{emp.department.name}}</span>
                  </div>
                </div>
                <div *ngIf="getFilteredEmployees().length === 0" class="no-owners-found">
                  No matching finance reps found
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: Additional Details -->
      <div *ngIf="activeTab === 3" class="step-content-anim">
        <div class="form-group">
          <label>Lead Description / Notes</label>
          <textarea [(ngModel)]="newLeadData.description" placeholder="Enter background information, pain points, or notes..." rows="3" [disabled]="isSaving"></textarea>
        </div>
        
        <div class="form-group">
          <label>Company Website</label>
          <input type="url" [(ngModel)]="newLeadData.website" placeholder="https://acme.com" [disabled]="isSaving" />
        </div>
        
        <div class="form-group">
          <label>Office Address</label>
          <textarea [(ngModel)]="newLeadData.address" placeholder="Enter physical office address or city/state..." rows="3" [disabled]="isSaving"></textarea>
        </div>
      </div>
    </div>
    
    `;

  content = content.substring(0, startIdx) + newBody + content.substring(endIdx);
  fs.writeFileSync(path, content);
  console.log('Successfully replaced body!');
} else {
  console.log('Failed to find start or end index.');
}
