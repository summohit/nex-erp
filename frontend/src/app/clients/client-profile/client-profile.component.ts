import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ClientsService } from '../../services/clients';
import { ProjectsService } from '../../services/projects';
import { LucideBuilding, LucideMail, LucidePhone, LucideMapPin, LucideBriefcase, LucideDollarSign, LucideCheckCircle2, LucideFileText, LucidePlus, LucideX } from '@lucide/angular';

interface Contact {
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
  imports: [CommonModule, FormsModule, RouterModule, LucideBuilding, LucideMail, LucidePhone, LucideMapPin, LucideBriefcase, LucideDollarSign, LucideCheckCircle2, LucideFileText, LucidePlus, LucideX],
  templateUrl: './client-profile.html',
  styleUrls: ['./client-profile.css']
})
export class ClientProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
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

  get filteredProjects(): any[] {
    const projects = this.client?.projects || [];
    const q = this.projectSearchQuery.trim().toLowerCase();
    return projects.filter((p: any) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (this.projectStatusFilter && p.status !== this.projectStatusFilter) return false;
      return true;
    });
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
}
