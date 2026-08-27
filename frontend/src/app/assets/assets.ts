import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import { MatMenuModule } from '@angular/material/menu';
import { AssetService, Asset, AssetAssignment, HardwareRequest, InventoryItem, InventoryTransaction } from '../services/asset.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { UploadService } from '../services/upload.service';
import { AuthService } from '../services/auth.service';
import { PermissionsService } from '../services/permissions.service';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideLaptop,
  LucidePlus,
  LucideSearch,
  LucideFilter,
  LucideUserCheck,
  LucideCheckCircle,
  LucideWrench,
  LucideMoreHorizontal,
  LucideX,
  LucideClock,
  LucideUploadCloud,
  LucideTrash2,
  LucideImage,
  LucidePackage,
  LucideLayers,
  LucideDownload,
  LucideRotateCcw,
  LucideAlertTriangle,
  LucideArchive,
  LucideIndianRupee,
  LucideSettings
} from '@lucide/angular';

import { AssetActionCellRendererComponent } from '../shared/components/asset-action-cell-renderer.component';
import { SearchableSelectComponent, SearchableSelectOption } from '../shared/components/searchable-select/searchable-select.component';

const ADD_NEW_CATEGORY_ID = '__ADD_NEW_CATEGORY__';

interface AssetFormErrors {
  name?: string;
  quantity?: string;
  cost?: string;
}

function getCategoryClass(cat: string): string {
  const c = (cat || '').toLowerCase();
  if (['laptop', 'desktop', 'monitor', 'printer', 'software', 'mobile', 'peripheral'].includes(c)) {
    return `cat-${c}`;
  }
  if (['furniture', 'pantry', 'stationery', 'housekeeping'].includes(c)) {
    return `cat-${c}`;
  }
  return 'cat-default';
}

function getStatusClass(status: string): string {
  const s = (status || '').toLowerCase().replace('_', '-');
  return `status-${s}`;
}

function getConditionClass(cond: string): string {
  const c = (cond || '').toLowerCase().replace('_', '-');
  return `cond-${c}`;
}

function getUrgencyClass(urgency: string): string {
  const u = (urgency || '').toLowerCase();
  return `urgency-${u}`;
}

const CONSUMABLE_CATEGORIES = ['PANTRY', 'STATIONERY', 'HOUSEKEEPING'];
const IT_CATEGORIES = ['LAPTOP', 'DESKTOP', 'MONITOR', 'PRINTER', 'PERIPHERAL', 'MOBILE'];

