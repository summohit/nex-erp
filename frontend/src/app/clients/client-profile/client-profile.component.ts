import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ClientsService } from '../../services/clients';
import { ProjectsService } from '../../services/projects';
import { 
  LucideBuilding, LucideMail, LucidePhone, LucideMapPin, LucideBriefcase, 
  LucideDollarSign, LucideCheckCircle2, LucideFileText, LucidePlus, LucideX, 
  LucideGlobe, LucideCalendar, LucideShieldCheck, LucideShieldAlert, 
  LucideExternalLink, LucideTrash2, LucideArchive, LucideRotateCcw, 
  LucideLayoutList, LucideUserCheck, LucideSearch, LucideCreditCard, 
  LucideClock, LucideAlertCircle, LucideEdit, LucideUploadCloud
} from '@lucide/angular';

interface Contact {
  id?: number;
  firstName: string;
  lastName?: string;
  email: string;
  phone?: string;
  mobile?: string;
  jobTitle?: string;
  isPrimary?: boolean;
  isBilling?: boolean;
}

interface Client {
  id: number;
  name: string;
  logo?: string;
  industry?: string;
  website?: string;
  status?: string;
  portalEnabled?: boolean;
  currency?: string;
  paymentTerms?: string;
  taxId?: string;
  registrationNo?: string;
  defaultHourlyRate?: number;
  creditLimit?: number;
  outstandingBalance?: number;
  billingAddressLine1?: string;
  billingAddressLine2?: string;
  billingCity?: string;
  billingState?: string;
  billingZipCode?: string;
  billingCountry?: string;
  contacts?: Contact[];
  projects?: any[];
  createdAt?: string;
}

