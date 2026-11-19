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
  LucideSettings,
  LucideArrowRight
} from '@lucide/angular';

import { AssetActionCellRendererComponent } from '../shared/components/asset-action-cell-renderer.component';
import { SearchableSelectComponent, SearchableSelectOption } from '../shared/components/searchable-select/searchable-select.component';
import { SkeletonComponent } from '../shared/components/skeleton/skeleton.component';
import { RoleService } from '../services/role.service';
import { DialogService } from '../shared/services/dialog.service';

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
    LucideArrowRight,
    SearchableSelectComponent,
    SkeletonComponent
  ],
  providers: [DatePipe],
  templateUrl: './assets.html',
  styleUrls: ['./assets.css']
})
export class AssetsComponent implements OnInit {
  private assetService = inject(AssetService);
  private roles = inject(RoleService);
  private employeeService = inject(EmployeeService);
  private uploadService = inject(UploadService);
  private authService = inject(AuthService);
  private permissionsService = inject(PermissionsService);
  private dialog = inject(DialogService);
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
  inventoryPurchases = signal<InventoryTransaction[]>([]);
  inventoryPage = signal<'STOCK' | 'ADDITIONS'>('STOCK');
  inventoryAssignments = signal<any[]>([]);
  inventoryLoading = signal<boolean>(false);
  requestsLoading = signal<boolean>(false);
  assignmentsLoading = signal<boolean>(false);
  requestActionLoading = signal<boolean>(false);

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
  customInventoryCategories = signal<{ value: string; label: string }[]>([]);
  inventoryCategories = computed(() => {
    const usedCategories = this.inventoryItems()
      .map(item => String(item.category || '').trim().toUpperCase())
      .filter(Boolean)
      .map(value => ({ value, label: this.categoryLabel(value) }));
    const all = [...this.categories, ...usedCategories, ...this.customInventoryCategories()];
    return all.filter((category, index) => all.findIndex(item => item.value === category.value) === index);
  });
  isAddingInventoryCategory = signal(false);
  newInventoryCategoryName = signal('');
  customInventorySubcategories = signal<Record<string, string[]>>({});
  isAddingInventorySubcategory = signal(false);
  newInventorySubcategoryName = signal('');
  customInventoryBrands = signal<string[]>([]);
  customInventoryVendors = signal<string[]>([]);
  inventoryBrands = computed(() => this.uniqueInventoryValues([
    ...this.inventoryItems().map(item => item.brand || ''),
    ...this.customInventoryBrands()
  ]));
  inventoryVendors = computed(() => this.uniqueInventoryValues([
    ...this.inventoryItems().map(item => item.supplier || ''),
    ...this.customInventoryVendors()
  ]));
  isAddingInventoryBrand = signal(false);
  isAddingInventoryVendor = signal(false);
  isAddingInventoryOffice = signal(false);
  newInventoryBrandName = signal('');
  newInventoryVendorName = signal('');
  newInventoryOfficeName = signal('');
  customInventoryOffices = signal<string[]>([]);
  inventoryOffices = computed(() => this.uniqueInventoryValues([
    ...this.inventoryItems().map(item => this.parseStorageLocation(item.location).office),
    ...this.customInventoryOffices()
  ]));
  readonly unitOptions = ['units', 'pcs', 'packets', 'boxes', 'bottles', 'pairs', 'sets', 'kg', 'litres'];

  // User Auth Role
  currentUser = signal<any>(null);
  isAdmin = computed(() => {
    const r = this.currentUser()?.role;
    return r === 'SUPERADMIN' || r === 'ADMIN' || r === 'HR' || r === 'OFFICE_STAFF';
  });
  isSuperAdmin = computed(() => this.roles.isSuperAdmin());

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
  inventoryKpiFilter = signal<'ALL' | 'AVAILABLE' | 'ASSIGNED' | 'LOW_STOCK' | 'EXPIRING' | 'EXPIRED' | 'VALUE'>('ALL');
  isInventoryFilterOpen = signal(false);
  inventoryFilters = signal({
    dateRange: 'ALL', category: '', brand: '', supplier: '', itemType: '', stock: 'ALL', expiry: 'ALL'
  });
  filteredInventoryItems = computed(() => {
    let items = this.inventoryItems();
    switch (this.inventoryKpiFilter()) {
      case 'AVAILABLE': items = items.filter(item => item.available > 0); break;
      case 'ASSIGNED': items = items.filter(item => item.netAssigned > 0); break;
      case 'LOW_STOCK': items = items.filter(item => item.lowStock); break;
      case 'EXPIRING': items = items.filter(item => item.expiringSoon && item.statusLabel !== 'Expired'); break;
      case 'EXPIRED': items = items.filter(item => item.statusLabel === 'Expired'); break;
      case 'VALUE': items = items.filter(item => item.totalValue > 0); break;
    }
    const filters = this.inventoryFilters();
    return items.filter(item => this.matchesInventoryFilters(item, filters));
  });

  setInventoryKpiFilter(filter: 'ALL' | 'AVAILABLE' | 'ASSIGNED' | 'LOW_STOCK' | 'EXPIRING' | 'EXPIRED' | 'VALUE') {
    this.inventoryKpiFilter.set(this.inventoryKpiFilter() === filter ? 'ALL' : filter);
  }

  updateInventoryFilter(field: string, value: string) {
    this.inventoryFilters.update(filters => ({ ...filters, [field]: value }));
  }

  clearInventoryFilters() {
    this.inventoryFilters.set({ dateRange: 'ALL', category: '', brand: '', supplier: '', itemType: '', stock: 'ALL', expiry: 'ALL' });
  }

  get activeInventoryFilterCount(): number {
    const filters = this.inventoryFilters();
    return Object.values(filters).filter(value => value && value !== 'ALL').length;
  }

  private matchesInventoryFilters(item: InventoryItem, filters: { dateRange: string; category: string; brand: string; supplier: string; itemType: string; stock: string; expiry: string }): boolean {
    if (filters.category && item.category !== filters.category) return false;
    if (filters.brand && item.brand !== filters.brand) return false;
    if (filters.supplier && item.supplier !== filters.supplier) return false;
    if (filters.itemType && item.itemType !== filters.itemType) return false;
    if (filters.stock === 'AVAILABLE' && item.available <= 0) return false;
    if (filters.stock === 'ASSIGNED' && item.netAssigned <= 0) return false;
    if (filters.stock === 'LOW_STOCK' && !item.lowStock) return false;
    if (filters.stock === 'OUT_OF_STOCK' && item.available > 0) return false;
    if (filters.expiry === 'NO_EXPIRY' && item.expiryDate) return false;
    if (filters.expiry === 'EXPIRING' && (!item.expiringSoon || item.statusLabel === 'Expired')) return false;
    if (filters.expiry === 'EXPIRED' && item.statusLabel !== 'Expired') return false;
    if (!this.matchesInventoryDateRange(item.purchaseDate, filters.dateRange)) return false;
    return true;
  }