@Component({
  selector: 'app-assets',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AgGridModule,
    MatMenuModule,
    LucideLaptop,
    LucidePlus,
    LucideSearch,
    LucideUserCheck,
    LucideCheckCircle,
    LucideWrench,
    LucideX,
    LucideClock,
    LucideUploadCloud,
    LucideTrash2,
    LucideImage,
    LucidePackage,
    LucideLayers,
    LucideDownload,
    LucideRotateCcw,
    LucideAlertTriangle,
    LucideArchive,
    LucideIndianRupee,
    LucideMoreHorizontal,
    LucideSettings,
    SearchableSelectComponent
  ],
  providers: [DatePipe],
  templateUrl: './assets.html',
  styleUrls: ['./assets.css']
})
export class AssetsComponent implements OnInit {
  private assetService = inject(AssetService);
  private employeeService = inject(EmployeeService);
  private uploadService = inject(UploadService);
  private authService = inject(AuthService);
  private permissionsService = inject(PermissionsService);
  private toast = inject(HotToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // State Signals
  activeTab = signal<'inventory' | 'assignments' | 'requests'>('inventory');

  // Tab-level permissions (only relevant for non-admin roles)
  canViewInventory = signal(true);
  canViewAssignments = signal(true);
  canViewRequests = signal(true);
  assets = signal<Asset[]>([]);
  assignments = signal<AssetAssignment[]>([]);
  requests = signal<HardwareRequest[]>([]);
  employees = signal<Employee[]>([]);

  // Product/Batch Inventory state
  inventoryItems = signal<InventoryItem[]>([]);
  inventoryAssignments = signal<any[]>([]);
  inventoryLoading = signal<boolean>(false);

  readonly maxUploadFiles = 5;
  readonly maxUploadFileSizeMb = 20;
  readonly maxUploadFileSizeBytes = this.maxUploadFileSizeMb * 1024 * 1024;

  // Category configuration (category-aware fields)
  readonly categories: { value: string; label: string }[] = [
    { value: 'PANTRY', label: 'Pantry Items' },
    { value: 'STATIONERY', label: 'Stationery' },
    { value: 'HOUSEKEEPING', label: 'Housekeeping' },
    { value: 'FURNITURE', label: 'Furniture' },
    { value: 'LAPTOP', label: 'Laptop' },
    { value: 'DESKTOP', label: 'Desktop' },
    { value: 'MONITOR', label: 'Monitor' },
    { value: 'PRINTER', label: 'Printer' },
    { value: 'PERIPHERAL', label: 'Keyboard / Mouse' },
    { value: 'MOBILE', label: 'Mobile / Tablet' },
    { value: 'OTHER', label: 'Other' }
  ];
  readonly unitOptions = ['units', 'pcs', 'packets', 'boxes', 'bottles', 'pairs', 'sets', 'kg', 'litres'];

  // User Auth Role
  currentUser = signal<any>(null);
  isAdmin = computed(() => {
    const r = this.currentUser()?.role;
    return r === 'SUPERADMIN' || r === 'ADMIN' || r === 'HR' || r === 'OFFICE_STAFF';
  });
  isSuperAdmin = computed(() => {
    return this.currentUser()?.role === 'SUPERADMIN';
  });

  // Legacy KPI Metrics (requests tab)
  pendingRequestsCount = computed(() => this.requests().filter(r => r.status === 'PENDING').length);

  // Inventory KPI Metrics
  invTotalItems = computed(() => this.inventoryItems().length);
  invTotalUnits = computed(() => this.inventoryItems().reduce((s, i) => s + (i.quantity || 0), 0));
  invAvailableUnits = computed(() => this.inventoryItems().reduce((s, i) => s + (i.available || 0), 0));
  invAssignedUnits = computed(() => this.inventoryItems().reduce((s, i) => s + (i.netAssigned || 0), 0));
  invLowStockCount = computed(() => this.inventoryItems().filter(i => i.lowStock).length);
  invExpiringCount = computed(() => this.inventoryItems().filter(i => i.expiringSoon && i.statusLabel !== 'Expired').length);
  invExpiredCount = computed(() => this.inventoryItems().filter(i => i.statusLabel === 'Expired').length);
  invTotalValue = computed(() => this.inventoryItems().reduce((s, i) => s + (i.totalValue || 0), 0));

  // Filter Query
  searchQuery = signal<string>('');

  // Available Assets for assignment dropdown (legacy hardware request fulfillment)
  availableAssets = computed(() => this.assets().filter(a => a.status === 'AVAILABLE'));

  // ===== Item Detail Modal =====
  isItemDetailOpen = signal<boolean>(false);
  detailItemId = signal<number | null>(null);
  detailTxns = signal<InventoryTransaction[]>([]);
  detailLoading = signal<boolean>(false);
  detailTab = signal<'ALL' | 'ASSIGNMENT' | 'RETURN' | 'CONSUMPTION' | 'ADJUSTMENT'>('ALL');

  selectedItem = computed(() => this.inventoryItems().find(i => i.id === this.detailItemId()) || null);

  filteredDetailTxns = computed(() => {
    const tab = this.detailTab();
    const txns = this.detailTxns();
    switch (tab) {
      case 'ASSIGNMENT': return txns.filter(t => t.type === 'ASSIGNMENT');
      case 'RETURN': return txns.filter(t => t.type === 'RETURN');
      case 'CONSUMPTION': return txns.filter(t => t.type === 'CONSUMPTION');
      case 'ADJUSTMENT': return txns.filter(t => t.type === 'ADJUSTMENT' || t.type === 'EXPIRED');
      default: return txns;
    }
  });

  // ===== Inventory Item Form (Add/Edit) =====
  isInvItemFormOpen = signal(false);
  savingItem = signal(false);
  invItemForm: any = this.emptyItemForm();

  get isItCategory(): boolean {
    return IT_CATEGORIES.includes(this.invItemForm.category);
  }
  get showConsumableFields(): boolean {
    return this.invItemForm.itemType === 'CONSUMABLE';
  }
  get invTotalCostPreview(): number {
    return (Number(this.invItemForm.quantity) || 0) * (Number(this.invItemForm.unitCost) || 0);
  }

  // ===== Assign / Return / Consume / Expire / Adjust modals =====
  isInvAssignOpen = signal(false);
  invAssignSubmitting = signal(false);
  invAssignError = signal('');
  invAssignForm: any = {};

  isInvReturnOpen = signal(false);
  invReturnSubmitting = signal(false);
  invReturnError = signal('');
  invReturnTarget = signal<InventoryTransaction | null>(null);
  invReturnMax = signal(0);

  isTxnCheckOpen = signal(false);
  checkedTxn = signal<InventoryTransaction | null>(null);
  invReturnForm: any = {};

  isInvConsumeOpen = signal(false);
  invConsumeSubmitting = signal(false);
  invConsumeError = signal('');
  invConsumeForm: any = {};

  isInvExpireOpen = signal(false);
  invExpireSubmitting = signal(false);
  invExpireError = signal('');
  invExpireForm: any = {};

  isInvAdjustOpen = signal(false);
  invAdjustSubmitting = signal(false);
  invAdjustError = signal('');
  invAdjustForm: any = {};
  invAdjustNewTotal = computed(() => {
    const item = this.selectedItem();
    if (!item) return 0;
    return Math.max(0, item.quantity + (Number(this.invAdjustForm.delta) || 0));
  });

  importing = signal(false);

  // Drawer & Modal States (legacy flows)
  isAssignDrawerOpen = signal<boolean>(false);
  isAssetDrawerOpen = signal<boolean>(false);
  isReturnModalOpen = signal<boolean>(false);
  isRequestDrawerOpen = signal<boolean>(false);
  isFulfillModalOpen = signal<boolean>(false);
  isRejectModalOpen = signal<boolean>(false);
  isAddCategoryModalOpen = signal<boolean>(false);
  newCategoryName = signal<string>('');

  // Categories: standard set + any custom categories already used by this company
  private readonly standardCategories: SearchableSelectOption[] = [
    { id: 'LAPTOP', name: 'Laptop' },
    { id: 'DESKTOP', name: 'Desktop' },
    { id: 'MONITOR', name: 'Monitor' },
    { id: 'PERIPHERAL', name: 'Peripheral (Keyboard/Mouse)' },
    { id: 'SOFTWARE', name: 'Software License' },
    { id: 'MOBILE', name: 'Mobile / Tablet' }
  ];
  customCategories = signal<string[]>([]);
  categoryOptions = computed<SearchableSelectOption[]>(() => {
    const custom = this.customCategories()
      .filter(c => !this.standardCategories.some(s => s.id === c))
      .map(c => ({ id: c, name: c }));
    return [...this.standardCategories, ...custom, { id: ADD_NEW_CATEGORY_ID, name: '+ Add New Category' }];
  });

  // Detail Modal
  isDetailModalOpen = signal<boolean>(false);
  detailAsset = signal<Asset | null>(null);

  openDetailModal(asset: Asset) {
    this.detailAsset.set(asset);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal() {
    this.isDetailModalOpen.set(false);
    this.detailAsset.set(null);
  }

  getDetailImages(): string[] {
    const a = this.detailAsset();
    if (!a?.images) return [];
    try { return typeof a.images === 'string' ? JSON.parse(a.images as any) : a.images; } catch { return []; }
  }

  getDetailTags(): string[] {
    const a = this.detailAsset();
    if (!a?.tags) return [];
    try { return typeof a.tags === 'string' ? JSON.parse(a.tags as any) : a.tags; } catch { return []; }
  }

  // Image Lightbox & Edit Request States
  previewImages = signal<string[]>([]);
  activeImageIndex = signal<number>(0);
  editingRequestId = signal<number | null>(null);

  rejectForm = {
    requestId: 0,
    rejectionReason: ''
  };

  // Form Objects
  assetForm = {
    id: 0,
    assetTag: '',
    name: '',
    category: 'LAPTOP',
    quantity: 1,
    brand: '',
    model: '',
    serialNumber: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    cost: 0,
    warrantyExpiry: '',
    images: [] as string[],
    location: '',
    notes: '',
    tags: [] as string[],
    status: 'AVAILABLE',
    ram: '',
    storage: '',
    processor: ''
  };
  tagInput = '';

  assetFormErrors: AssetFormErrors = {};
  isSaving = false;

  assignForm = {
    assetId: 0,
    employeeId: 0,
    assignedDate: new Date().toISOString().split('T')[0],
    conditionOnAssign: 'GOOD',
    notes: ''
  };

  returnForm = {
    assignmentId: 0,
    returnDate: new Date().toISOString().split('T')[0],
    conditionOnReturn: 'GOOD',
    assetNextStatus: 'AVAILABLE',
    notes: ''
  };

  requestForm = {
    requestType: 'NEW_DEVICE',
    category: 'LAPTOP',
    urgency: 'MEDIUM',
    reason: '',
    images: [] as string[]
  };

  isSelfRequest(data: any): boolean {
    if (!data || !this.currentUser()) return false;
    const currentUserId = this.currentUser()?.id;
    const currentEmpId = this.currentUser()?.employee?.id;
    const reqUserId = data.employee?.userId || data.employee?.user?.id;
    const reqEmpId = data.employeeId || data.employee?.id;
    return (!!currentUserId && reqUserId === currentUserId) || (!!currentEmpId && reqEmpId === currentEmpId);
  }

  fulfillForm = {
    requestId: 0,
    fulfilledAssetId: 0,
    rejectionReason: ''
  };

  // AG Grid Default Column Def
  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true
  };
  paginationPageSize = 10;
  paginationPageSizeOptions = [10, 20, 50];

  // ==========================================
  // FORMATTERS & HELPERS
  // ==========================================
  fmtMoney(n?: number | null): string {
    if (n === null || n === undefined || isNaN(n)) return '-';
    return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  fmtDate(d?: string | Date | null): string {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  outstandingOf(t: InventoryTransaction): number {
    const returned = (t.linkedReturns || []).reduce((s, r) => s + (r.quantity || 0), 0);
    return Math.max(0, (t.quantity || 0) - returned);
  }

  txnParty(t: InventoryTransaction): string {
    if (t.employee) return `${t.employee.firstName} ${t.employee.lastName}`;
    if (t.assigneeText) return t.assigneeText;
    return '-';
  }

  openTxnCheck(t: InventoryTransaction) {
    this.checkedTxn.set(t);
    this.isTxnCheckOpen.set(true);
  }

  returnConditionLabel(c?: string | null): string {
    return c ? c.replace(/_/g, ' ') : 'Not recorded';
  }

  returnConditionClass(c?: string | null): string {
    return getConditionClass(c || '');
  }

  creatorName(t: InventoryTransaction): string {
    if (!t.createdBy) return '-';
    return (t.createdBy.email || '').split('@')[0] || '-';
  }

  typeBadgeClass(t: InventoryTransaction): string {
    switch (t.type) {
      case 'PURCHASE': return 'txn-purchase';
      case 'ASSIGNMENT': return 'txn-assigned';
      case 'RETURN': return 'txn-returned';
      case 'CONSUMPTION': return 'txn-consumed';
      case 'EXPIRED': return 'txn-expired';
      default: return 'txn-adjustment';
    }
  }

  typeLabel(t: InventoryTransaction): string {
    switch (t.type) {
      case 'PURCHASE': return 'PURCHASE';
      case 'ASSIGNMENT': return 'ASSIGNED';
      case 'RETURN': return 'RETURNED';
      case 'CONSUMPTION': return 'CONSUMED';
      case 'EXPIRED': return 'EXPIRED';
      case 'ADJUSTMENT': return t.quantity > 0 ? 'ADDED STOCK' : 'REMOVED STOCK';
      default: return t.type;
    }
  }

  statusClassFor(label: string): string {
    switch (label) {
      case 'In Stock': return 'status-in-stock';
      case 'Partially Assigned': return 'status-partially-assigned';
      case 'Fully Assigned': return 'status-fully-assigned';
      case 'Expired': return 'status-expired';
      case 'Out of Stock': return 'status-out-of-stock';
      case 'Under Repair': return 'status-in-repair';
      default: return 'status-retired';
    }
  }

  getCatBadgeClass(cat?: string): string {
    return getCategoryClass(cat || '');
  }

  getAssignmentRowId = (params: any) => params.data?.key || String(params.data?.id || '');

  private emptyItemForm() {
    return {
      id: null as number | null,
      name: '',
      category: 'PANTRY',
      itemType: 'CONSUMABLE',
      brand: '',
      unit: 'packets',
      quantity: null as number | null,
      unitCost: null as number | null,
      purchaseDate: new Date().toISOString().split('T')[0],
      supplier: '',
      batchNumber: '',
      expiryDate: '',
      location: '',
      model: '',
      serialNumber: '',
      warrantyExpiry: '',
      notes: ''
    };
  }

  onCategoryChange() {
    const cat = this.invItemForm.category;
    if (CONSUMABLE_CATEGORIES.includes(cat)) {
      this.invItemForm.itemType = 'CONSUMABLE';
      if (!this.unitOptions.includes(this.invItemForm.unit)) this.invItemForm.unit = 'packets';
    } else if (IT_CATEGORIES.includes(cat)) {
      this.invItemForm.itemType = 'ASSET';
      this.invItemForm.unit = 'units';
    } else if (cat === 'FURNITURE') {
      this.invItemForm.itemType = 'ASSET';
      this.invItemForm.unit = 'pcs';
    }
  }

  // ==========================================
  // INVENTORY GRID
  // ==========================================
  catLabel(cat?: string): string {
    const c = String(cat || '').toUpperCase();
    if (!c) return '-';
    const found = this.categories.find(x => x.value === c);
    return found ? found.label : c;
  }

  invRowHeight = (params: any): number => {
    const nameLen = String(params?.data?.name || '').length;
    return nameLen > 34 ? 72 : 56;
  };

  inventoryColDefs: ColDef[] = [
    {
      headerName: 'Item Name',
      field: 'name',
      flex: 2.4,
      minWidth: 220,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const sub: string[] = [];
        if (params.data.batchNumber) sub.push(`Batch: ${params.data.batchNumber}`);
        if (params.data.location) sub.push(params.data.location);
        return `
          <div class="cell-stacked" title="${params.data.name}">
            <div class="cell-title-bold cell-wrap">${params.data.name}</div>
            ${sub.length ? `<div class="cell-subtitle-row"><span>${sub.join(' • ')}</span></div>` : ''}
          </div>
        `;
      },
      onCellClicked: (params: any) => {
        const target = params.event?.target as HTMLElement;
        if (target?.closest('[data-view-detail]')) {
          this.openDetailModal(params.data);
        }
      }
    },
    {
      headerName: 'Brand',
      field: 'brand',
      flex: 1,
      minWidth: 140,
      valueGetter: (p: any) => p.data?.brand || '-'
    },
    {
      headerName: 'Category',
      field: 'category',
      flex: 1.15,
      minWidth: 160,
      valueGetter: (p: any) => this.catLabel(p.data?.category),
      cellRenderer: (params: any) => {
        if (!params.value || params.value === '-') return '-';
        const raw = String(params.data?.category || '');
        return `<span class="cat-badge ${getCategoryClass(raw)}">${this.catLabel(raw)}</span>`;
      }
    },
    {
      headerName: 'Quantity',
      field: 'quantity',
      width: 100,
      type: 'alignedCenter',
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => params.value != null ? `<span class="cell-num">${params.value}</span>` : '-'
    },
    {
      headerName: 'Unit Cost',
      field: 'unitCost',
      width: 120,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p: any) => this.fmtMoney(p.value)
    },
    {
      headerName: 'Total Value',
      field: 'totalValue',
      width: 140,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => `<span class="cell-num-strong">${this.fmtMoney(params.value)}</span>`
    },
    {
      headerName: 'Purchase Date',
      field: 'purchaseDate',
      width: 148,
      type: 'alignedCenter',
      valueFormatter: () => '',
      valueGetter: (p: any) => p.data?.purchaseDate || '',
      cellRenderer: (params: any) => this.fmtDate(params.value)
    },
    {
      headerName: 'Available',
      field: 'available',
      width: 110,
      type: 'alignedCenter',
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => {
        const v = params.value ?? 0;
        if (v <= 0) return `<span class="cell-num text-danger-cell">0</span>`;
        return `<span class="cell-num-strong" style="color:#059669;">${v}</span>`;
      }
    },
    {
      headerName: 'Assigned',
      field: 'netAssigned',
      width: 110,
      type: 'alignedCenter',
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => {
        const v = params.value ?? 0;
        return v > 0 ? `<span class="cell-num-strong" style="color:#2563EB;">${v}</span>` : `<span class="cell-num">0</span>`;
      }
    },
    {
      headerName: 'Status',
      field: 'statusLabel',
      width: 138,
      type: 'alignedCenter',
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const cls = this.statusClassFor(params.value || 'In Stock');
        return `
          <div class="status-stack">
            <span class="status-pill ${cls}">
              <span class="status-dot"></span>
              ${params.value}
            </span>
          </div>
        `;
      }
    },
    {
      headerName: 'Actions',
      field: 'actions',
      width: 96,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: AssetActionCellRendererComponent,
      cellRendererParams: {
        editLabel: 'Edit Item',
        onEdit: (data: InventoryItem) => this.openEditItemModal(data),
        onAssign: (data: InventoryItem) => this.openDetailThenAssign(data.id),
        onDelete: (data: InventoryItem) => this.deleteInventoryItem(data)
      }
    }
  ];

