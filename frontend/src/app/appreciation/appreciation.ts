import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef, ValueFormatterParams } from 'ag-grid-community';
import { AppreciationService, Appreciation, AwardType } from '../services/appreciation.service';
import { EmployeeService, Employee } from '../services/employee.service';
import { UploadService } from '../services/upload.service';
import { AuthService } from '../services/auth.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ActionCellRendererComponent } from '../shared/components/action-cell-renderer.component';
import { 
  LucideTrophy, 
  LucideStar, 
  LucideRibbon,
  LucidePlus,
  LucideDownload,
  LucideX,
  LucideUploadCloud
} from '@lucide/angular';

@Component({
  selector: 'app-appreciation',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    AgGridModule,
    LucideTrophy,
    LucideStar,
    LucideRibbon,
    LucidePlus,
    LucideDownload,
    LucideX,
    LucideUploadCloud
  ],
  providers: [DatePipe],
  templateUrl: './appreciation.html',
  styleUrls: ['./appreciation.css']
})
export class AppreciationComponent implements OnInit {
  private appreciationService = inject(AppreciationService);
  private employeeService = inject(EmployeeService);
  private uploadService = inject(UploadService);
  public authService = inject(AuthService);
  private toast = inject(HotToastService);
  private datePipe = inject(DatePipe);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  activeTab = signal<'list' | 'types'>('list');
  appreciations = signal<Appreciation[]>([]);
  awardTypes = signal<AwardType[]>([]);
  employees = signal<Employee[]>([]);