@Component({
  selector: 'app-client-profile',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule, 
    LucideBuilding, LucideMail, LucidePhone, LucideMapPin, LucideBriefcase, 
    LucideDollarSign, LucideCheckCircle2, LucideFileText, LucidePlus, LucideX,
    LucideGlobe, LucideCalendar, LucideShieldCheck, LucideShieldAlert, 
    LucideExternalLink, LucideTrash2, LucideArchive, LucideRotateCcw, 
    LucideLayoutList, LucideUserCheck, LucideSearch, LucideCreditCard, 
    LucideClock, LucideAlertCircle, LucideEdit, LucideUploadCloud
  ],
  templateUrl: './client-profile.html',
  styleUrls: ['./client-profile.css']
})
export class ClientProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private clientsService = inject(ClientsService);
  private projectsService = inject(ProjectsService);

  client: Client | null = null;
  isLoading = true;
  activeTab = 'overview';

  linkModalOpen = false;
  isSavingLink = false;
  linkError = '';
  linkableProjects: any[] = [];
  selectedLinkProjectId: number | null = null;

  projectSearchQuery = '';
  projectStatusFilter = '';

  // Financials Modal
  financialsModalOpen = false;
  isSavingFinancials = false;
  financialsForm: any = {};

  // Contact Modal
  contactModalOpen = false;
  isSavingContact = false;
  isEditingContact = false;
  contactForm: any = {};

  // General Client Edit Modal
  editClientModalOpen = false;
  isSavingClientDetails = false;
  editClientForm: any = {};
  logoPreview = '';
  isDraggingLogo = false;

  get filteredProjects(): any[] {
    const projects = this.client?.projects || [];
    const q = this.projectSearchQuery.trim().toLowerCase();
    return projects.filter((p: any) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (this.projectStatusFilter && p.status !== this.projectStatusFilter) return false;
      return true;
    });
  }

  get primaryContact(): Contact | null {
    if (!this.client?.contacts?.length) return null;
    return this.client.contacts.find(c => c.isPrimary) || this.client.contacts[0];
  }

  get activeProjectsCount(): number {
    return (this.client?.projects || []).filter((p: any) => p.status === 'ACTIVE').length;
  }

  get formattedWebsiteUrl(): string {
    const url = this.client?.website?.trim();
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `https://${url}`;
  }

  getInitials(name?: string): string {
    if (!name) return 'CL';
    const words = name.trim().split(/\s+/);
    if (words.length === 1) return words[0].substring(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id) {
        this.loadClient(+id);
      }
    });
  }

  loadClient(id: number) {
    this.isLoading = true;
    this.clientsService.getClient(id).subscribe({
      next: (data) => {
        this.client = data;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error loading client profile', err);
        this.isLoading = false;
      }
    });
  }

  setTab(tab: string) {
    this.activeTab = tab;
  }

  openLinkProjectModal() {
    if (!this.client) return;
    this.linkError = '';
    this.selectedLinkProjectId = null;
    this.loadLinkableProjects();
    this.linkModalOpen = true;
  }

  loadLinkableProjects() {
    this.projectsService.getProjects().subscribe({
      next: (res: any[]) => {
        const linkedIds = new Set((this.client?.projects || []).map((p: any) => p.id));
        this.linkableProjects = (res || []).filter((p: any) => !linkedIds.has(p.id));
      },
      error: (err) => console.error('Error loading projects', err)
    });
  }

  linkProjectToClient() {
    this.linkError = '';
    if (!this.selectedLinkProjectId) {
      this.linkError = 'Please select a project to link.';
      return;
    }
    this.isSavingLink = true;
    this.projectsService.updateProject(this.selectedLinkProjectId, { clientId: this.client!.id }).subscribe({
      next: () => {
        this.isSavingLink = false;
        this.linkModalOpen = false;
        this.loadClient(this.client!.id);
      },
      error: (err) => {
        this.isSavingLink = false;
        this.linkError = err?.error?.message || 'Failed to link project. Please try again.';
        console.error('Error linking project', err);
      }
    });
  }

  openEditClientModal() {
    if (!this.client) return;
    this.editClientForm = {
      name: this.client.name,
      industry: this.client.industry || '',
      website: this.client.website || '',
      status: this.client.status || 'ACTIVE',
      portalEnabled: this.client.portalEnabled || false,
      currency: this.client.currency || 'INR',
      paymentTerms: this.client.paymentTerms || '',
      taxId: this.client.taxId || '',
      registrationNo: this.client.registrationNo || '',
      defaultHourlyRate: this.client.defaultHourlyRate || null,
      creditLimit: this.client.creditLimit || null,
      billingAddressLine1: this.client.billingAddressLine1 || '',
      billingAddressLine2: this.client.billingAddressLine2 || '',
      billingCity: this.client.billingCity || '',
      billingState: this.client.billingState || '',
      billingZipCode: this.client.billingZipCode || '',
      billingCountry: this.client.billingCountry || '',
      logo: this.client.logo || ''
    };
    this.logoPreview = this.client.logo || '';
    this.editClientModalOpen = true;
  }

  saveClientDetails(form: NgForm) {
    if (form.invalid) {
      Object.values(form.controls).forEach(control => {
        control.markAsTouched();
        control.markAsDirty();
      });
      setTimeout(() => {
        const firstInvalid = document.querySelector('input.ng-invalid, select.ng-invalid, textarea.ng-invalid, .is-invalid') as HTMLElement;
        if (firstInvalid) {
          firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstInvalid.focus();
        }
      }, 0);
      return;
    }
    
    if (!this.client || !this.editClientForm.name?.trim()) return;
    this.isSavingClientDetails = true;
    this.clientsService.updateClient(this.client.id, this.editClientForm).subscribe({
      next: () => {
        this.isSavingClientDetails = false;
        this.editClientModalOpen = false;
        this.loadClient(this.client!.id);
      },
      error: (err) => {
        this.isSavingClientDetails = false;
        console.error('Error updating client details', err);
      }
    });
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
      this.editClientForm.logo = this.logoPreview;
    };
    reader.readAsDataURL(file);
  }

  removeLogo(event: Event) {
    event.stopPropagation();
    this.logoPreview = '';
    this.editClientForm.logo = '';
  }

  archiveClient() {
    if (!this.client) return;
    if (!confirm(`Archive "${this.client.name}"? Archived clients are hidden from the active directory but can be restored anytime.`)) return;
    this.clientsService.archiveClient(this.client.id).subscribe({
      next: () => {
        this.loadClient(this.client!.id);
        alert('Client archived successfully.');
      },
      error: (err) => alert(err?.error?.message || 'Failed to archive client.')
    });
  }

  restoreClient() {
    if (!this.client) return;
    if (!confirm(`Restore "${this.client.name}" to active clients?`)) return;
    this.clientsService.restoreClient(this.client.id).subscribe({
      next: () => {
        this.loadClient(this.client!.id);
        alert('Client restored successfully.');
      },
      error: (err) => alert(err?.error?.message || 'Failed to restore client.')
    });
  }

  deleteClient() {
    if (!this.client) return;
    if (!confirm(`Are you sure you want to permanently delete "${this.client.name}"? This action cannot be undone.`)) return;
    this.clientsService.deleteClient(this.client.id).subscribe({
      next: () => {
        alert('Client deleted successfully.');
        this.router.navigate(['/clients']);
      },
      error: (err) => alert(err?.error?.message || 'Failed to delete client.')
    });
  }

  openFinancialsModal() {
    if (!this.client) return;
    this.financialsForm = {
      currency: this.client.currency || 'INR',
      paymentTerms: this.client.paymentTerms || '',
      taxId: this.client.taxId || '',
      registrationNo: this.client.registrationNo || '',
      defaultHourlyRate: this.client.defaultHourlyRate || null,
      creditLimit: this.client.creditLimit || null,
      billingAddressLine1: this.client.billingAddressLine1 || '',
      billingAddressLine2: this.client.billingAddressLine2 || '',
      billingCity: this.client.billingCity || '',
      billingState: this.client.billingState || '',
      billingZipCode: this.client.billingZipCode || '',
      billingCountry: this.client.billingCountry || '',
    };
    this.financialsModalOpen = true;
  }

  saveFinancials(form: import('@angular/forms').NgForm) {
    if (!this.client) return;
    
    if (form.invalid) {
      // Mark all controls as touched to show validation errors
      Object.keys(form.controls).forEach(key => {
        form.controls[key].markAsTouched();
      });
      setTimeout(() => {
        const firstInvalid = document.querySelector('input.ng-invalid, select.ng-invalid, textarea.ng-invalid, .is-invalid') as HTMLElement;
        if (firstInvalid) {
          firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstInvalid.focus();
        }
      }, 0);
      return;
    }

    this.isSavingFinancials = true;
    this.clientsService.updateClient(this.client.id, this.financialsForm).subscribe({
      next: () => {
        this.isSavingFinancials = false;
        this.financialsModalOpen = false;
        this.loadClient(this.client!.id);
      },
      error: (err) => {
        this.isSavingFinancials = false;
        alert(err?.error?.message || 'Failed to update financials.');
      }
    });
  }

  openContactModal(contact?: Contact) {
    if (contact) {
      this.isEditingContact = true;
      this.contactForm = { ...contact };
    } else {
      this.isEditingContact = false;
      this.contactForm = {
        firstName: '',
        lastName: '',
        email: '',
        phone: '',
        mobile: '',
        jobTitle: '',
        isPrimary: false,
        isBilling: false
      };
    }
    this.contactModalOpen = true;
  }

  saveContact(form: import('@angular/forms').NgForm) {
    if (!this.client) return;
    
    if (form.invalid) {
      Object.values(form.controls).forEach(control => {
        control.markAsTouched();
        control.markAsDirty();
      });
      setTimeout(() => {
        const firstInvalid = document.querySelector('input.ng-invalid, select.ng-invalid, textarea.ng-invalid, .is-invalid') as HTMLElement;
        if (firstInvalid) {
          firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
          firstInvalid.focus();
        }
      }, 0);
      return;
    }

    this.isSavingContact = true;
    const request = this.isEditingContact 
      ? this.clientsService.updateContact(this.client.id, this.contactForm.id, this.contactForm)
      : this.clientsService.addContact(this.client.id, this.contactForm);

    request.subscribe({
      next: () => {
        this.isSavingContact = false;
        this.contactModalOpen = false;
        this.loadClient(this.client!.id);
      },
      error: (err) => {
        this.isSavingContact = false;
        alert(err?.error?.message || 'Failed to save contact.');
      }
    });
  }

  deleteContact(contactId: number) {
    if (!this.client) return;
    if (!confirm('Are you sure you want to delete this contact?')) return;
    this.clientsService.deleteContact(this.client.id, contactId).subscribe({
      next: () => {
        this.loadClient(this.client!.id);
      },
      error: (err) => {
        alert(err?.error?.message || 'Failed to delete contact.');
      }
    });
  }

  unlinkProject(projectId: number) {
    if (!this.client) return;
    if (!confirm('Are you sure you want to unlink this project?')) return;
    this.projectsService.updateProject(projectId, { clientId: null }).subscribe({
      next: () => {
        this.loadClient(this.client!.id);
      },
      error: (err) => {
        alert(err?.error?.message || 'Failed to unlink project.');
      }
    });
  }
}