  onInventoryRowClicked(event: any) {
    if (!event?.data) return;
    if (event.column?.getColId() === 'actions') return;
    this.openItemDetail(event.data.id);
  }

  // ==========================================
  // ASSIGNMENTS GRID (merged legacy + inventory)
  // ==========================================
  unifiedAssignments = computed(() => {
    const invRows = this.inventoryAssignments().map((t: any) => ({
      source: 'INVENTORY',
      key: `I${t.id}`,
      id: t.id,
      itemName: t.item?.name || '-',
      category: t.item?.category || '',
      unit: t.item?.unit || 'units',
      quantity: Number(t.quantity ?? 0),
      returnedQty: (t.linkedReturns || []).reduce((s: number, r: any) => s + (r.quantity || 0), 0),
      outstanding: this.outstandingOf(t),
      lastCondition: (t.linkedReturns || []).map((r: any) => r.conditionOnReturn).filter((c: any) => !!c).slice(-1)[0] || null,
      employee: t.employee || null,
      assignedDate: t.date,
      expectedReturnDate: t.expectedReturnDate || null,
      purpose: t.purpose || t.assigneeText || '',
      status: this.outstandingOf(t) > 0 ? 'ACTIVE' : 'RETURNED'
    }));
    const legacyRows = this.assignments().map(a => ({
      source: 'ASSET',
      key: `A${a.id}`,
      id: a.id,
      itemAsset: a.asset,
      employee: a.employee || null,
      assignedDate: a.assignedDate,
      returnDate: a.returnDate || null,
      conditionOnAssign: a.conditionOnAssign,
      notes: a.notes,
      outstanding: 0,
      quantity: 1,
      returnedQty: 0,
      lastCondition: null,
      status: a.status
    }));
    return [...invRows, ...legacyRows].sort(
      (a, b) => new Date(b.assignedDate).getTime() - new Date(a.assignedDate).getTime()
    );
  });

  asgActiveCount = computed(() => this.unifiedAssignments().filter(r => r.status === 'ACTIVE').length);
  asgUnitsOut = computed(() =>
    this.unifiedAssignments()
      .filter(r => r.source === 'INVENTORY' && r.status === 'ACTIVE')
      .reduce((s, r) => s + (Number(r.outstanding) || 0), 0)
  );
  asgDevicesOut = computed(() => this.unifiedAssignments().filter(r => r.source === 'ASSET' && r.status === 'ACTIVE').length);
  asgOverdueCount = computed(() => this.unifiedAssignments().filter(r => this.isOverdueRow(r)).length);

