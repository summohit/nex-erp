import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AgGridModule } from 'ag-grid-angular';
import { ColDef } from 'ag-grid-community';
import { ClientsService } from '../../services/clients';
import { LucidePlus, LucideUploadCloud, LucideX } from '@lucide/angular';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';

@Component({
  selector: 'app-clients-list',
  standalone: true,
  imports: [CommonModule, RouterModule, AgGridModule, LucidePlus, LucideUploadCloud, LucideX, FormsModule, ReactiveFormsModule],
  templateUrl: './clients-list.html',
  styleUrls: ['./clients-list.css']
})
export class ClientsListComponent implements OnInit {
  private clientsService = inject(ClientsService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  clients: any[] = [];
  isLoading = true;

  // Grid
  columnDefs: ColDef[] = [
    {
      field: 'logo',
      headerName: 'Logo',
      width: 72,
      sortable: false,
      filter: false,
      cellRenderer: (params: any) => {
        const logo = params.data?.logo;
        const fallbackIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>`;
        if (logo) {
          return `<div class="client-logo-cell"><span class="client-logo-fallback" style="display:none">${fallbackIcon}</span><img src="${logo}" alt="" class="client-logo-img" onerror="this.style.display='none';this.previousElementSibling.style.display='flex'"></div>`;
        }
        return `<div class="client-logo-cell"><span class="client-logo-fallback">${fallbackIcon}</span></div>`;
      }
    },
    { 
      field: 'name', 
      headerName: 'Client Name', 
      flex: 2,
      cellRenderer: (params: any) => {
        return `<div class="cell-stacked">
                  <div class="cell-title-bold">${params.value}</div>
                  <div class="cell-subtitle-row">
                    <span class="tag-mono">${params.data.industry || 'No industry'}</span>
                  </div>
                </div>`;
      }
    },
    { 
      field: 'primaryContact', 
      headerName: 'Primary Contact', 
      flex: 1.5,
      valueGetter: (params: any) => {
        const primary = params.data.contacts?.find((c: any) => c.isPrimary) || params.data.contacts?.[0];
        return primary ? `${primary.firstName} ${primary.lastName || ''}`.trim() : 'N/A';
      },
      cellRenderer: (params: any) => {
        const primary = params.data.contacts?.find((c: any) => c.isPrimary) || params.data.contacts?.[0];
        const email = primary?.email || '';
        return `<div class="cell-stacked">
                  <div class="cell-title-bold" style="font-weight: 600; font-size: 13px; color: #475569">${params.value}</div>
                  ${email ? `<div class="cell-subtitle-row" style="margin-top: 0">${email}</div>` : ''}
                </div>`;
      }
    },
    { 
      field: 'status', 
      headerName: 'Status', 
      flex: 1,
      cellRenderer: (params: any) => {
        const s = params.value || '';
        let statusClass = 'status-pending';
        if (s === 'ACTIVE') statusClass = 'status-available';
        else if (s === 'LEAD') statusClass = 'status-assigned';
        else if (s === 'INACTIVE') statusClass = 'status-retired';
        
        return `
          <span class="status-pill ${statusClass}">
            <span class="status-dot"></span>
            ${s}
          </span>
        `;
      }
    },
    { 
      field: 'projects', 
      headerName: 'Projects', 
      flex: 1,
      valueGetter: (params: any) => params.data._count?.projects || 0
    },
    { 
      field: 'actions', 
      headerName: 'Actions', 
      width: 100, 
      sortable: false, 
      filter: false,
      pinned: 'right',
      cellRenderer: (params: any) => {
        return `<button class="btn btn-outline btn-xs" data-action="view" data-id="${params.data.id}">View</button>`;
      }
    }
  ];

  defaultColDef: ColDef = {
    sortable: true,
    filter: true,
    resizable: true,
  };

  // Drawer
  showDrawer = false;
  clientForm: FormGroup;
  isSubmitting = false;
  logoPreview = '';
  isDraggingLogo = false;

  constructor() {
    this.clientForm = this.fb.group({
      name: ['', Validators.required],
      logo: [''],
      industry: [''],
      website: [''],
      status: ['ACTIVE'],
      portalEnabled: [false],
      currency: ['INR'],
      paymentTerms: ['Net 30'],
      taxId: [''],
      registrationNo: [''],
      defaultHourlyRate: [null],
      creditLimit: [null],
      
      // Billing Address
      billingAddressLine1: [''],
      billingAddressLine2: [''],
      billingCity: [''],
      billingState: [''],
      billingZipCode: [''],
      billingCountry: [''],
      
      // Primary Contact
      contactFirstName: ['', Validators.required],
      contactLastName: [''],
      contactEmail: ['', [Validators.required, Validators.email]],
      contactPhone: ['']
    });
  }

  ngOnInit() {
    this.loadClients();
  }

  loadClients() {
    this.isLoading = true;
    this.clientsService.getClients().subscribe({
      next: (data) => {
        this.clients = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error loading clients', err);
        this.isLoading = false;
      }
    });
  }

  onGridReady(params: any) {
    params.api.sizeColumnsToFit();
  }

  onCellClicked(event: any) {
    if (event.event.target.getAttribute('data-action') === 'view' || event.column.getColId() === 'name') {
      const id = event.event.target.getAttribute('data-id') || event.data.id;
      this.router.navigate(['/clients', id]);
    }
  }

  openDrawer() {
    this.clientForm.reset({ status: 'ACTIVE', currency: 'INR', portalEnabled: false });
    this.logoPreview = '';
    this.showDrawer = true;
  }

  closeDrawer() {
    this.showDrawer = false;
  }

  onLogoFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.processLogoFile(input.files[0]);
    }
  }

  onLogoDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingLogo = true;
  }

  onLogoDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingLogo = false;
  }

  onLogoDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingLogo = false;
    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      this.processLogoFile(event.dataTransfer.files[0]);
    }
  }

  processLogoFile(file: File) {
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, SVG, WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.logoPreview = reader.result as string;
      this.clientForm.patchValue({ logo: this.logoPreview });
    };
    reader.readAsDataURL(file);
  }

  removeLogo(event: Event) {
    event.stopPropagation();
    this.logoPreview = '';
    this.clientForm.patchValue({ logo: '' });
  }

  onSubmit() {
    if (this.clientForm.invalid) return;

    this.isSubmitting = true;
    const formValue = this.clientForm.value;

    const payload = {
      name: formValue.name,
      logo: formValue.logo || this.logoPreview,
      industry: formValue.industry,
      website: formValue.website,
      status: formValue.status,
      portalEnabled: formValue.portalEnabled ?? false,
      currency: formValue.currency || 'INR',
      paymentTerms: formValue.paymentTerms,
      taxId: formValue.taxId,
      registrationNo: formValue.registrationNo,
      defaultHourlyRate: formValue.defaultHourlyRate,
      creditLimit: formValue.creditLimit,
      
      billingAddressLine1: formValue.billingAddressLine1,
      billingAddressLine2: formValue.billingAddressLine2,
      billingCity: formValue.billingCity,
      billingState: formValue.billingState,
      billingZipCode: formValue.billingZipCode,
      billingCountry: formValue.billingCountry,
      
      contacts: [
        {
          firstName: formValue.contactFirstName,
          lastName: formValue.contactLastName,
          email: formValue.contactEmail,
          phone: formValue.contactPhone,
          isPrimary: true,
          isBilling: true
        }
      ]
    };

    this.clientsService.createClient(payload).subscribe({
      next: () => {
        this.isSubmitting = false;
        this.closeDrawer();
        this.loadClients();
      },
      error: (err) => {
        console.error('Error creating client', err);
        this.isSubmitting = false;
      }
    });
  }
}