  private matchesInventoryDateRange(dateValue: string | undefined, range: string): boolean {
    if (range === 'ALL') return true;
    if (!dateValue) return false;
    const date = new Date(dateValue); date.setHours(0, 0, 0, 0);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (range === 'TODAY') return date.getTime() === now.getTime();
    if (range === 'THIS_MONTH') return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    if (range === 'LAST_MONTH') { const last = new Date(now.getFullYear(), now.getMonth() - 1, 1); return date.getMonth() === last.getMonth() && date.getFullYear() === last.getFullYear(); }
    const days = range === 'LAST_7_DAYS' ? 7 : range === 'LAST_60_DAYS' ? 60 : range === 'LAST_90_DAYS' ? 90 : 365;
    const start = new Date(now); start.setDate(now.getDate() - days);
    return date >= start && date <= now;
  }

  // Filter Query
  searchQuery = signal<string>('');
  inventoryViewMode = signal<'grouped' | 'tracked'>('grouped');

  // Available Assets for assignment dropdown (legacy hardware request fulfillment)
  availableAssets = computed(() => this.assets().filter(a => a.status === 'AVAILABLE'));
  // Individually tracked devices live alongside stock-ledger inventory. A returned
  // device is immediately visible here with its new AVAILABLE / IN_REPAIR status.
  trackedAssetsInInventory = computed(() => this.assets().filter(asset => asset.status !== 'RETIRED'));

  // ===== Item Detail Modal =====
  isItemDetailOpen = signal<boolean>(false);
  detailItemId = signal<number | null>(null);
  detailTxns = signal<InventoryTransaction[]>([]);
  detailLoading = signal<boolean>(false);
  detailTab = signal<'ALL' | 'AVAILABLE' | 'PURCHASE' | 'ASSIGNMENT' | 'RETURN' | 'CONSUMPTION' | 'EXPIRED' | 'ADJUSTMENT'>('ALL');

  selectedItem = computed(() => this.inventoryItems().find(i => i.id === this.detailItemId()) || null);

  filteredDetailTxns = computed(() => {
    const tab = this.detailTab();
    const txns = this.detailTxns();
    switch (tab) {
      case 'AVAILABLE': return txns.filter(t => t.type === 'PURCHASE' || t.type === 'RETURN' || (t.type === 'ADJUSTMENT' && t.quantity > 0));
      case 'PURCHASE': return txns.filter(t => t.type === 'PURCHASE');
      case 'ASSIGNMENT': return txns.filter(t => t.type === 'ASSIGNMENT');
      case 'RETURN': return txns.filter(t => t.type === 'RETURN');
      case 'CONSUMPTION': return txns.filter(t => t.type === 'CONSUMPTION');
      case 'EXPIRED': return txns.filter(t => t.type === 'EXPIRED');
      case 'ADJUSTMENT': return txns.filter(t => t.type === 'ADJUSTMENT');
      default: return txns;
    }
  });

  filterTransactionsFromKpi(tab: 'ALL' | 'AVAILABLE' | 'PURCHASE' | 'ASSIGNMENT' | 'RETURN' | 'CONSUMPTION' | 'EXPIRED') {
    this.detailTab.set(tab);
  }

  // ===== Inventory Item Form (Add/Edit) =====
  isInvItemFormOpen = signal(false);
  savingItem = signal(false);
  inventoryFormStep = signal<1 | 2 | 3 | 4>(1);
  invItemForm: any = this.emptyItemForm();
  inventoryFormErrors: Record<string, string> = {};