  isAdmin = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
  });

  // AG Grid Configuration
  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true
  };

  appreciationColDefs: ColDef[] = [
    {
      field: 'employee',
      headerName: 'Given To',
      minWidth: 240,
      flex: 1.5,
      cellRenderer: (params: any) => {
        const emp = params.data?.employee;
        if (!emp) return 'N/A';
        const name = `${emp.firstName} ${emp.lastName || ''}`;
        const desig = emp.designation?.name || 'Team Member';
        const avatar = emp.avatarUrl || 'assets/default-avatar.png';
        return `
          <div style="display: flex; align-items: center; gap: 10px; height: 100%;">
            <img src="${avatar}" style="width: 34px; height: 34px; border-radius: 50%; object-fit: cover; border: 1px solid #E2E8F0;" />
            <div style="line-height: 1.2;">
              <div style="font-weight: 700; color: #0F172A; font-size: 13.5px;">${name}</div>
              <div style="font-size: 11.5px; color: #64748B;">${desig}</div>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'awardType.title',
      headerName: 'Award Name',
      minWidth: 220,
      flex: 1.5,
      cellRenderer: (params: any) => {
        const award = params.data?.awardType;
        if (!award) return 'N/A';
        const color = award.color || 'orange';
        const colorMap: Record<string, { bg: string; text: string; border: string }> = {
          orange: { bg: '#FFF7ED', text: '#FF5200', border: '#FFEDD5' },
          blue: { bg: '#EFF6FF', text: '#2563EB', border: '#DBEAFE' },
          green: { bg: '#F0FDF4', text: '#16A34A', border: '#DCFCE7' },
          purple: { bg: '#F3E8FF', text: '#9333EA', border: '#E9D5FF' },
          red: { bg: '#FEF2F2', text: '#EF4444', border: '#FEE2E2' },
          yellow: { bg: '#FEFCE8', text: '#CA8A04', border: '#FEF08A' }
        };
        const theme = colorMap[color] || colorMap['orange'];
        return `
          <div style="display: flex; align-items: center; gap: 10px; height: 100%;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: ${theme.bg}; color: ${theme.text}; border: 1px solid ${theme.border}; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg>
            </div>
            <span style="font-weight: 700; color: #0F172A;">${award.title}</span>
          </div>
        `;
      }
    },
    {
      field: 'givenDate',
      headerName: 'Given On',
      minWidth: 140,
      flex: 1,
      valueFormatter: (params: ValueFormatterParams) => {
        if (!params.value) return '-';
        const d = new Date(params.value);
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        return `${day}-${month}-${year}`;
      }
    },
    {
      headerName: 'Actions',
      minWidth: 100,
      flex: 0.8,
      pinned: 'right',
      sortable: false,
      filter: false,
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onView: (data: any) => this.openDetailModal(data),
        viewLabel: 'View Appreciation',
        onDelete: this.isAdmin() ? (data: any) => this.deleteAppreciation(data.id, new Event('click')) : undefined
      }
    }
  ];

  awardTypeColDefs: ColDef[] = [
    {
      field: 'color',
      headerName: 'Award Icon',
      minWidth: 120,
      flex: 1,
      cellRenderer: (params: any) => {
        const color = params.data?.color || 'orange';
        const colorMap: Record<string, { bg: string; text: string; border: string }> = {
          orange: { bg: '#FFF7ED', text: '#FF5200', border: '#FFEDD5' },
          blue: { bg: '#EFF6FF', text: '#2563EB', border: '#DBEAFE' },
          green: { bg: '#F0FDF4', text: '#16A34A', border: '#DCFCE7' },
          purple: { bg: '#F3E8FF', text: '#9333EA', border: '#E9D5FF' },
          red: { bg: '#FEF2F2', text: '#EF4444', border: '#FEE2E2' },
          yellow: { bg: '#FEFCE8', text: '#CA8A04', border: '#FEF08A' }
        };
        const theme = colorMap[color] || colorMap['orange'];
        return `
          <div style="display: flex; align-items: center; height: 100%;">
            <div style="width: 36px; height: 36px; border-radius: 10px; background: ${theme.bg}; color: ${theme.text}; border: 1px solid ${theme.border}; display: flex; align-items: center; justify-content: center;">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path><path d="M4 22h16"></path><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path></svg>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'title',
      headerName: 'Title',
      minWidth: 250,
      flex: 2,
      cellStyle: { fontWeight: '700', color: '#0F172A', display: 'flex', alignItems: 'center' }
    },
    {
      field: 'status',
      headerName: 'Status',
      minWidth: 140,
      flex: 1,
      cellRenderer: (params: any) => {
        const active = params.value;
        if (active) {
          return `
            <div style="display: flex; align-items: center; height: 100%;">
              <span style="background: #ECFDF5; color: #059669; border: 1px solid #A7F3D0; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; line-height: 1;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #10B981; display: inline-block;"></span>
                Active
              </span>
            </div>
          `;
        } else {
          return `
            <div style="display: flex; align-items: center; height: 100%;">
              <span style="background: #FEF2F2; color: #DC2626; border: 1px solid #FECACA; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 6px; line-height: 1;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #EF4444; display: inline-block;"></span>
                Inactive
              </span>
            </div>
          `;
        }
      }
    },
    {
      headerName: 'Actions',
      minWidth: 100,
      flex: 0.8,
      pinned: 'right',
      sortable: false,
      filter: false,
      hide: !this.isAdmin(),
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onEdit: (data: any) => this.openEditTypeModal(data),
        editLabel: 'Edit Category',
        onDelete: (data: any) => this.deleteAwardType(data.id)
      }
    }
  ];

  onCellClicked(event: any) {
    const target = event.event?.target as HTMLElement;
    if (!target) return;
    const btn = target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const id = Number(btn.getAttribute('data-id'));

    if (action === 'view') {
      const appr = this.appreciations().find(a => a.id === id);
      if (appr) this.openDetailModal(appr);
    } else if (action === 'delete') {
      this.deleteAppreciation(id, event.event);
    } else if (action === 'edit-type') {
      const type = this.awardTypes().find(t => t.id === id);
      if (type) this.openEditTypeModal(type);
    } else if (action === 'delete-type') {
      this.deleteAwardType(id);
    }
  }

  // Modal & Menu States
  openMenuId = signal<number | null>(null);
  isDetailModalOpen = signal<boolean>(false);
  selectedAppreciation = signal<Appreciation | null>(null);

  toggleActionMenu(id: number, event: Event) {
    event.stopPropagation();
    if (this.openMenuId() === id) {
      this.openMenuId.set(null);
    } else {
      this.openMenuId.set(id);
    }
  }

  closeActionMenu() {
    this.openMenuId.set(null);
  }

  isGiveModalOpen = signal<boolean>(false);
  isSubmittingGive = signal<boolean>(false);
  selectedFile: File | null = null;
  giveForm = {
    employeeId: '',
    awardTypeId: '',
    givenDate: new Date().toISOString().split('T')[0],
    summary: '',
    photoUrl: ''
  };

  isTypeModalOpen = signal<boolean>(false);
  isSubmittingType = signal<boolean>(false);
  typeForm = {
    id: 0,
    title: '',
    icon: 'trophy',
    color: 'orange',
    status: true
  };

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const tab = params.get('tab');
      if (tab === 'types') {
        this.activeTab.set('types');
      } else {
        this.activeTab.set('list');
      }
    });

    this.loadData();
  }

  setTab(tab: 'list' | 'types') {
    this.activeTab.set(tab);
    this.router.navigate(['/appreciation', tab]);
  }

  loadData() {
    this.appreciationService.getAppreciations().subscribe({
      next: (res) => this.appreciations.set(res),
      error: () => this.toast.error('Failed to load appreciations')
    });

    this.appreciationService.getAwardTypes().subscribe({
      next: (res) => this.awardTypes.set(res),
      error: () => this.toast.error('Failed to load award categories')
    });

    this.employeeService.getEmployees().subscribe({
      next: (res) => this.employees.set(res)
    });
  }

  // --- View Details ---
  openDetailModal(appr: Appreciation) {
    this.selectedAppreciation.set(appr);
    this.isDetailModalOpen.set(true);
  }

  closeDetailModal() {
    this.isDetailModalOpen.set(false);
    this.selectedAppreciation.set(null);
  }

  giveSubmitted = signal<boolean>(false);

  // --- Give Appreciation ---
  openGiveModal() {
    this.giveForm = {
      employeeId: '',
      awardTypeId: '',
      givenDate: new Date().toISOString().split('T')[0],
      summary: '',
      photoUrl: ''
    };
    this.giveSubmitted.set(false);
    this.selectedFile = null;
    this.isGiveModalOpen.set(true);
  }

  closeGiveModal() {
    this.isGiveModalOpen.set(false);
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      this.uploadService.uploadFile(file).subscribe({
        next: (res) => {
          this.giveForm.photoUrl = res.url;
          this.toast.success('Certificate/Photo uploaded successfully');
        },
        error: () => this.toast.error('Failed to upload photo')
      });
    }
  }

  saveGiveAppreciation() {
    this.giveSubmitted.set(true);
    if (!this.giveForm.employeeId || !this.giveForm.awardTypeId || !this.giveForm.givenDate || !this.giveForm.summary.trim()) {
      this.toast.error('Please fill all required fields');
      return;
    }

    this.isSubmittingGive.set(true);
    this.appreciationService.createAppreciation(this.giveForm).subscribe({
      next: () => {
        this.toast.success('Appreciation awarded successfully!');
        this.closeGiveModal();
        this.loadData();
        this.isSubmittingGive.set(false);
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to grant appreciation');
        this.isSubmittingGive.set(false);
      }
    });
  }

  deleteAppreciation(id: number, event: Event) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this appreciation?')) return;
    this.appreciationService.deleteAppreciation(id).subscribe({
      next: () => {
        this.toast.success('Appreciation record deleted');
        this.loadData();
      },
      error: () => this.toast.error('Failed to delete appreciation')
    });
  }

  // --- Award Types CRUD ---
  openAddTypeModal() {
    this.typeForm = { id: 0, title: '', icon: 'trophy', color: 'orange', status: true };
    this.isTypeModalOpen.set(true);
  }

  openEditTypeModal(type: AwardType) {
    this.typeForm = { ...type };
    this.isTypeModalOpen.set(true);
  }

  closeTypeModal() {
    this.isTypeModalOpen.set(false);
  }

  saveAwardType() {
    if (!this.typeForm.title.trim()) {
      this.toast.error('Award title is required');
      return;
    }

    this.isSubmittingType.set(true);
    if (this.typeForm.id) {
      this.appreciationService.updateAwardType(this.typeForm.id, this.typeForm).subscribe({
        next: () => {
          this.toast.success('Award Category updated');
          this.closeTypeModal();
          this.loadData();
          this.isSubmittingType.set(false);
        },
        error: () => {
          this.toast.error('Failed to update award category');
          this.isSubmittingType.set(false);
        }
      });
    } else {
      this.appreciationService.createAwardType(this.typeForm).subscribe({
        next: () => {
          this.toast.success('New Award Category created');
          this.closeTypeModal();
          this.loadData();
          this.isSubmittingType.set(false);
        },
        error: () => {
          this.toast.error('Failed to create award category');
          this.isSubmittingType.set(false);
        }
      });
    }
  }

  deleteAwardType(id: number) {
    if (!confirm('Are you sure you want to delete this award category?')) return;
    this.appreciationService.deleteAwardType(id).subscribe({
      next: () => {
        this.toast.success('Award category deleted');
        this.loadData();
      },
      error: () => this.toast.error('Failed to delete award category')
    });
  }

  exportToCsv() {
    const list = this.appreciations();
    if (list.length === 0) {
      this.toast.error('No appreciations to export');
      return;
    }

    let csv = 'Employee Name,Designation,Award Name,Given On,Summary\n';
    list.forEach(a => {
      const empName = `"${a.employee.firstName} ${a.employee.lastName}"`;
      const desig = `"${a.employee.designation?.name || '-'}"`;
      const award = `"${a.awardType?.title || '-'}"`;
      const date = `"${this.datePipe.transform(a.givenDate, 'dd-MM-yyyy')}"`;
      const summary = `"${a.summary.replace(/"/g, '""')}"`;
      csv += `${empName},${desig},${award},${date},${summary}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `appreciations_export_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