  isOverdueRow(r: any): boolean {
    if (!r || r.status !== 'ACTIVE' || r.source !== 'INVENTORY' || !r.expectedReturnDate) return false;
    const due = new Date(r.expectedReturnDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return !isNaN(due.getTime()) && due.getTime() < today.getTime();
  }

  assignmentQuery = signal('');
  reqQuery = signal('');

  asgRowHeight = (params: any): number => {
    const nameLen = String(params?.data?.itemName || params?.data?.itemAsset?.name || '').length;
    return nameLen > 34 ? 76 : 64;
  };

  onAssignmentRowClicked(event: any) {
    if (!event?.data) return;
    if (event.column?.getColId() === 'actions') return;
    if (event.data.source === 'INVENTORY') {
      const txn = this.inventoryAssignments().find((t: any) => t.id === event.data.id);
      if (txn) this.openTxnCheck(txn);
    }
  }

  assignmentsColDefs: ColDef[] = [
    {
      headerName: 'Item / Asset',
      field: 'itemName',
      flex: 1.6,
      minWidth: 200,
      cellRenderer: (params: any) => {
        const d = params.data;
        if (!d) return '-';
        if (d.source === 'INVENTORY') {
          const catClass = getCategoryClass(d.category);
          const unitWord = d.unit || 'units';
          return `
            <div class="cell-stacked">
              <div class="cell-title-bold">${d.itemName}</div>
              <div class="cell-subtitle-row">
                <span class="tag-mono">${d.outstanding ?? 0} of ${d.quantity ?? 0} ${unitWord} out</span>
                ${d.category ? `<span class="cat-badge ${catClass}">${d.category}</span>` : ''}
              </div>
            </div>
          `;
        }
        const a = d.itemAsset;
        if (!a) return '-';
        const catClass = getCategoryClass(a.category || '');
        return `
          <div class="cell-stacked">
            <div class="cell-title-bold">${a.name}</div>
            <div class="cell-subtitle-row">
              <span class="tag-mono">${a.assetTag}</span>
              ${a.category ? `<span class="cat-badge ${catClass}">${a.category}</span>` : ''}
            </div>
          </div>
        `;
      }
    },
    {
      headerName: 'Assigned Employee',
      field: 'employee',
      flex: 1.4,
      minWidth: 190,
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return '-';
        const initial = emp.firstName ? emp.firstName.charAt(0).toUpperCase() : 'U';
        const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.trim();
        const dept = emp.department?.name || 'Employee';
        const avatarUrl = emp.avatarUrl || emp.user?.avatarUrl;

        const avatarHtml = avatarUrl
          ? `<img src="${avatarUrl}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #E2E8F0;" />`
          : `<div class="avatar-circle-sm">${initial}</div>`;

        return `
          <div class="cell-user-avatar-row">
            ${avatarHtml}
            <div class="user-text-stack">
              <div class="cell-title-bold">${fullName}</div>
              <div class="user-dept">${dept}</div>
            </div>
          </div>
        `;
      }
    },
    {
      headerName: 'Assigned Date',
      field: 'assignedDate',
      flex: 1,
      minWidth: 120,
      valueGetter: (p: any) => p.data?.assignedDate || '',
      cellRenderer: (params: any) => this.fmtDate(params.value)
    },
    {
      headerName: 'Qty',
      field: 'quantity',
      flex: 0.7,
      minWidth: 80,
      type: 'rightAligned',
      valueGetter: (p: any) => {
        const d = p.data;
        if (!d) return '';
        return d.source === 'INVENTORY'
          ? `${Number(d.outstanding ?? 0)}/${Number(d.quantity ?? 0)}`
          : '1';
      }
    },
    {
      headerName: 'Condition',
      field: 'conditionOnAssign',
      flex: 0.9,
      minWidth: 110,
      cellRenderer: (params: any) => {
        const d = params.data;
        if (!d) return '-';
        const cond = d.source === 'INVENTORY' ? d.lastCondition : d.conditionOnAssign;
        if (!cond) return '<span style="color:#CBD5E1;font-size:12px;">&#8212;</span>';
        const condClass = getConditionClass(cond);
        return `<span class="badge-condition ${condClass}">${String(cond).replace(/_/g, ' ')}</span>`;
      }
    },
    {
      headerName: 'Return / Expected',
      field: 'expectedReturnDate',
      flex: 1.15,
      minWidth: 130,
      valueGetter: (p: any) => {
        const d = p.data;
        if (!d) return '';
        return d.source === 'INVENTORY' ? (d.expectedReturnDate || '') : (d.returnDate || '');
      },
      cellRenderer: (params: any) => {
        const d = params.data;
        if (!params.value && d?.status !== 'ACTIVE') return '<span style="color:#94A3B8;font-size:12px;">-</span>';
        if (!params.value) return '<span style="color:#94A3B8;font-size:12px;">No due date</span>';
        const overdue = this.isOverdueRow(d);
        const dateHtml = this.fmtDate(params.value);
        return overdue
          ? `<div class="due-stack"><span>${dateHtml}</span><span class="badge-overdue-mini">OVERDUE</span></div>`
          : dateHtml;
      }
    },
    {
      headerName: 'Status',
      field: 'status',
      flex: 1,
      minWidth: 118,
      cellRenderer: (params: any) => {
        const d = params.data || {};
        const active = d.status === 'ACTIVE';
        const overdue = this.isOverdueRow(d);
        const statusClass = overdue ? 'status-overdue' : (active ? 'status-assigned' : 'status-returned');
        const label = overdue ? 'OVERDUE' : (active ? 'ASSIGNED' : 'RETURNED');
        let extra = '';
        if (d.source === 'INVENTORY' && Number(d.returnedQty) > 0) {
          extra = `<div class="ret-mini">${d.returnedQty} returned</div>`;
        }
        return `
          <div>
            <span class="status-round ${statusClass}">
              <span class="status-dot"></span>
              ${label}
            </span>
            ${extra}
          </div>
        `;
      }
    },
    {
      headerName: 'Actions',
      field: 'actions',
      width: 90,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: AssetActionCellRendererComponent,
      cellRendererParams: {
        onReturn: (row: any) => {
          if (row.status !== 'ACTIVE' || !this.isAdmin()) return;
          if (row.source === 'INVENTORY') {
            const txn = this.inventoryAssignments().find((t: any) => t.id === row.id);
            if (txn) this.openInvReturnModal(txn);
          } else {
            this.openReturnModal(row.id);
          }
        },
        canReturn: (row: any) => !!row && row.status === 'ACTIVE' && this.isAdmin()
      }
    }
  ];

