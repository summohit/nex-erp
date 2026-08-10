import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import { MatMenuModule } from '@angular/material/menu';
import { AssetService, Asset, AssetAssignment, HardwareRequest } from '../services/asset.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { UploadService } from '../services/upload.service';
import { AuthService } from '../services/auth.service';
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
  LucideImage
} from '@lucide/angular';

import { AssetActionCellRendererComponent } from '../shared/components/asset-action-cell-renderer.component';

function getCategoryClass(cat: string): string {
  const c = (cat || '').toLowerCase();
  if (['laptop', 'desktop', 'monitor', 'software', 'mobile', 'peripheral'].includes(c)) {
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
    LucideUploadCloud
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
  private toast = inject(HotToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  // State Signals
  activeTab = signal<'inventory' | 'assignments' | 'requests'>('inventory');
  assets = signal<Asset[]>([]);
  assignments = signal<AssetAssignment[]>([]);
  requests = signal<HardwareRequest[]>([]);
  employees = signal<Employee[]>([]);

  // User Auth Role
  currentUser = signal<any>(null);
  isAdmin = computed(() => {
    const r = this.currentUser()?.role;
    return r === 'SUPERADMIN' || r === 'ADMIN' || r === 'HR';
  });
  isSuperAdmin = computed(() => {
    return this.currentUser()?.role === 'SUPERADMIN';
  });

  // KPI Metrics
  totalAssetsCount = computed(() => this.assets().length);
  assignedAssetsCount = computed(() => this.assets().filter(a => a.status === 'ASSIGNED').length);
  availableAssetsCount = computed(() => this.assets().filter(a => a.status === 'AVAILABLE').length);
  inRepairAssetsCount = computed(() => this.assets().filter(a => a.status === 'IN_REPAIR').length);
  pendingRequestsCount = computed(() => this.requests().filter(r => r.status === 'PENDING').length);

  // Filter Query
  searchQuery = signal<string>('');

  // Available Assets for assignment dropdown
  availableAssets = computed(() => this.assets().filter(a => a.status === 'AVAILABLE'));

  // Drawer & Modal States
  isAssetDrawerOpen = signal<boolean>(false);
  isAssignDrawerOpen = signal<boolean>(false);
  isReturnModalOpen = signal<boolean>(false);
  isRequestDrawerOpen = signal<boolean>(false);
  isFulfillModalOpen = signal<boolean>(false);
  isRejectModalOpen = signal<boolean>(false);

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
    brand: '',
    model: '',
    serialNumber: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    cost: 0,
    warrantyExpiry: '',
    images: [] as string[],
    status: 'AVAILABLE'
  };

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

  // AG Grid Inventory Columns
  inventoryColDefs: ColDef[] = [
    {
      headerName: 'Asset Tag & Name',
      field: 'name',
      flex: 1.8,
      minWidth: 240,
      cellRenderer: (params: any) => {
        if (!params.data) return '';
        const cat = params.data.category || '';
        const catClass = getCategoryClass(cat);

        return `
          <div class="cell-stacked">
            <div class="cell-title-bold">${params.data.name}</div>
            <div class="cell-subtitle-row">
              <span class="tag-mono">${params.data.assetTag}</span>
              <span class="cat-badge ${catClass}">${cat}</span>
            </div>
          </div>
        `;
      }
    },
    {
      headerName: 'Brand & Model',
      field: 'brand',
      flex: 1.4,
      minWidth: 160,
      valueGetter: (params: any) => {
        const b = params.data?.brand || '';
        const m = params.data?.model || '';
        return b || m ? `${b} ${m}`.trim() : '-';
      }
    },
    { headerName: 'Serial No.', field: 'serialNumber', flex: 1.1, minWidth: 120, valueFormatter: p => p.value || '-' },
    {
      headerName: 'Cost',
      field: 'cost',
      flex: 0.9,
      minWidth: 100,
      valueFormatter: (params: any) => params.value ? `₹${params.value.toLocaleString('en-IN')}` : '-'
    },
    {
      headerName: 'Status',
      field: 'status',
      flex: 1.1,
      minWidth: 120,
      cellRenderer: (params: any) => {
        const s = params.value || '';
        const statusClass = getStatusClass(s);

        return `
          <span class="status-pill ${statusClass}">
            <span class="status-dot"></span>
            ${s}
          </span>
        `;
      }
    },
    {
      headerName: 'Current Assignee',
      field: 'assignments',
      flex: 1.3,
      minWidth: 140,
      valueGetter: (params: any) => {
        const active = params.data?.assignments?.[0]?.employee;
        return active ? `${active.firstName} ${active.lastName}` : 'Unassigned';
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
        onEdit: (data: Asset) => this.openEditAssetDrawer(data),
        onAssign: (data: Asset) => this.openAssignDrawer(data.id),
        onDelete: (data: Asset) => this.deleteAsset(data.id)
      }
    }
  ];

  // AG Grid Assignments Columns
  assignmentsColDefs: ColDef[] = [
    {
      headerName: 'Asset Details',
      field: 'asset.name',
      flex: 1.5,
      minWidth: 220,
      cellRenderer: (params: any) => {
        const a = params.data?.asset;
        if (!a) return '-';
        const cat = a.category || '';
        const catClass = getCategoryClass(cat);
        return `
          <div class="cell-stacked">
            <div class="cell-title-bold">${a.name}</div>
            <div class="cell-subtitle-row">
              <span class="tag-mono">${a.assetTag}</span>
              ${cat ? `<span class="cat-badge ${catClass}">${cat}</span>` : ''}
            </div>
          </div>
        `;
      }
    },
    {
      headerName: 'Assigned Employee',
      field: 'employee',
      valueFormatter: (p) => p.value ? (p.value.lastName ? `${p.value.firstName} ${p.value.lastName}` : p.value.firstName) : '',
      flex: 1.4,
      minWidth: 200,
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
      valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
    },
    { 
      headerName: 'Condition', 
      field: 'conditionOnAssign', 
      flex: 1,
      minWidth: 120,
      cellRenderer: (params: any) => {
        const c = params.value || 'GOOD';
        const condClass = getConditionClass(c);
        const label = c.replace('_', ' ');
        return `
          <span class="badge-condition ${condClass}">
            ${label}
          </span>
        `;
      }
    },
    {
      headerName: 'Return Date',
      field: 'returnDate',
      flex: 1,
      minWidth: 120,
      valueFormatter: (params: any) => params.value ? new Date(params.value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'
    },
    {
      headerName: 'Status',
      field: 'status',
      flex: 1,
      minWidth: 120,
      cellRenderer: (params: any) => {
        const s = params.value;
        const isAssigned = s === 'ACTIVE';
        const statusClass = isAssigned ? 'status-assigned' : 'status-returned';
        return `
          <span class="status-round ${statusClass}">
            <span class="status-dot"></span>
            ${isAssigned ? 'ASSIGNED' : 'RETURNED'}
          </span>
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
        onReturn: (data: AssetAssignment) => {
          if (data.status === 'ACTIVE' && this.isAdmin()) {
            this.openReturnModal(data.id);
          }
        }
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
        canCancel: (data: HardwareRequest) => data.status === 'PENDING' && (this.isSelfRequest(data) || this.isSuperAdmin()),
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
    const user = this.authService.currentUser();
    if (user) {
      this.currentUser.set(user);
    } else {
      this.authService.getMe().subscribe(u => {
        this.currentUser.set(u);
        if (!this.isAdmin()) {
          this.activeTab.set('requests');
        }
      });
    }

    // Tab parameter check
    this.route.params.subscribe(params => {
      if (params['tab']) {
        const tab = params['tab'] as 'inventory' | 'assignments' | 'requests';
        if (!this.isAdmin() && (tab === 'inventory' || tab === 'assignments')) {
          this.activeTab.set('requests');
        } else {
          this.activeTab.set(tab);
        }
      } else if (!this.isAdmin()) {
        this.activeTab.set('requests');
      }
    });

    this.loadAllData();
  }

  setTab(tab: 'inventory' | 'assignments' | 'requests') {
    this.activeTab.set(tab);
    this.router.navigate(['/assets', tab]);
  }

  loadAllData() {
    this.assetService.getAllAssets().subscribe(res => this.assets.set(res));
    this.assetService.getAssignments().subscribe(res => this.assignments.set(res));
    this.assetService.getHardwareRequests().subscribe(res => this.requests.set(res));
    this.employeeService.getEmployees().subscribe(res => this.employees.set(res));
  }

  // 1. Asset Drawer Actions
  openAddAssetDrawer() {
    this.assetForm = {
      id: 0,
      assetTag: '',
      name: '',
      category: 'LAPTOP',
      brand: '',
      model: '',
      serialNumber: '',
      purchaseDate: new Date().toISOString().split('T')[0],
      cost: 0,
      warrantyExpiry: '',
      images: [],
      status: 'AVAILABLE'
    };
    this.isAssetDrawerOpen.set(true);
  }

  openEditAssetDrawer(asset: Asset) {
    this.assetForm = {
      id: asset.id,
      assetTag: asset.assetTag,
      name: asset.name,
      category: asset.category,
      brand: asset.brand || '',
      model: asset.model || '',
      serialNumber: asset.serialNumber || '',
      purchaseDate: asset.purchaseDate ? asset.purchaseDate.split('T')[0] : '',
      cost: asset.cost || 0,
      warrantyExpiry: asset.warrantyExpiry ? asset.warrantyExpiry.split('T')[0] : '',
      images: asset.images ? [...asset.images] : [],
      status: asset.status
    };
    this.isAssetDrawerOpen.set(true);
  }

  onFileSelected(event: any) {
    const files: FileList = event.target.files;
    if (!files || files.length === 0) return;

    Array.from(files).forEach(file => {
      this.uploadService.uploadFile(file).subscribe({
        next: (res) => {
          if (res?.url) {
            this.assetForm.images.push(res.url);
            this.toast.success(`Image uploaded`);
          }
        },
        error: () => this.toast.error('Failed to upload image')
      });
    });
  }

  removeImage(index: number) {
    this.assetForm.images.splice(index, 1);
  }

  saveAsset() {
    if (!this.assetForm.name) {
      this.toast.error('Asset Name is required');
      return;
    }

    if (this.assetForm.id > 0) {
      this.assetService.updateAsset(this.assetForm.id, this.assetForm).subscribe({
        next: () => {
          this.toast.success('Asset updated successfully');
          this.isAssetDrawerOpen.set(false);
          this.loadAllData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Failed to update asset')
      });
    } else {
      this.assetService.createAsset(this.assetForm).subscribe({
        next: () => {
          this.toast.success('Asset created successfully');
          this.isAssetDrawerOpen.set(false);
          this.loadAllData();
        },
        error: (err) => this.toast.error(err.error?.message || 'Failed to create asset')
      });
    }
  }

  deleteAsset(id: number) {
    if (!confirm('Are you sure you want to delete this asset from inventory?')) return;
    this.assetService.deleteAsset(id).subscribe({
      next: () => {
        this.toast.success('Asset deleted');
        this.loadAllData();
      },
      error: (err) => this.toast.error(err.error?.message || 'Failed to delete asset')
    });
  }

  // 2. Assignment Drawer Actions
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

  // 3. Image Viewer Lightbox Methods
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

  // 4. Hardware Request Actions
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

    Array.from(files).forEach(file => {
      this.uploadService.uploadFile(file).subscribe({
        next: (res) => {
          if (res?.url) {
            this.requestForm.images.push(res.url);
            this.toast.success('Attachment uploaded');
          }
        },
        error: () => this.toast.error('Failed to upload attachment')
      });
    });
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