  get isItCategory(): boolean {
    return IT_CATEGORIES.includes(this.invItemForm.category);
  }
  get showConsumableFields(): boolean {
    return this.invItemForm.itemType === 'CONSUMABLE';
  }
  get invTotalCostPreview(): number {
    return Number(this.invItemForm.totalPurchaseAmount) || 0;
  }
  get invTotalQuantityPreview(): number {
    return (Number(this.invItemForm.quantity) || 0) * (Number(this.invItemForm.itemsPerUnit) || 0);
  }
  get invCostPerUnitPreview(): number {
    const units = Number(this.invItemForm.quantity) || 0;
    return units > 0 ? this.invTotalCostPreview / units : 0;
  }
  get invCostPerItemPreview(): number {
    const items = this.invTotalQuantityPreview;
    return items > 0 ? this.invTotalCostPreview / items : 0;
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
  isInvRestockOpen = signal(false);
  invRestockSubmitting = signal(false);
  invRestockError = signal('');
  invRestockForm: any = {};
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
  editingAssignmentId = signal<number | null>(null);
  editingAssignmentAsset = signal<Asset | null>(null);
  isAssetDrawerOpen = signal<boolean>(false);
  isReturnModalOpen = signal<boolean>(false);
  isRequestDrawerOpen = signal<boolean>(false);
  isRequestDetailOpen = signal<boolean>(false);
  selectedRequest = signal<HardwareRequest | null>(null);
  isAssignmentDetailOpen = signal(false);
  selectedAssignment = signal<any | null>(null);
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
    subject: '',
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
    return `\u20B9${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  }

  fmtDate(d?: string | Date | null): string {
    if (!d) return '-';
    const date = new Date(d);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
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
      subcategory: '',
      itemType: 'CONSUMABLE',
      brand: '',
      unit: 'packets',
      quantity: null as number | null,
      itemsPerUnit: 1,
      totalPurchaseAmount: null as number | null,
      unitCost: null as number | null,
      purchaseDate: new Date().toISOString().split('T')[0],
      supplier: '',
      batchNumber: '',
      expiryDate: '',
      noExpiry: false,
      office: '',
      storageAddress1: '',
      storageAddress2: '',
      storageAddress3: '',
      model: '',
      serialNumber: '',
      warrantyExpiry: '',
      notes: ''
    };
  }

  onCategoryChange() {
    const cat = this.invItemForm.category;
    this.invItemForm.subcategory = '';
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

  startAddingInventoryCategory() {
    this.newInventoryCategoryName.set('');
    this.isAddingInventoryCategory.set(true);
  }

  cancelAddingInventoryCategory() {
    this.isAddingInventoryCategory.set(false);
    this.newInventoryCategoryName.set('');
  }

  addInventoryCategory() {
    const label = this.newInventoryCategoryName().trim();
    if (!label) {
      this.toast.error('Please enter a category name');
      return;
    }

    const value = label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
    if (!value) {
      this.toast.error('Please enter a valid category name');
      return;
    }

    if (!this.inventoryCategories().some(category => category.value === value)) {
      this.customInventoryCategories.update(categories => [...categories, { value, label }]);
    }
    this.invItemForm.category = value;
    this.onCategoryChange();
    this.cancelAddingInventoryCategory();
  }

  inventorySubcategories(category = this.invItemForm.category): string[] {
    if (!category) return [];
    const saved = this.inventoryItems()
      .filter(item => item.category === category)
      .map(item => this.inventoryPurchase(item).subcategory || '')
      .filter(Boolean);
    const custom = this.customInventorySubcategories()[category] || [];
    return [...new Set([...saved, ...custom])].sort((a, b) => a.localeCompare(b));
  }

  startAddingInventorySubcategory() {
    if (!this.invItemForm.category) {
      this.toast.error('Select a category first');
      return;
    }
    this.newInventorySubcategoryName.set('');
    this.isAddingInventorySubcategory.set(true);
  }

  cancelAddingInventorySubcategory() {
    this.isAddingInventorySubcategory.set(false);
    this.newInventorySubcategoryName.set('');
  }

  addInventorySubcategory() {
    const subcategory = this.newInventorySubcategoryName().trim();
    const category = this.invItemForm.category;
    if (!subcategory) {
      this.toast.error('Please enter a subcategory name');
      return;
    }
    this.customInventorySubcategories.update(values => ({
      ...values,
      [category]: [...new Set([...(values[category] || []), subcategory])]
    }));
    this.invItemForm.subcategory = subcategory;
    this.cancelAddingInventorySubcategory();
  }

  startAddingInventoryBrand() {
    this.newInventoryBrandName.set('');
    this.isAddingInventoryBrand.set(true);
  }

  addInventoryBrand() {
    const brand = this.newInventoryBrandName().trim();
    if (!brand) {
      this.toast.error('Please enter a brand name');
      return;
    }
    if (!this.inventoryBrands().some(value => value.toLowerCase() === brand.toLowerCase())) {
      this.customInventoryBrands.update(values => [...values, brand]);
    }
    this.invItemForm.brand = brand;
    this.isAddingInventoryBrand.set(false);
  }

  startAddingInventoryVendor() {
    this.newInventoryVendorName.set('');
    this.isAddingInventoryVendor.set(true);
  }

  addInventoryVendor() {
    const vendor = this.newInventoryVendorName().trim();
    if (!vendor) {
      this.toast.error('Please enter a vendor name');
      return;
    }
    if (!this.inventoryVendors().some(value => value.toLowerCase() === vendor.toLowerCase())) {
      this.customInventoryVendors.update(values => [...values, vendor]);
    }
    this.invItemForm.supplier = vendor;
    this.isAddingInventoryVendor.set(false);
  }

  startAddingInventoryOffice() {
    this.newInventoryOfficeName.set('');
    this.isAddingInventoryOffice.set(true);
  }

  addInventoryOffice() {
    const office = this.newInventoryOfficeName().trim();
    if (!office) {
      this.toast.error('Please enter an office name');
      return;
    }
    if (!this.inventoryOffices().some(value => value.toLowerCase() === office.toLowerCase())) {
      this.customInventoryOffices.update(values => [...values, office]);
    }
    this.invItemForm.office = office;
    this.isAddingInventoryOffice.set(false);
  }

  formatStorageLocation(): string | null {
    const f = this.invItemForm;
    const parts = [
      f.office && `Office: ${String(f.office).trim()}`,
      f.storageAddress1 && `Storage: ${String(f.storageAddress1).trim()}`,
      f.storageAddress2 && `Level 2: ${String(f.storageAddress2).trim()}`,
      f.storageAddress3 && `Level 3: ${String(f.storageAddress3).trim()}`
    ].filter(Boolean);
    return parts.length ? parts.join(' | ') : null;
  }

  private parseStorageLocation(location?: string | null): { office: string; address1: string; address2: string; address3: string } {
    const result = { office: '', address1: '', address2: '', address3: '' };
    if (!location) return result;
    const parts = String(location).split(' | ').map(part => part.trim());
    for (const part of parts) {
      if (part.startsWith('Office: ')) result.office = part.slice(8);
      else if (part.startsWith('Storage: ')) result.address1 = part.slice(9);
      else if (part.startsWith('Level 2: ')) result.address2 = part.slice(9);
      else if (part.startsWith('Level 3: ')) result.address3 = part.slice(9);
    }
    if (!result.office && !result.address1 && !result.address2 && !result.address3) result.address1 = String(location);
    return result;
  }

  private uniqueInventoryValues(values: string[]): string[] {
    return values
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .filter((value, index, list) => list.findIndex(item => item.toLowerCase() === value.toLowerCase()) === index)
      .sort((a, b) => a.localeCompare(b));
  }

  private categoryLabel(value: string): string {
    return value.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  // ==========================================
  // INVENTORY GRID
  // ==========================================
  catLabel(cat?: string): string {
    const c = String(cat || '').toUpperCase();
    if (!c) return '-';
    const found = this.inventoryCategories().find(x => x.value === c);
    return found ? found.label : c;
  }

  invRowHeight = (params: any): number => {
    const nameLen = String(params?.data?.name || '').length;
    return nameLen > 34 ? 72 : 56;
  };

  private inventoryExpiryCell(item: InventoryItem): string {
    if (!item.expiryDate) return '<span class="expiry-chip expiry-none">No expiry</span>';
    const expiry = new Date(item.expiryDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.ceil((expiry.getTime() - today.getTime()) / 86400000);
    if (days < 0) return `<span class="expiry-chip expiry-overdue">Expired ${this.fmtDate(item.expiryDate)}</span>`;
    if (days <= 30) return `<span class="expiry-chip expiry-soon">${this.fmtDate(item.expiryDate)} · ${days}d</span>`;
    return `<span class="expiry-chip expiry-ok">${this.fmtDate(item.expiryDate)}</span>`;
  }

  inventoryColDefs: ColDef[] = [
    {
      headerName: 'Item Name',
      field: 'name',
      flex: 2.4,
      minWidth: 200,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const sub: string[] = [];
        if (params.data.batchNumber) sub.push(`Serial: ${params.data.batchNumber}`);
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
      minWidth: 105,
      valueGetter: (p: any) => p.data?.brand || '-'
    },
    {
      headerName: 'Category',
      field: 'category',
      flex: 1.15,
      minWidth: 130,
      valueGetter: (p: any) => this.catLabel(p.data?.category),
      cellRenderer: (params: any) => {
        if (!params.value || params.value === '-') return '-';
        const raw = String(params.data?.category || '');
        return `<span class="cat-badge ${getCategoryClass(raw)}">${this.catLabel(raw)}</span>`;
      }
    },
    {
      headerName: 'Qty',
      field: 'quantity',
      width: 78,
      type: 'alignedCenter',
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => params.value != null ? `<span class="cell-num">${params.value}</span>` : '-'
    },
    {
      headerName: 'Purchased',
      field: 'purchaseDate',
      width: 116,
      type: 'alignedCenter',
      valueFormatter: () => '',
      valueGetter: (p: any) => p.data?.purchaseDate || '',
      cellRenderer: (params: any) => this.fmtDate(params.value)
    },
    {
      headerName: 'Expiry',
      field: 'expiryDate',
      width: 138,
      type: 'alignedCenter',
      valueGetter: (p: any) => p.data?.expiryDate || '',
      cellRenderer: (params: any) => this.inventoryExpiryCell(params.data as InventoryItem)
    },
    {
      headerName: 'In Stock',
      field: 'available',
      width: 88,
      type: 'alignedCenter',
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => {
        const v = params.value ?? 0;
        if (v <= 0) return `<span class="cell-num text-danger-cell">0</span>`;
        return `<span class="cell-num-strong" style="color:#059669;">${v}</span>`;
      }
    },
    {
      headerName: 'Out',
      field: 'netAssigned',
      width: 72,
      type: 'alignedCenter',
      filter: 'agNumberColumnFilter',
      cellRenderer: (params: any) => {
        const v = params.value ?? 0;
        return v > 0 ? `<span class="cell-num-strong" style="color:#2563EB;">${v}</span>` : `<span class="cell-num">0</span>`;
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
        onViewDetails: (data: InventoryItem) => this.openItemDetail(data.id),
        onAddStock: (data: InventoryItem) => this.openRestockForItem(data.id),
        editLabel: 'Edit Item',
        onEdit: (data: InventoryItem) => this.openEditItemModal(data),
        onAssign: (data: InventoryItem) => this.openDetailThenAssign(data.id),
        onDelete: (data: InventoryItem) => this.deleteInventoryItem(data),
        canDelete: () => this.isSuperAdmin(),
        deleteLabel: 'Delete Item'
      }
    }
  ];

  assetInventoryColDefs: ColDef[] = [
    {
      headerName: 'Asset', field: 'name', flex: 1.7, minWidth: 210,
      cellRenderer: (params: any) => {
        const asset = params.data as Asset;
        return `<div class="cell-stacked"><div class="cell-title-bold">${asset.name}</div><div class="cell-subtitle-row"><span class="tag-mono">${asset.assetTag}</span>${asset.model ? `<span>${asset.model}</span>` : ''}</div></div>`;
      }
    },
    { headerName: 'Category', field: 'category', flex: 1, minWidth: 125, cellRenderer: (params: any) => `<span class="cat-badge ${getCategoryClass(params.value || '')}">${this.catLabel(params.value)}</span>` },
    { headerName: 'Brand', field: 'brand', flex: 0.9, minWidth: 110, valueGetter: (p: any) => p.data?.brand || '—' },
    { headerName: 'Serial Number', field: 'serialNumber', flex: 1.1, minWidth: 145, valueGetter: (p: any) => p.data?.serialNumber || '—' },
    {
      headerName: 'Status', field: 'status', flex: 0.95, minWidth: 125,
      cellRenderer: (params: any) => {
        const status = String(params.value || 'AVAILABLE');
        const label = status.replace(/_/g, ' ');
        const css = status === 'AVAILABLE' ? 'status-available' : status === 'ASSIGNED' ? 'status-assigned' : 'status-repair';
        return `<span class="status-pill ${css}"><span class="status-dot"></span>${label}</span>`;
      }
    },
    {
      headerName: 'Actions', field: 'actions', width: 96, sortable: false, filter: false, pinned: 'right',
      cellRenderer: AssetActionCellRendererComponent,
      cellRendererParams: {
        onViewDetails: (asset: Asset) => this.openDetailModal(asset),
        onEdit: (asset: Asset) => this.openEditAssetDrawer(asset),
        onAssign: (asset: Asset) => this.openAssignDrawer(asset.id),
        onDelete: (asset: Asset) => this.deleteAsset(asset),
        canEdit: () => this.isAdmin(),
        canDelete: () => this.isAdmin()
      }
    }
  ];

  onInventoryRowClicked(event: any) {
    if (!event?.data) return;
    if (event.column?.getColId() === 'actions') return;
    this.openItemDetail(event.data.id);
  }

  onTrackedAssetRowClicked(event: any) {
    if (!event?.data || event.column?.getColId() === 'actions') return;
    this.openDetailModal(event.data);
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
      assetId: a.assetId,
      itemAsset: a.asset,
      employeeId: a.employeeId,
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
  isAssignmentFilterOpen = signal(false);
  isRequestFilterOpen = signal(false);
  assignmentFilters = signal({ dateRange: 'ALL', source: 'ALL', status: 'ALL', employeeId: '', due: 'ALL' });
  requestFilters = signal({ dateRange: 'ALL', status: 'ALL', requestType: 'ALL', category: '', urgency: 'ALL' });

  assignmentFilterEmployees = computed(() => {
    const seen = new Map<number, any>();
    this.unifiedAssignments().forEach(row => {
      if (row.employee?.id) seen.set(row.employee.id, row.employee);
    });
    return [...seen.values()];
  });

  requestCategories = computed(() => [...new Set(this.requests().map(request => request.category).filter(Boolean))].sort());

  filteredAssignments = computed(() => {
    const filters = this.assignmentFilters();
    return this.unifiedAssignments().filter(row => {
      // Inventory rows have an expected return date; device rows retain their
      // return date. The combined grid intentionally supports both shapes.
      const returnDate = (row as { expectedReturnDate?: string; returnDate?: string }).expectedReturnDate
        || (row as { returnDate?: string }).returnDate;
      if (filters.source !== 'ALL' && row.source !== filters.source) return false;
      if (filters.employeeId && String(row.employee?.id || '') !== filters.employeeId) return false;
      if (filters.status === 'ACTIVE' && row.status !== 'ACTIVE') return false;
      if (filters.status === 'RETURNED' && row.status !== 'RETURNED') return false;
      if (filters.status === 'OVERDUE' && !this.isOverdueRow(row)) return false;
      if (filters.due === 'OVERDUE' && !this.isOverdueRow(row)) return false;
      if (filters.due === 'DUE_7' && (!returnDate || !this.isDueWithinDays(returnDate, 7))) return false;
      if (filters.due === 'NO_DUE' && returnDate) return false;
      return this.matchesInventoryDateRange(row.assignedDate, filters.dateRange);
    });
  });

  filteredRequests = computed(() => {
    const filters = this.requestFilters();
    return this.requests().filter(request => {
      if (filters.status !== 'ALL' && request.status !== filters.status) return false;
      if (filters.requestType !== 'ALL' && request.requestType !== filters.requestType) return false;
      if (filters.category && request.category !== filters.category) return false;
      if (filters.urgency !== 'ALL' && request.urgency !== filters.urgency) return false;
      return this.matchesInventoryDateRange(request.createdAt, filters.dateRange);
    });
  });

  get activeAssignmentFilterCount(): number {
    return Object.values(this.assignmentFilters()).filter(value => value && value !== 'ALL').length;
  }

  get activeRequestFilterCount(): number {
    return Object.values(this.requestFilters()).filter(value => value && value !== 'ALL').length;
  }

  updateAssignmentFilter(field: string, value: string) {
    this.assignmentFilters.update(filters => ({ ...filters, [field]: value }));
  }

  updateRequestFilter(field: string, value: string) {
    this.requestFilters.update(filters => ({ ...filters, [field]: value }));
  }

  clearAssignmentFilters() {
    this.assignmentFilters.set({ dateRange: 'ALL', source: 'ALL', status: 'ALL', employeeId: '', due: 'ALL' });
  }

  clearRequestFilters() {
    this.requestFilters.set({ dateRange: 'ALL', status: 'ALL', requestType: 'ALL', category: '', urgency: 'ALL' });
  }

  private isDueWithinDays(dateValue: string, days: number): boolean {
    const date = new Date(dateValue); date.setHours(0, 0, 0, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const end = new Date(today); end.setDate(today.getDate() + days);
    return !isNaN(date.getTime()) && date >= today && date <= end;
  }

  asgRowHeight = (params: any): number => {
    const nameLen = String(params?.data?.itemName || params?.data?.itemAsset?.name || '').length;
    return nameLen > 34 ? 76 : 64;
  };

  onAssignmentRowClicked(event: any) {
    if (!event?.data) return;
    if (event.column?.getColId() === 'actions') return;
    this.openAssignmentDetail(event.data);
  }

  openAssignmentDetail(assignment: any) {
    this.selectedAssignment.set(assignment);
    this.isAssignmentDetailOpen.set(true);
  }

  closeAssignmentDetail() {
    this.isAssignmentDetailOpen.set(false);
    this.selectedAssignment.set(null);
  }

  assignmentStatusLabel(assignment: any): string {
    return this.isOverdueRow(assignment) ? 'OVERDUE' : assignment?.status === 'ACTIVE' ? 'ASSIGNED' : 'RETURNED';
  }

  assignmentStatusClass(assignment: any): string {
    return this.isOverdueRow(assignment) ? 'status-overdue' : assignment?.status === 'ACTIVE' ? 'status-assigned' : 'status-returned';
  }

  assignmentItemName(assignment: any): string {
    return assignment?.source === 'INVENTORY' ? assignment.itemName : assignment?.itemAsset?.name || 'Asset';
  }

  returnAssignmentFromDetail() {
    const row = this.selectedAssignment();
    if (!row || row.status !== 'ACTIVE' || !this.isAdmin()) return;
    this.closeAssignmentDetail();
    if (row.source === 'INVENTORY') {
      const txn = this.inventoryAssignments().find((t: any) => t.id === row.id);
      if (txn) this.openInvReturnModal(txn);
    } else {
      this.openReturnModal(row.id);
    }
  }

  editAssignmentFromDetail() {
    const row = this.selectedAssignment();
    if (!row || row.source !== 'ASSET' || row.status !== 'ACTIVE') return;
    this.closeAssignmentDetail();
    this.openEditAssignment(row);
  }

  async deleteAssignmentFromDetail() {
    const row = this.selectedAssignment();
    if (!row || row.source !== 'ASSET' || row.status !== 'ACTIVE') return;
    this.closeAssignmentDetail();
    await this.deleteAssignment(row);
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
          <a class="cell-user-avatar-row employee-profile-link" href="/employees/${emp.id}/profile" onclick="event.stopPropagation()" title="View ${fullName}'s profile">
            ${avatarHtml}
            <div class="user-text-stack">
              <div class="cell-title-bold">${fullName}</div>
              <div class="user-dept">${dept}</div>
            </div>
          </a>
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
        onEdit: (row: any) => this.openEditAssignment(row),
        canEdit: (row: any) => !!row && row.source === 'ASSET' && row.status === 'ACTIVE' && this.isAdmin(),
        editLabel: 'Edit assignment',
        onReturn: (row: any) => {
          if (row.status !== 'ACTIVE' || !this.isAdmin()) return;
          if (row.source === 'INVENTORY') {
            const txn = this.inventoryAssignments().find((t: any) => t.id === row.id);
            if (txn) this.openInvReturnModal(txn);
          } else {
            this.openReturnModal(row.id);
          }
        },
        canReturn: (row: any) => !!row && row.status === 'ACTIVE' && this.isAdmin(),
        returnLabel: 'Return assignment',
        onDelete: (row: any) => this.deleteAssignment(row),
        canDelete: (row: any) => !!row && row.source === 'ASSET' && row.status === 'ACTIVE' && this.isAdmin(),
        deleteLabel: 'Delete assignment'
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
      cellStyle: { display: 'flex', alignItems: 'center', lineHeight: 'normal' },
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return '-';
        const initial = emp.firstName ? emp.firstName.charAt(0).toUpperCase() : 'U';
        const avatarUrl = emp.avatarUrl || emp.user?.avatarUrl;

        const avatarHtml = avatarUrl
            ? `<img src="${avatarUrl}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #E2E8F0;" />`
            : `<div class="avatar-circle-sm">${initial}</div>`;
        const profileUrl = emp.id ? `/employees/${emp.id}/profile` : '';

        return `
          <a class="cell-user-avatar-row employee-profile-link" href="${profileUrl}" onclick="event.stopPropagation()" title="View ${emp.firstName} ${emp.lastName}'s profile" style="display:flex;align-items:center;gap:9px;min-width:0;line-height:1.2;color:inherit;text-decoration:none;">
            ${avatarHtml}
            <div class="user-text-stack" style="min-width:0;display:flex;flex-direction:column;gap:2px;">
              <div class="cell-title-bold" style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.firstName} ${emp.lastName}</div>
              <div class="user-dept" style="font-size:10.5px;color:#64748B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${emp.department?.name || 'Employee'}</div>
            </div>
          </a>
        `;
      }
    },
    {
      headerName: 'Request Details & Category',
      field: 'reason',
      flex: 1.6,
      cellStyle: { display: 'flex', alignItems: 'center', lineHeight: 'normal' },
      cellRenderer: (params: any) => {
        if (!params.data) return '-';
        const catClass = getCategoryClass(params.data.category);
        return `
          <div class="request-summary" style="height:100%;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:4px;line-height:1.15;">
            <div class="request-summary-title" title="${params.data.subject || params.data.reason || 'Hardware Request'}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#172033;font-size:13px;font-weight:700;">${params.data.subject || params.data.reason || 'Hardware Request'}</div>
            <div class="request-summary-meta" style="display:flex;align-items:center;gap:7px;min-width:0;line-height:1;">
              <span class="cat-badge ${catClass}">${params.data.category}</span>
              <span class="request-type-label">${(params.data.requestType || 'NEW_DEVICE').replace('_', ' ')}</span>
            </div>
          </div>
        `;
      }
    },
    {
      headerName: 'Urgency',
      field: 'urgency',
      flex: 0.9,
      cellStyle: { display: 'flex', alignItems: 'center', lineHeight: 'normal' },
      cellRenderer: (params: any) => {
        const u = params.value || 'MEDIUM';
        const urgencyClass = getUrgencyClass(u);
        return `<span class="badge-condition ${urgencyClass}" style="display:inline-flex;align-items:center;justify-content:center;line-height:1;padding:5px 9px;min-width:52px;">${u}</span>`;
      }
    },
    {
      headerName: 'Attachments',
      field: 'images',
      flex: 1.1,
      minWidth: 130,
      cellStyle: { display: 'flex', alignItems: 'center', lineHeight: 'normal' },
      cellRenderer: (params: any) => {
        let imgs: string[] = [];
        if (params.value) {
          try {
            imgs = typeof params.value === 'string' ? JSON.parse(params.value) : params.value;
          } catch (e) { imgs = []; }
        }
        if (!imgs || imgs.length === 0) return '<span style="color: #94A3B8; font-size: 12px;">No photos</span>';

        return `
          <div class="cell-user-avatar-row" style="display:flex;align-items:center;gap:8px;cursor:pointer;line-height:1;" title="Click to view full photos">
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
      cellStyle: { display: 'flex', alignItems: 'center', lineHeight: 'normal' },
      valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') : '-'
    },
    {
      headerName: 'Status',
      field: 'status',
      flex: 1.2,
      cellStyle: { display: 'flex', alignItems: 'center', lineHeight: 'normal' },
      cellRenderer: (params: any) => {
        const s = params.value || 'PENDING';
        const statusClass = getStatusClass(s);
        const reasonHtml = s === 'REJECTED' && params.data?.rejectionReason
          ? `<div style="font-size: 10px; color: #1373e5; font-weight: 500; line-height: 1.2; margin-top: 3px;" title="${params.data.rejectionReason}">Reason: ${params.data.rejectionReason}</div>`
          : '';
        return `
          <div class="cell-stacked" style="height:100%;display:flex;flex-direction:column;justify-content:center;gap:3px;line-height:1.1;">
            <span class="status-round ${statusClass}" style="display:inline-flex;align-items:center;align-self:flex-start;line-height:1;padding:5px 10px;">
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
        canEdit: (data: HardwareRequest) => this.isSuperAdmin() || (data.status === 'PENDING' && this.isSelfRequest(data)),
        onEdit: (data: HardwareRequest) => this.openEditRequestDrawer(data),
        canCancel: (data: HardwareRequest) => data.status === 'PENDING' && this.isSelfRequest(data),
        onCancel: (data: HardwareRequest) => this.cancelRequest(data.id),
        deleteLabel: 'Delete Request',
        canDelete: () => this.isSuperAdmin(),
        onDelete: (data: HardwareRequest) => this.deleteHardwareRequest(data),
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

  onHardwareRequestRowClicked(event: any) {
    if (!event?.data) return;
    this.selectedRequest.set(event.data);
    this.isRequestDetailOpen.set(true);
  }

  closeRequestDetail() {
    this.isRequestDetailOpen.set(false);
    this.selectedRequest.set(null);
  }

  requestImages(request: HardwareRequest): string[] {
    if (!request?.images) return [];
    try { return typeof request.images === 'string' ? JSON.parse(request.images) : request.images; } catch { return []; }
  }

  loadAllData() {
    this.loadInventory();
    this.assetService.getAllAssets().subscribe(res => this.assets.set(res));
    
    this.assignmentsLoading.set(true);
    this.assetService.getAssignments().subscribe({
      next: res => this.assignments.set(res),
      complete: () => this.assignmentsLoading.set(false),
      error: () => this.assignmentsLoading.set(false)
    });
    
    this.assetService.getInventoryAssignments().subscribe(res => this.inventoryAssignments.set(res));
    
    this.requestsLoading.set(true);
    this.assetService.getHardwareRequests().subscribe({
      next: res => this.requests.set(res),
      complete: () => this.requestsLoading.set(false),
      error: () => this.requestsLoading.set(false)
    });
    
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
    this.assetService.getInventoryPurchases().subscribe({ next: rows => this.inventoryPurchases.set(rows) });
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

  openInvRestockModal() {
    const item = this.selectedItem();
    if (!item) return;
    this.invRestockForm = { quantity: null, purchaseDate: new Date().toISOString().slice(0, 10), supplier: item.supplier || '', unitCost: item.unitCost || 0, notes: '' };
    this.invRestockError.set('');
    this.isInvRestockOpen.set(true);
  }

  get restockPriceMismatch(): boolean {
    const item = this.selectedItem();
    return !!item && this.invRestockForm?.unitCost != null && Number(this.invRestockForm.unitCost) !== Number(item.unitCost);
  }

  openRestockForItem(itemId: number) {
    this.detailItemId.set(itemId);
    this.openInvRestockModal();
  }

  submitInvRestock() {
    const item = this.selectedItem(); const quantity = Number(this.invRestockForm.quantity);
    if (!item || !Number.isInteger(quantity) || quantity < 1) { this.invRestockError.set('Enter a whole quantity of at least 1.'); return; }
    if (this.restockPriceMismatch) { this.invRestockError.set(`This item uses ₹${item.unitCost} per item. Create a new item to record a different price.`); return; }
    this.invRestockSubmitting.set(true);
    this.assetService.addInventoryPurchase(item.id, { ...this.invRestockForm, quantity }).subscribe({ next: () => { this.toast.success(`${quantity} ${item.unit} added to ${item.name}`); this.invRestockSubmitting.set(false); this.isInvRestockOpen.set(false); this.refreshInventoryData(); }, error: err => { this.invRestockError.set(err.error?.message || 'Could not add stock'); this.invRestockSubmitting.set(false); } });
  }

  // ==========================================
  // ADD / EDIT INVENTORY ITEM
  // ==========================================
  openAddItemModal() {
    this.invItemForm = this.emptyItemForm();
    this.inventoryFormErrors = {};
    this.inventoryFormStep.set(1);
    this.isInvItemFormOpen.set(true);
  }

  openEditItemModal(item: InventoryItem) {
    const storage = this.parseStorageLocation(item.location);
    this.invItemForm = {
      id: item.id,
      name: item.name,
      category: item.category,
      subcategory: this.inventoryPurchase(item).subcategory || '',
      itemType: item.itemType,
      brand: item.brand || '',
      unit: item.unit || 'units',
      quantity: this.inventoryPurchase(item).unitCount,
      itemsPerUnit: this.inventoryPurchase(item).itemsPerUnit,
      totalPurchaseAmount: this.inventoryPurchase(item).totalAmount,
      unitCost: item.unitCost,
      purchaseDate: item.purchaseDate ? new Date(item.purchaseDate).toISOString().split('T')[0] : '',
      supplier: item.supplier || '',
      batchNumber: item.batchNumber || '',
      expiryDate: item.expiryDate ? new Date(item.expiryDate).toISOString().split('T')[0] : '',
      noExpiry: !item.expiryDate,
      office: storage.office,
      storageAddress1: storage.address1,
      storageAddress2: storage.address2,
      storageAddress3: storage.address3,
      model: item.model || '',
      serialNumber: item.serialNumber || '',
      warrantyExpiry: item.warrantyExpiry ? new Date(item.warrantyExpiry).toISOString().split('T')[0] : '',
      notes: this.inventoryNotes(item)
    };
    this.inventoryFormErrors = {};
    this.inventoryFormStep.set(1);
    this.isInvItemFormOpen.set(true);
  }

  nextInventoryFormStep() {
    const step = this.inventoryFormStep();
    if (step === 1) {
      if (!this.invItemForm.category) this.inventoryFormErrors['category'] = 'Select a category.';
      if (!String(this.invItemForm.name || '').trim()) this.inventoryFormErrors['name'] = 'Item name is required.';
      if (Object.keys(this.inventoryFormErrors).length) return;
    }
    if (step === 2) {
      if (this.invItemForm.quantity == null || Number(this.invItemForm.quantity) < 1 || !Number.isInteger(Number(this.invItemForm.quantity))) this.inventoryFormErrors['quantity'] = 'Enter a whole number of units (at least 1).';
      if (this.invItemForm.totalPurchaseAmount == null || Number(this.invItemForm.totalPurchaseAmount) < 0) this.inventoryFormErrors['totalPurchaseAmount'] = 'Enter a valid total amount.';
      if (!Number.isInteger(Number(this.invItemForm.itemsPerUnit)) || Number(this.invItemForm.itemsPerUnit) < 1) this.inventoryFormErrors['itemsPerUnit'] = 'Enter at least 1 item per unit.';
      if (this.inventoryFormErrors['quantity'] || this.inventoryFormErrors['totalPurchaseAmount'] || this.inventoryFormErrors['itemsPerUnit']) return;
    }
    if (step < 4) this.inventoryFormStep.set((step + 1) as 1 | 2 | 3 | 4);
  }

  previousInventoryFormStep() {
    const step = this.inventoryFormStep();
    if (step > 1) this.inventoryFormStep.set((step - 1) as 1 | 2 | 3 | 4);
  }

  clearInventoryError(field: string) {
    if (this.inventoryFormErrors[field]) delete this.inventoryFormErrors[field];
  }

  private validateInventoryForm(): boolean {
    const f = this.invItemForm;
    this.inventoryFormErrors = {};
    if (!f.category) this.inventoryFormErrors['category'] = 'Select a category.';
    if (!String(f.name || '').trim()) this.inventoryFormErrors['name'] = 'Item name is required.';
    if (f.id == null && (f.quantity == null || Number(f.quantity) < 1 || !Number.isInteger(Number(f.quantity)))) {
      this.inventoryFormErrors['quantity'] = 'Enter a whole number of units (at least 1).';
    }
    if (f.id == null && (!Number.isInteger(Number(f.itemsPerUnit)) || Number(f.itemsPerUnit) < 1)) {
      this.inventoryFormErrors['itemsPerUnit'] = 'Enter at least 1 item per unit.';
    }
    if (f.totalPurchaseAmount == null || Number(f.totalPurchaseAmount) < 0) {
      this.inventoryFormErrors['totalPurchaseAmount'] = 'Enter a valid total amount.';
    }
    if (f.itemType === 'CONSUMABLE' && !f.noExpiry && !f.expiryDate) {
      this.inventoryFormErrors['expiryDate'] = 'Enter an expiry date or select No expiry date.';
    }
    return Object.keys(this.inventoryFormErrors).length === 0;
  }

  saveInventoryItem() {
    const f = this.invItemForm;
    if (!this.validateInventoryForm()) return;

    const payload: any = {
      name: f.name.trim(),
      category: f.category,
      itemType: f.itemType,
      brand: f.brand,
      unit: f.unit,
      unitCost: this.invCostPerItemPreview,
      purchaseDate: f.purchaseDate || null,
      supplier: f.supplier,
      batchNumber: f.batchNumber,
      expiryDate: f.noExpiry ? null : (f.expiryDate || null),
      location: this.formatStorageLocation(),
      model: this.isItCategory ? f.model : null,
      serialNumber: this.isItCategory ? f.serialNumber : null,
      warrantyExpiry: this.isItCategory ? (f.warrantyExpiry || null) : null,
      notes: this.notesWithPurchaseBreakdown(f.notes)
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
      payload.quantity = this.invTotalQuantityPreview;
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

  inventoryPurchase(item: InventoryItem): { unitCount: number; itemsPerUnit: number; totalAmount: number; subcategory?: string } {
    const match = String(item.notes || '').match(/\[\[inventory-purchase:(.*?)\]\]\s*$/s);
    if (match) {
      try {
        const data = JSON.parse(match[1]);
        return {
          unitCount: Number(data.unitCount) || item.quantity || 0,
          itemsPerUnit: Number(data.itemsPerUnit) || 1,
          totalAmount: Number(data.totalAmount) || item.totalValue || 0,
          subcategory: typeof data.subcategory === 'string' ? data.subcategory : ''
        };
      } catch { /* fall through to legacy values */ }
    }
    return { unitCount: item.quantity || 0, itemsPerUnit: 1, totalAmount: item.totalValue || 0, subcategory: '' };
  }

  inventoryNotes(item: InventoryItem): string {
    return String(item.notes || '').replace(/\s*\[\[inventory-purchase:.*?\]\]\s*$/s, '').trim();
  }

  private notesWithPurchaseBreakdown(notes: string): string {
    const userNotes = String(notes || '').trim();
    const data = JSON.stringify({
      unitCount: Number(this.invItemForm.quantity) || 0,
      itemsPerUnit: Number(this.invItemForm.itemsPerUnit) || 1,
      totalAmount: Number(this.invItemForm.totalPurchaseAmount) || 0,
      subcategory: String(this.invItemForm.subcategory || '').trim()
    });
    return `${userNotes}${userNotes ? '\n' : ''}[[inventory-purchase:${data}]]`;
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
      clientName: '',
      companyName: '',
      clientEmail: '',
      clientPhone: '',
      quantity: null,
      date: new Date().toISOString().split('T')[0],
      assignmentLocation: '',
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
    if (f.mode === 'CLIENT' && (!f.clientName?.trim() || !f.companyName?.trim())) {
      this.invAssignError.set('Please enter both the client name and company name');
      return;
    }

    const payload: any = {
      quantity: qty,
      date: f.date || new Date().toISOString().split('T')[0],
      purpose: f.purpose,
      assignmentLocation: f.assignmentLocation?.trim() || undefined,
      clientDetails: f.mode === 'CLIENT'
        ? [
            `Client contact: ${f.clientName.trim()}`,
            `Company: ${f.companyName.trim()}`,
            f.clientEmail?.trim() ? `Email: ${f.clientEmail.trim()}` : '',
            f.clientPhone?.trim() ? `Phone: ${f.clientPhone.trim()}` : ''
          ].filter(Boolean).join(' | ')
        : undefined
    };
    if (f.mode === 'EMPLOYEE') payload.employeeId = Number(f.employeeId);
    else payload.assigneeText = f.mode === 'CLIENT'
      ? `Client: ${f.clientName.trim()} · ${f.companyName.trim()}`
      : f.assigneeText.trim();

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
    this.editingAssignmentId.set(null);
    this.editingAssignmentAsset.set(null);
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

  openEditAssignment(assignment: any) {
    if (!assignment || assignment.source !== 'ASSET' || assignment.status !== 'ACTIVE') return;
    this.editingAssignmentId.set(assignment.id);
    this.editingAssignmentAsset.set(assignment.itemAsset || this.assets().find(asset => asset.id === assignment.assetId) || null);
    this.assignForm = {
      assetId: assignment.assetId,
      employeeId: assignment.employeeId,
      assignedDate: this.toDateInput(assignment.assignedDate),
      conditionOnAssign: assignment.conditionOnAssign || 'GOOD',
      notes: assignment.notes || ''
    };
    this.isAssignDrawerOpen.set(true);
  }

  submitAssignmentChanges() {
    const assignmentId = this.editingAssignmentId();
    if (!assignmentId || !this.assignForm.employeeId) {
      this.toast.error('Please select an employee');
      return;
    }
    const { employeeId, assignedDate, conditionOnAssign, notes } = this.assignForm;
    this.assetService.updateAssignment(assignmentId, { employeeId, assignedDate, conditionOnAssign, notes }).subscribe({
      next: () => {
        this.toast.success('Assignment updated successfully');
        this.closeAssignmentDrawer();
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to update assignment')
    });
  }

  async deleteAssignment(assignment: any) {
    if (!assignment || assignment.source !== 'ASSET' || assignment.status !== 'ACTIVE') return;
    const name = assignment.itemAsset?.name || 'this assignment';
    const confirmed = await this.dialog.confirm(
      `Delete the assignment for "${name}"? The asset will be returned to available inventory. This cannot be undone.`,
      'Delete assignment',
      'Delete',
      'Cancel',
      'danger'
    );
    if (!confirmed) return;
    this.assetService.deleteAssignment(assignment.id).subscribe({
      next: () => {
        this.toast.success('Assignment deleted and asset returned to inventory');
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to delete assignment')
    });
  }

  private toDateInput(value: string | Date | undefined): string {
    if (!value) return new Date().toISOString().split('T')[0];
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date().toISOString().split('T')[0] : date.toISOString().split('T')[0];
  }

  closeAssignmentDrawer() {
    this.isAssignDrawerOpen.set(false);
    this.editingAssignmentId.set(null);
    this.editingAssignmentAsset.set(null);
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
      subject: '',
      reason: '',
      images: []
    };
    this.isRequestDrawerOpen.set(true);
  }

  openEditRequestDrawer(data: HardwareRequest) {
    this.closeRequestDetail();
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
      subject: data.subject || '',
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

  async deleteHardwareRequest(request: HardwareRequest) {
    const confirmed = await this.dialog.confirm(
      `This will permanently remove “${request.subject || request.reason || 'Hardware Request'}”. This action cannot be undone.`,
      'Delete hardware request?',
      'Delete request',
      'Keep request',
      'danger'
    );
    if (!confirmed) return;

    this.assetService.cancelHardwareRequest(request.id).subscribe({
      next: () => {
        this.closeRequestDetail();
        this.toast.success('Hardware request deleted');
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to delete request')
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
    if (!this.requestForm.subject.trim() || !this.requestForm.reason.trim()) {
      this.toast.error('Please add both a subject and justification for the hardware request');
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
    this.requestActionLoading.set(true);
    this.assetService.updateHardwareRequestStatus(requestId, { status, rejectionReason, fulfilledAssetId }).subscribe({
      next: () => {
        this.toast.success(`Request marked as ${status.toLowerCase()}`);
        this.isFulfillModalOpen.set(false);
        this.loadAllData();
        this.requestActionLoading.set(false);
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to update request');
        this.requestActionLoading.set(false);
      }
    });
  }
}