  // AG Grid Hardware Requests Columns
  requestsColDefs: ColDef[] = [
    {
      headerName: 'Requested By',
      field: 'employee',
      valueFormatter: (p) => p.value ? (p.value.lastName ? `${p.value.firstName} ${p.value.lastName}` : p.value.firstName) : '',
      flex: 1.4,
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return '-';
        const initial = emp.firstName ? emp.firstName.charAt(0).toUpperCase() : 'U';
        const avatarUrl = emp.avatarUrl || emp.user?.avatarUrl;

        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #E2E8F0;" />`
            : `<div class="avatar-circle-sm">${initial}</div>`;

        return `
          <div class="cell-user-avatar-row">
            ${avatarHtml}
            <div class="user-text-stack">
              <div class="cell-title-bold">${emp.firstName} ${emp.lastName}</div>
              <div class="user-dept">${emp.department?.name || 'Employee'}</div>
            </div>
          </div>
        `;
      }
    },
    {
      headerName: 'Request Details & Category',
      field: 'reason',
      flex: 1.6,
      cellRenderer: (params: any) => {
        if (!params.data) return '-';
        const catClass = getCategoryClass(params.data.category);
        return `
          <div class="cell-stacked">
            <div class="cell-title-bold">${params.data.reason || 'Hardware Request'}</div>
            <div class="cell-subtitle-row">
              <span class="cat-badge ${catClass}">${params.data.category}</span>
              <span>${params.data.requestType || 'NEW DEVICE'}</span>
            </div>
          </div>
        `;
      }
    },
    {
      headerName: 'Urgency',
      field: 'urgency',
      flex: 0.9,
      cellRenderer: (params: any) => {
        const u = params.value || 'MEDIUM';
        const urgencyClass = getUrgencyClass(u);
        return `<span class="badge-condition ${urgencyClass}">${u}</span>`;
      }
    },
    {
      headerName: 'Attachments',
      field: 'images',
      flex: 1.1,
      minWidth: 130,
      cellRenderer: (params: any) => {
        let imgs: string[] = [];
        if (params.value) {
          try {
            imgs = typeof params.value === 'string' ? JSON.parse(params.value) : params.value;
          } catch (e) { imgs = []; }
        }
        if (!imgs || imgs.length === 0) return '<span style="color: #94A3B8; font-size: 12px;">No photos</span>';

        return `
          <div class="cell-user-avatar-row" style="cursor: pointer;" title="Click to view full photos">
            <img src="${imgs[0]}" style="width: 30px; height: 30px; border-radius: 6px; object-fit: cover; border: 1px solid #CBD5E1;" />
            <span style="font-size: 11px; font-weight: 600; color: #2563EB;">${imgs.length} photo(s)</span>
          </div>
        `;
      },
      onCellClicked: (params: any) => {
        let imgs: string[] = [];
        if (params.value) {
          try {
            imgs = typeof params.value === 'string' ? JSON.parse(params.value) : params.value;
          } catch (e) { imgs = []; }
        }
        if (imgs && imgs.length > 0) {
          this.openImageViewer(imgs, 0);
        }
      }
    },
    {
      headerName: 'Submitted Date',
      field: 'createdAt',
      flex: 1,
      valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
    },
    {
      headerName: 'Status',
      field: 'status',
      flex: 1.2,
      cellRenderer: (params: any) => {
        const s = params.value || 'PENDING';
        const statusClass = getStatusClass(s);
        const reasonHtml = s === 'REJECTED' && params.data?.rejectionReason
          ? `<div style="font-size: 10px; color: #DC2626; font-weight: 500; line-height: 1.2; margin-top: 3px;" title="${params.data.rejectionReason}">Reason: ${params.data.rejectionReason}</div>`
          : '';
        return `
          <div class="cell-stacked">
            <span class="status-round ${statusClass}">
              <span class="status-dot"></span>
              ${s}
            </span>
            ${reasonHtml}
          </div>
        `;
      }
    },
    {
      headerName: 'Actions',
      field: 'actions',
      width: 90,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: AssetActionCellRendererComponent,
      cellRendererParams: {
        editLabel: 'Edit Request',
        canEdit: (data: HardwareRequest) => data.status === 'PENDING' && (this.isSelfRequest(data) || this.isSuperAdmin()),
        onEdit: (data: HardwareRequest) => this.openEditRequestDrawer(data),
        canCancel: (data: HardwareRequest) => data.status === 'PENDING' && this.isSelfRequest(data),
        onCancel: (data: HardwareRequest) => this.cancelRequest(data.id),
        canApprove: (data: HardwareRequest) => data.status === 'PENDING' && this.isAdmin() && (!this.isSelfRequest(data) || this.isSuperAdmin()),
        onApprove: (data: HardwareRequest) => {
          if (data.status === 'PENDING' && this.isAdmin()) {
            this.openFulfillModal(data.id);
          }
        },
        canReject: (data: HardwareRequest) => data.status === 'PENDING' && this.isAdmin() && (!this.isSelfRequest(data) || this.isSuperAdmin()),
        onReject: (data: HardwareRequest) => {
          if (data.status === 'PENDING' && this.isAdmin()) {
            this.openRejectModal(data.id);
          }
        }
      }
    }
  ];

  ngOnInit() {
    const setUserAndLoadPerms = (user: any) => {
      this.currentUser.set(user);
      if (!this.isAdmin()) {
        // Non-admin roles: check which sub-tabs are permitted
        this.permissionsService.getAllPermissions(user?.role || 'EMPLOYEE').subscribe(perms => {
          const has = (mod: string) => perms.some(p => p.module === mod && (p.action === 'VIEW' || p.action === 'MANAGE'));
          this.canViewInventory.set(has('assets/inventory'));
          this.canViewAssignments.set(has('assets/assignments'));
          this.canViewRequests.set(has('assets/requests'));

          // Redirect away from the active tab if it's now forbidden
          const active = this.activeTab();
          if (active === 'inventory' && !this.canViewInventory()) {
            const fallback = this.canViewAssignments() ? 'assignments' : this.canViewRequests() ? 'requests' : null;
            if (fallback) this.setTab(fallback as any);
          } else if (active === 'assignments' && !this.canViewAssignments()) {
            const fallback = this.canViewInventory() ? 'inventory' : this.canViewRequests() ? 'requests' : null;
            if (fallback) this.setTab(fallback as any);
          }
        });
      }
    };

    const user = this.authService.currentUser();
    if (user) {
      setUserAndLoadPerms(user);
    } else {
      this.authService.getMe().subscribe(u => setUserAndLoadPerms(u));
    }

    this.route.params.subscribe(params => {
      if (params['tab']) {
        this.activeTab.set(params['tab'] as 'inventory' | 'assignments' | 'requests');
      }
    });

    this.loadAllData();
  }

  setTab(tab: 'inventory' | 'assignments' | 'requests') {
    this.activeTab.set(tab);
    this.router.navigate(['/assets', tab]);
  }

  loadAllData() {
    this.loadInventory();
    this.assetService.getAllAssets().subscribe(res => this.assets.set(res));
    this.assetService.getAssignments().subscribe(res => this.assignments.set(res));
    this.assetService.getInventoryAssignments().subscribe(res => this.inventoryAssignments.set(res));
    this.assetService.getHardwareRequests().subscribe(res => this.requests.set(res));
    this.employeeService.getEmployeesBasicList().subscribe(res => this.employees.set(res));
    this.assetService.getCategories().subscribe(res => this.customCategories.set(res || []));
  }

  onCategorySelected(value: string | null) {
    if (value === ADD_NEW_CATEGORY_ID) {
      this.newCategoryName.set('');
      this.isAddCategoryModalOpen.set(true);
      return;
    }
    if (!value) return; // category is required; ignore the select's clear option
    this.assetForm.category = value;
  }

  confirmAddCategory() {
    const name = this.newCategoryName().trim();
    if (!name) {
      this.toast.error('Please enter a category name');
      return;
    }
    const code = name.toUpperCase();
    this.assetForm.category = code;
    if (!this.customCategories().includes(code) && !this.standardCategories.some(s => s.id === code)) {
      this.customCategories.update(list => [...list, code]);
    }
    this.isAddCategoryModalOpen.set(false);
  }

  // 1. Asset Drawer Actions
  openAddAssetDrawer() {
    this.assetForm = {
      id: 0,
      assetTag: '',
      name: '',
      category: 'LAPTOP',
      quantity: 1,
      brand: '',
      model: '',
      serialNumber: '',
      purchaseDate: new Date().toISOString().split('T')[0],
      cost: 0,
      warrantyExpiry: '',
      images: [],
      location: '',
      notes: '',
      tags: [],
      status: 'AVAILABLE',
      ram: '',
      storage: '',
      processor: ''
    };
    this.tagInput = '';
    this.assetFormErrors = {};
    this.isAssetDrawerOpen.set(true);
  }

  openEditAssetDrawer(asset: Asset) {
    let tags: string[] = [];
    if (asset.tags) {
      try {
        tags = typeof asset.tags === 'string' ? JSON.parse(asset.tags) : asset.tags;
      } catch (e) { tags = []; }
    }
    this.assetForm = {
      id: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      category: asset.category,
      quantity: asset.quantity ?? 1,
      brand: asset.brand || '',
      model: asset.model || '',
      serialNumber: asset.serialNumber || '',
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.split('T')[0] : '',
      cost: asset.cost || 0,
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.split('T')[0] : '',
      images: asset.images ? [...asset.images] : [],
      location: asset.location || '',
      notes: asset.notes || '',
      tags: tags,
      status: asset.status,
      ram: asset.ram || '',
      storage: asset.storage || '',
      processor: asset.processor || ''
    };
    this.tagInput = '';
    this.assetFormErrors = {};
    this.isAssetDrawerOpen.set(true);
  }

  addTag() {
    const value = this.tagInput.trim();
    if (!value) return;
    if (!this.assetForm.tags.includes(value)) {
      this.assetForm.tags.push(value);
    }
    this.tagInput = '';
  }

  removeTag(index: number) {
    this.assetForm.tags.splice(index, 1);
  }

  onFileSelected(event: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;

    if (files.length > this.maxUploadFiles) {
      this.toast.error(`You can upload a maximum of ${this.maxUploadFiles} images at a time. Please remove ${files.length - this.maxUploadFiles} file(s) and try again.`);
      event.target.value = '';
      return;
    }

    Array.from(files).forEach(file => {
      if (file.size > this.maxUploadFileSizeBytes) {
        this.toast.error(`"${file.name}" is too large (${this.formatFileSize(file.size)}). Maximum allowed size is ${this.maxUploadFileSizeMb}MB.`);
        return;
      }

      this.uploadService.uploadFile(file).subscribe({
        next: (res) => {
          if (res?.url) {
            this.assetForm.images.push(res.url);
            this.toast.success(`Image uploaded`);
          }
        },
        error: (err) => this.toast.error(this.getUploadErrorMessage(err, file.name))
      });
    });
    event.target.value = '';
  }

  loadInventory() {
    this.inventoryLoading.set(true);
    this.assetService.getInventoryItems().subscribe({
      next: res => {
        this.inventoryItems.set(res);
        this.inventoryLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load inventory');
        this.inventoryLoading.set(false);
      }
    });
  }

  private formatFileSize(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${Math.ceil(bytes / 1024)}KB`;
  }

  private getUploadErrorMessage(err: any, fileName: string): string {
    if (err?.status === 0) {
      return `Failed to upload "${fileName}": network error. Check your connection and try again.`;
    }
    if (err?.status === 413) {
      return `"${fileName}" is too large. Maximum allowed size is ${this.maxUploadFileSizeMb}MB.`;
    }
    const backendMessage = err?.error?.message;
    if (backendMessage) {
      return `Failed to upload "${fileName}": ${Array.isArray(backendMessage) ? backendMessage.join(', ') : backendMessage}`;
    }
    return `Failed to upload "${fileName}". Please try again.`;
  }

  /** Reload inventory list + refresh detail modal if open */
  refreshInventoryData() {
    this.loadInventory();
    const openId = this.detailItemId();
    if (openId != null) {
      this.loadItemTransactions(openId);
    }
    this.assetService.getInventoryAssignments().subscribe(res => this.inventoryAssignments.set(res));
  }

  removeImage(index: number) {
    this.assetForm.images.splice(index, 1);
  }

  saveAsset() {
    this.validateAssetForm();
    if (Object.keys(this.assetFormErrors).length > 0) {
      this.toast.error('Please fix the highlighted fields below.');
      this.focusFirstAssetError();
      return;
    }
    if (this.isSaving) return;
    this.isSaving = true;

    if (this.assetForm.id > 0) {
      this.assetService.updateAsset(this.assetForm.id, this.assetForm).subscribe({
        next: () => {
          this.isSaving = false;
          this.toast.success('Asset updated successfully');
          this.isAssetDrawerOpen.set(false);
          this.loadAllData();
        },
        error: (err) => {
          this.isSaving = false;
          this.toast.error(err.error?.message || 'Failed to update asset');
        }
      });
    } else {
      this.assetService.createAsset(this.assetForm).subscribe({
        next: () => {
          this.isSaving = false;
          this.toast.success('Asset created successfully');
          this.isAssetDrawerOpen.set(false);
          this.loadAllData();
        },
        error: (err) => {
          this.isSaving = false;
          this.toast.error(err.error?.message || 'Failed to create asset');
        }
      });
    }
  }

  // ==========================================
  // ITEM DETAIL MODAL
  // ==========================================
  openItemDetail(itemId: number) {
    this.detailItemId.set(itemId);
    this.detailTab.set('ALL');
    this.isItemDetailOpen.set(true);
    this.loadItemTransactions(itemId);
  }

  loadItemTransactions(itemId: number) {
    this.detailLoading.set(true);
    this.assetService.getInventoryTransactions(itemId).subscribe({
      next: res => {
        this.detailTxns.set(res);
        this.detailLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load transaction history');
        this.detailLoading.set(false);
      }
    });
  }

  closeItemDetail() {
    this.isItemDetailOpen.set(false);
    this.detailItemId.set(null);
    this.detailTxns.set([]);
  }

  openDetailThenAssign(itemId: number) {
    this.openItemDetail(itemId);
    setTimeout(() => this.openInvAssignModal(), 50);
  }

  // ==========================================
  // ADD / EDIT INVENTORY ITEM
  // ==========================================
  openAddItemModal() {
    this.invItemForm = this.emptyItemForm();
    this.isInvItemFormOpen.set(true);
  }

  openEditItemModal(item: InventoryItem) {
    this.invItemForm = {
      id: item.id,
      name: item.name,
      category: item.category,
      itemType: item.itemType,
      brand: item.brand || '',
      unit: item.unit || 'units',
      quantity: item.quantity,
      unitCost: item.unitCost,
      purchaseDate: item.purchaseDate ? new Date(item.purchaseDate).toISOString().split('T')[0] : '',
      supplier: item.supplier || '',
      batchNumber: item.batchNumber || '',
      expiryDate: item.expiryDate ? new Date(item.expiryDate).toISOString().split('T')[0] : '',
      location: item.location || '',
      model: item.model || '',
      serialNumber: item.serialNumber || '',
      warrantyExpiry: item.warrantyExpiry ? new Date(item.warrantyExpiry).toISOString().split('T')[0] : '',
      notes: item.notes || ''
    };
    this.isInvItemFormOpen.set(true);
  }

  saveInventoryItem() {
    const f = this.invItemForm;
    if (!f.name || !String(f.name).trim()) {
      this.toast.error('Item name is required');
      return;
    }
    if (f.id == null && (f.quantity == null || Number(f.quantity) < 0 || !Number.isInteger(Number(f.quantity)))) {
      return;
    }

    const payload: any = {
      name: f.name.trim(),
      category: f.category,
      itemType: f.itemType,
      brand: f.brand,
      unit: f.unit,
      unitCost: f.unitCost,
      purchaseDate: f.purchaseDate || null,
      supplier: f.supplier,
      batchNumber: f.batchNumber,
      expiryDate: f.showExpiry === false ? null : (f.expiryDate || null),
      location: f.location,
      model: this.isItCategory ? f.model : null,
      serialNumber: this.isItCategory ? f.serialNumber : null,
      warrantyExpiry: this.isItCategory ? (f.warrantyExpiry || null) : null,
      notes: f.notes
    };

    this.savingItem.set(true);
    if (f.id != null) {
      delete payload.quantity;
      this.assetService.updateInventoryItem(f.id, payload).subscribe({
        next: () => {
          this.toast.success('Item updated successfully');
          this.savingItem.set(false);
          this.isInvItemFormOpen.set(false);
          this.refreshInventoryData();
        },
        error: (err) => {
          this.toast.error(err.error?.message || 'Failed to update item');
          this.savingItem.set(false);
        }
      });
    } else {
      payload.quantity = Number(f.quantity);
      this.assetService.createInventoryItem(payload).subscribe({
        next: () => {
          this.toast.success('Item added to inventory');
          this.savingItem.set(false);
          this.isInvItemFormOpen.set(false);
          this.refreshInventoryData();
        },
        error: (err) => {
          this.toast.error(err.error?.message || 'Failed to create item');
          this.savingItem.set(false);
        }
      });
    }
  }

  private validateAssetForm() {
    this.assetFormErrors = {};

    if (!this.assetForm.name?.trim()) {
      this.assetFormErrors.name = 'Asset name is required.';
    }

    const qty = Number(this.assetForm.quantity);
    if (this.assetForm.quantity == null || isNaN(qty) || qty < 1) {
      this.assetFormErrors.quantity = 'Quantity must be at least 1.';
    }

    const cost = Number(this.assetForm.cost);
    if (!isNaN(cost) && cost < 0) {
      this.assetFormErrors.cost = 'Cost cannot be negative.';
    }
  }

  clearAssetError(field: keyof AssetFormErrors) {
    if (this.assetFormErrors[field]) {
      delete this.assetFormErrors[field];
    }
  }

  private focusFirstAssetError() {
    const order: (keyof AssetFormErrors)[] = ['name', 'quantity', 'cost'];
    const first = order.find(k => !!this.assetFormErrors[k]);
    if (!first) return;

    setTimeout(() => {
      const el = document.getElementById(`asset-field-${first}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = el.querySelector('input, select, textarea') as HTMLElement | null;
        input?.focus({ preventScroll: true });
      }
    }, 60);
  }

  deleteAsset(asset: Asset) {
    if (asset.status === 'ASSIGNED') {
      this.toast.error('Deletion blocked due to active assignment. Must archive or return first.');
      return;
    }
    if (!confirm(`Are you sure you want to delete ${asset.name} from inventory?`)) return;
    this.assetService.deleteAsset(asset.id).subscribe({
      next: () => {
        this.toast.success('Asset deleted');
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to delete asset')
    });
  }

  deleteInventoryItem(item: InventoryItem) {
    if ((item.netAssigned || 0) > 0) {
      this.toast.error(`${item.netAssigned} unit(s) still assigned. Record returns before deleting.`);
      return;
    }
    if (!confirm(`Delete "${item.name}" and its full transaction history? This cannot be undone.`)) return;
    this.assetService.deleteInventoryItem(item.id).subscribe({
      next: () => {
        this.toast.success('Item deleted');
        if (this.detailItemId() === item.id) this.closeItemDetail();
        this.refreshInventoryData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to delete item')
    });
  }

  setItemStatus(item: InventoryItem, status: 'ACTIVE' | 'IN_REPAIR' | 'RETIRED') {
    this.assetService.setInventoryItemStatus(item.id, status).subscribe({
      next: () => {
        this.toast.success(status === 'IN_REPAIR' ? 'Marked under repair' : status === 'RETIRED' ? 'Item retired' : 'Item marked active');
        this.refreshInventoryData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update status')
    });
  }

  // ==========================================
  // ASSIGN UNITS (+ button)
  // ==========================================
  openInvAssignModal() {
    const item = this.selectedItem();
    if (!item) return;
    if (item.available <= 0) {
      this.toast.error(`No units of "${item.name}" available to assign`);
      return;
    }
    this.invAssignForm = {
      mode: 'EMPLOYEE',
      employeeId: null,
      assigneeText: '',
      quantity: null,
      date: new Date().toISOString().split('T')[0],
      expectedReturnDate: '',
      purpose: ''
    };
    this.invAssignError.set('');
    this.isInvAssignOpen.set(true);
  }

  submitInvAssign() {
    const item = this.selectedItem();
    if (!item) return;
    const f = this.invAssignForm;
    const qty = Number(f.quantity);

    if (!qty || qty < 1 || !Number.isInteger(qty)) {
      this.invAssignError.set('Enter a valid whole-number quantity');
      return;
    }
    if (qty > item.available) {
      this.invAssignError.set(`Cannot assign ${qty}: only ${item.available} of ${item.quantity} unit(s) available`);
      return;
    }
    if (f.mode === 'EMPLOYEE' && !f.employeeId) {
      this.invAssignError.set('Please select an employee');
      return;
    }
    if (f.mode === 'LOCATION' && !f.assigneeText?.trim()) {
      this.invAssignError.set('Please enter a person or location');
      return;
    }

    const payload: any = {
      quantity: qty,
      date: f.date || new Date().toISOString().split('T')[0],
      purpose: f.purpose
    };
    if (f.mode === 'EMPLOYEE') payload.employeeId = Number(f.employeeId);
    else payload.assigneeText = f.assigneeText.trim();

    if (item.itemType === 'CONSUMABLE') payload.expectedReturnDate = f.expectedReturnDate || null;
    else payload.expectedReturnDate = f.expectedReturnDate || null;

    this.invAssignSubmitting.set(true);
    this.assetService.assignInventoryItem(item.id, payload).subscribe({
      next: () => {
        this.toast.success(`${qty} unit(s) of "${item.name}" assigned`);
        this.invAssignSubmitting.set(false);
        this.isInvAssignOpen.set(false);
        this.refreshInventoryData();
      },
      error: (err) => {
        this.invAssignError.set(err.error?.message || 'Failed to assign');
        this.invAssignSubmitting.set(false);
      }
    });
  }

  // ==========================================
  // RETURN UNITS
  // ==========================================
  openInvReturnModal(txn: InventoryTransaction) {
    const max = this.outstandingOf(txn);
    if (max <= 0) {
      this.toast.info('This assignment has been fully returned');
      return;
    }
    this.invReturnTarget.set(txn);
    this.invReturnMax.set(max);
    this.invReturnForm = {
      quantity: max,
      returnDate: new Date().toISOString().split('T')[0],
      conditionOnReturn: 'GOOD',
      notes: ''
    };
    this.invReturnError.set('');
    this.isInvReturnOpen.set(true);
  }

  submitInvReturn() {
    const target = this.invReturnTarget();
    if (!target) return;
    const qty = Number(this.invReturnForm.quantity);

    if (!qty || qty < 1 || !Number.isInteger(qty)) {
      this.invReturnError.set('Enter a valid whole-number quantity');
      return;
    }
    if (qty > this.invReturnMax()) {
      this.invReturnError.set(`Only ${this.invReturnMax()} unit(s) are outstanding on this assignment`);
      return;
    }

    this.invReturnSubmitting.set(true);
    this.assetService.returnInventoryUnits(target.id, {
      quantity: qty,
      returnDate: this.invReturnForm.returnDate || new Date().toISOString().split('T')[0],
      conditionOnReturn: this.invReturnForm.conditionOnReturn,
      notes: this.invReturnForm.notes
    }).subscribe({
      next: () => {
        this.toast.success(`${qty} unit(s) returned to stock`);
        this.invReturnSubmitting.set(false);
        this.isInvReturnOpen.set(false);
        this.refreshInventoryData();
      },
      error: (err) => {
        this.invReturnError.set(err.error?.message || 'Failed to record return');
        this.invReturnSubmitting.set(false);
      }
    });
  }

  // ==========================================
  // CONSUME / EXPIRE / ADJUST
  // ==========================================
  openInvConsumeModal() {
    const item = this.selectedItem();
    if (!item) return;
    if (item.itemType !== 'CONSUMABLE') {
      this.toast.error('Consumption applies to consumable items only');
      return;
    }
    if (item.available <= 0) {
      this.toast.error('No units available to consume');
      return;
    }
    this.invConsumeForm = { quantity: null, date: new Date().toISOString().split('T')[0], purpose: '' };
    this.invConsumeError.set('');
    this.isInvConsumeOpen.set(true);
  }

  submitInvConsume() {
    const item = this.selectedItem();
    if (!item) return;
    const qty = Number(this.invConsumeForm.quantity);
    if (!qty || qty < 1 || !Number.isInteger(qty)) {
      this.invConsumeError.set('Enter a valid whole-number quantity');
      return;
    }
    if (qty > item.available) {
      this.invConsumeError.set(`Cannot consume ${qty}: only ${item.available} unit(s) available`);
      return;
    }

    this.invConsumeSubmitting.set(true);
    this.assetService.consumeInventoryItem(item.id, {
      quantity: qty,
      date: this.invConsumeForm.date,
      purpose: this.invConsumeForm.purpose
    }).subscribe({
      next: () => {
        this.toast.success(`${qty} unit(s) recorded as consumed`);
        this.invConsumeSubmitting.set(false);
        this.isInvConsumeOpen.set(false);
        this.refreshInventoryData();
      },
      error: (err) => {
        this.invConsumeError.set(err.error?.message || 'Failed to record consumption');
        this.invConsumeSubmitting.set(false);
      }
    });
  }

  openInvExpireModal() {
    const item = this.selectedItem();
    if (!item) return;
    if (item.available <= 0) {
      this.toast.error('No units available to mark expired');
      return;
    }
    this.invExpireForm = {
      quantity: item.available,
      date: new Date().toISOString().split('T')[0],
      reason: ''
    };
    this.invExpireError.set('');
    this.isInvExpireOpen.set(true);
  }

  submitInvExpire() {
    const item = this.selectedItem();
    if (!item) return;
    const qty = Number(this.invExpireForm.quantity);
    if (!qty || qty < 1 || !Number.isInteger(qty)) {
      this.invExpireError.set('Enter a valid whole-number quantity');
      return;
    }
    if (qty > item.available) {
      this.invExpireError.set(`Only ${item.available} unit(s) available`);
      return;
    }

    this.invExpireSubmitting.set(true);
    this.assetService.expireInventoryItem(item.id, {
      quantity: qty,
      date: this.invExpireForm.date,
      reason: this.invExpireForm.reason
    }).subscribe({
      next: () => {
        this.toast.success(`${qty} unit(s) marked as expired`);
        this.invExpireSubmitting.set(false);
        this.isInvExpireOpen.set(false);
        this.refreshInventoryData();
      },
      error: (err) => {
        this.invExpireError.set(err.error?.message || 'Failed to record expiry');
        this.invExpireSubmitting.set(false);
      }
    });
  }

  openInvAdjustModal() {
    const item = this.selectedItem();
    if (!item) return;
    this.invAdjustForm = { delta: null, reason: '' };
    this.invAdjustError.set('');
    this.isInvAdjustOpen.set(true);
  }

  submitInvAdjust() {
    const item = this.selectedItem();
    if (!item) return;
    const delta = Number(this.invAdjustForm.delta);
    if (!delta || !Number.isInteger(delta)) {
      this.invAdjustError.set('Enter a non-zero whole number (use minus for removal)');
      return;
    }
    if (delta < 0 && Math.abs(delta) > item.available) {
      this.invAdjustError.set(`Only ${item.available} unit(s) available to remove`);
      return;
    }

    this.invAdjustSubmitting.set(true);
    this.assetService.adjustInventoryStock(item.id, {
      delta,
      reason: this.invAdjustForm.reason
    }).subscribe({
      next: () => {
        this.toast.success(`Stock adjusted by ${delta > 0 ? '+' : ''}${delta}`);
        this.invAdjustSubmitting.set(false);
        this.isInvAdjustOpen.set(false);
        this.refreshInventoryData();
      },
      error: (err) => {
        this.invAdjustError.set(err.error?.message || 'Failed to adjust stock');
        this.invAdjustSubmitting.set(false);
      }
    });
  }

  // ==========================================
  // CSV IMPORT
  // ==========================================
  onImportFileSelected(event: any) {
    const file: File = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      this.toast.error('Please upload a .csv file');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = this.parseCsvText(String(reader.result || ''));
        if (rows.length === 0) {
          this.toast.error('No valid rows found. Use the template format.');
          return;
        }
        this.importing.set(true);
        this.assetService.importInventoryItems(rows).subscribe({
          next: (res) => {
            this.importing.set(false);
            if (res.created > 0) {
              this.toast.success(`Imported ${res.created} item(s)` + (res.failed ? `, ${res.failed} failed` : ''));
            } else {
              this.toast.error(`Import failed for all ${res.failed} row(s)`);
            }
            if (res.errors?.length) {
              console.warn('Import errors:', res.errors);
            }
            this.refreshInventoryData();
          },
          error: (err) => {
            this.importing.set(false);
            this.toast.error(err.error?.message || 'Import failed');
          }
        });
      } catch (e) {
        this.toast.error('Could not read the CSV file');
      }
    };
    reader.readAsText(file);
  }

  downloadImportTemplate() {
    const csv = [
      'name,brand,category,item_type,unit,quantity,unit_cost,purchase_date,supplier,batch_number,expiry_date,location,notes',
      'Parle Monaco Biscuit,Parle,PANTRY,CONSUMABLE,packets,10,50,2026-08-20,Metro Store,BATCH-001,2026-11-20,Pantry - Ground Floor,Sample row - delete before import',
      'Dell Latitude 5440,Dell,LAPTOP,ASSET,units,2,65000,2026-07-15,Computer Depot,,,IT Storage Room,'
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'inventory_import_template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private parseCsvText(text: string): any[] {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) return [];

    const parseLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = '';
      let inQ = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = false;
          } else cur += ch;
        } else {
          if (ch === '"') inQ = true;
          else if (ch === ',') { out.push(cur); cur = ''; }
          else cur += ch;
        }
      }
      out.push(cur);
      return out.map(s => s.trim());
    };

    const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''));
    const idx = (...names: string[]) => headers.findIndex(h => names.includes(h));

    const iName = idx('name', 'itemname', 'item');
    if (iName === -1) throw new Error('Missing "name" column');

    const map = {
      brand: idx('brand'),
      category: idx('category'),
      itemType: idx('itemtype', 'type'),
      unit: idx('unit', 'units'),
      quantity: idx('quantity', 'qty'),
      unitCost: idx('unitcost', 'cost', 'price'),
      purchaseDate: idx('purchasedate', 'date'),
      supplier: idx('supplier', 'vendor'),
      batchNumber: idx('batchnumber', 'batch'),
      expiryDate: idx('expirydate', 'expiry'),
      location: idx('location', 'storage'),
      notes: idx('notes')
    };

    const normCat = (v: string): string => {
      const up = (v || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
      const found = this.categories.find(c => c.value === up);
      if (found) return found.value;
      const alias: any = {
        'PANTRY_ITEMS': 'PANTRY', 'PANTRY_ITEM': 'PANTRY',
        'KEYBOARD_MOUSE': 'PERIPHERAL', 'MOBILE_TABLET': 'MOBILE',
        'LAPTOPS': 'LAPTOP', 'PRINTERS': 'PRINTER', 'MONITORS': 'MONITOR'
      };
      return alias[up] || 'OTHER';
    };

    const toDate = (v: string): string | null => {
      if (!v) return null;
      const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      const dmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(v);
      if (dmy) {
        const mm = dmy[2].padStart(2, '0'), dd = dmy[1].padStart(2, '0');
        return `${dmy[3]}-${mm}-${dd}`;
      }
      return null;
    };

    const rows: any[] = [];
    for (let r = 1; r < lines.length; r++) {
      const cells = parseLine(lines[r]);
      const name = cells[iName];
      if (!name) continue;
      const get = (i: number) => (i >= 0 ? cells[i] : '');
      const category = normCat(get(map.category));
      const autoType = CONSUMABLE_CATEGORIES.includes(category)
        ? 'CONSUMABLE'
        : (IT_CATEGORIES.includes(category) || category === 'FURNITURE') ? 'ASSET' : 'CONSUMABLE';
      const itRaw = get(map.itemType).toUpperCase();

      rows.push({
        name,
        brand: get(map.brand) || null,
        category,
        itemType: itRaw === 'ASSET' || itRaw === 'CONSUMABLE' ? itRaw : autoType,
        unit: get(map.unit) || (autoType === 'ASSET' ? 'units' : 'packets'),
        quantity: parseInt(get(map.quantity), 10) || 0,
        unitCost: parseFloat(get(map.unitCost)) || 0,
        purchaseDate: toDate(get(map.purchaseDate)),
        supplier: get(map.supplier) || null,
        batchNumber: get(map.batchNumber) || null,
        expiryDate: toDate(get(map.expiryDate)),
        location: get(map.location) || null,
        notes: get(map.notes) || null
      });
    }
    return rows;
  }

  // ==========================================
  // LEGACY: Assignment Drawer Actions (serial assets via hardware fulfillment)
  // ==========================================
  openAssignDrawer(assetId?: number) {
    this.assignForm = {
      assetId: assetId || (this.availableAssets()[0]?.id || 0),
      employeeId: this.employees()[0]?.id || 0,
      assignedDate: new Date().toISOString().split('T')[0],
      conditionOnAssign: 'GOOD',
      notes: ''
    };
    this.isAssignDrawerOpen.set(true);
  }

  submitAssign() {
    if (!this.assignForm.assetId || !this.assignForm.employeeId) {
      this.toast.error('Please select both an Asset and an Employee');
      return;
    }

    this.assetService.assignAsset(this.assignForm).subscribe({
      next: () => {
        this.toast.success('Asset assigned successfully');
        this.isAssignDrawerOpen.set(false);
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to assign asset')
    });
  }

  openReturnModal(assignmentId: number) {
    this.returnForm = {
      assignmentId,
      returnDate: new Date().toISOString().split('T')[0],
      conditionOnReturn: 'GOOD',
      assetNextStatus: 'AVAILABLE',
      notes: ''
    };
    this.isReturnModalOpen.set(true);
  }

  submitReturn() {
    this.assetService.returnAsset(this.returnForm.assignmentId, this.returnForm).subscribe({
      next: () => {
        this.toast.success('Asset returned to stock');
        this.isReturnModalOpen.set(false);
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to return asset')
    });
  }

  // ==========================================
  // Image Viewer Lightbox Methods
  // ==========================================
  openImageViewer(images: string[], index = 0) {
    if (!images || images.length === 0) return;
    this.previewImages.set(images);
    this.activeImageIndex.set(index);
  }

  closeImageViewer() {
    this.previewImages.set([]);
    this.activeImageIndex.set(0);
  }

  prevImage() {
    if (this.activeImageIndex() > 0) {
      this.activeImageIndex.update(i => i - 1);
    }
  }

  nextImage() {
    if (this.activeImageIndex() < this.previewImages().length - 1) {
      this.activeImageIndex.update(i => i + 1);
    }
  }

  // ==========================================
  // Hardware Request Actions
  // ==========================================
  openRequestDrawer() {
    this.editingRequestId.set(null);
    this.requestForm = {
      requestType: 'NEW_DEVICE',
      category: 'LAPTOP',
      urgency: 'MEDIUM',
      reason: '',
      images: []
    };
    this.isRequestDrawerOpen.set(true);
  }

  openEditRequestDrawer(data: HardwareRequest) {
    this.editingRequestId.set(data.id);
    let imgs: string[] = [];
    if (data.images) {
      try {
        imgs = typeof data.images === 'string' ? JSON.parse(data.images) : data.images;
      } catch (e) { imgs = []; }
    }
    this.requestForm = {
      requestType: data.requestType || 'NEW_DEVICE',
      category: data.category || 'LAPTOP',
      urgency: data.urgency || 'MEDIUM',
      reason: data.reason || '',
      images: [...imgs]
    };
    this.isRequestDrawerOpen.set(true);
  }

  cancelRequest(requestId: number) {
    if (!confirm('Are you sure you want to cancel this hardware request?')) return;

    this.assetService.cancelHardwareRequest(requestId).subscribe({
      next: () => {
        this.toast.success('Hardware request cancelled');
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to cancel request')
    });
  }

  onRequestFileSelected(event: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;

    if (files.length > this.maxUploadFiles) {
      this.toast.error(`You can upload a maximum of ${this.maxUploadFiles} attachments at a time. Please remove ${files.length - this.maxUploadFiles} file(s) and try again.`);
      event.target.value = '';
      return;
    }

    Array.from(files).forEach(file => {
      if (file.size > this.maxUploadFileSizeBytes) {
        this.toast.error(`"${file.name}" is too large (${this.formatFileSize(file.size)}). Maximum allowed size is ${this.maxUploadFileSizeMb}MB.`);
        return;
      }

      this.uploadService.uploadFile(file).subscribe({
        next: (res) => {
          if (res?.url) {
            this.requestForm.images.push(res.url);
            this.toast.success('Attachment uploaded');
          }
        },
        error: (err) => this.toast.error(this.getUploadErrorMessage(err, file.name))
      });
    });
    event.target.value = '';
  }

  removeRequestImage(index: number) {
    this.requestForm.images.splice(index, 1);
  }

  submitRequest() {
    if (!this.requestForm.reason) {
      this.toast.error('Please provide a reason for the hardware request');
      return;
    }

    const editId = this.editingRequestId();
    if (editId) {
      this.assetService.updateHardwareRequest(editId, this.requestForm).subscribe({
        next: () => {
          this.toast.success('Hardware request updated successfully');
          this.isRequestDrawerOpen.set(false);
          this.editingRequestId.set(null);
          this.loadAllData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Failed to update request')
      });
    } else {
      this.assetService.createHardwareRequest(this.requestForm).subscribe({
        next: () => {
          this.toast.success('Hardware request submitted successfully');
          this.isRequestDrawerOpen.set(false);
          this.loadAllData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Failed to submit request')
      });
    }
  }

  openFulfillModal(requestId: number) {
    this.fulfillForm = {
      requestId,
      fulfilledAssetId: this.availableAssets()[0]?.id || 0,
      rejectionReason: ''
    };
    this.isFulfillModalOpen.set(true);
  }

  openRejectModal(requestId: number) {
    this.rejectForm = {
      requestId,
      rejectionReason: ''
    };
    this.isRejectModalOpen.set(true);
  }

  submitReject() {
    const reason = this.rejectForm.rejectionReason.trim();
    if (!reason) {
      this.toast.error('Please enter a rejection reason');
      return;
    }

    if (reason.length > 100) {
      this.toast.error('Rejection reason cannot exceed 100 characters');
      return;
    }

    this.updateRequestStatus(this.rejectForm.requestId, 'REJECTED', reason);
    this.isRejectModalOpen.set(false);
  }

  updateRequestStatus(requestId: number, status: 'APPROVED' | 'REJECTED' | 'FULFILLED', rejectionReason?: string, fulfilledAssetId?: number) {
    this.assetService.updateHardwareRequestStatus(requestId, { status, rejectionReason, fulfilledAssetId }).subscribe({
      next: () => {
        this.toast.success(`Request marked as ${status.toLowerCase()}`);
        this.isFulfillModalOpen.set(false);
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update request')
    });
  }
}
