import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { CdkDragDrop, DragDropModule, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { 
  LucidePlus, 
  LucideGripVertical, 
  LucideBuilding, 
  LucidePhone, 
  LucideMail, 
  LucideDollarSign, 
  LucideCheckCircle, 
  LucideX, 
  LucideLoader2,
  LucideSearch,
  LucideUser,
  LucideTrash2,
  LucideFilter
} from '@lucide/angular';

interface Lead {
  id: number;
  title: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  value: number;
  currency: string;
  status: string;
  createdAt: string;
}

@Component({
  selector: 'app-leads',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    DragDropModule, 
    LucidePlus, 
    LucideGripVertical, 
    LucideBuilding, 
    LucidePhone, 
    LucideMail, 
    LucideDollarSign, 
    LucideCheckCircle, 
    LucideX, 
    LucideLoader2,
    LucideSearch,
    LucideUser,
    LucideTrash2,
    LucideFilter
  ],
  templateUrl: './leads.html',
  styleUrls: ['./leads.css']
})
export class LeadsComponent implements OnInit {
  leads: Lead[] = [];
  
  // Filter states
  searchQuery = '';
  selectedStage = 'ALL';

  // Kanban columns
  newLeads: Lead[] = [];
  qualifiedLeads: Lead[] = [];
  proposalLeads: Lead[] = [];
  wonLeads: Lead[] = [];
  lostLeads: Lead[] = [];

  showCreateModal = false;
  isSubmitted = false;
  isSaving = false;
  isLoading = true;

  newLeadData = {
    title: '',
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    value: 0,
    currency: 'INR'
  };

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadLeads();
  }

  loadLeads() {
    this.isLoading = true;
    this.http.get<Lead[]>(`${environment.apiUrl}/crm/leads`).subscribe(data => {
      this.leads = data;
      this.distributeLeads();
      this.isLoading = false;
    }, error => {
      this.isLoading = false;
      console.error('Failed to load leads', error);
    });
  }

  getFilteredLeads(): Lead[] {
    return this.leads.filter(lead => {
      const matchesSearch = 
        !this.searchQuery.trim() ||
        lead.title?.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        lead.companyName?.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        lead.contactName?.toLowerCase().includes(this.searchQuery.toLowerCase()) ||
        lead.email?.toLowerCase().includes(this.searchQuery.toLowerCase());

      const matchesStage = 
        this.selectedStage === 'ALL' || lead.status === this.selectedStage;

      return matchesSearch && matchesStage;
    });
  }

  distributeLeads() {
    const filtered = this.getFilteredLeads();
    this.newLeads = filtered.filter(l => l.status === 'NEW');
    this.qualifiedLeads = filtered.filter(l => l.status === 'QUALIFIED');
    this.proposalLeads = filtered.filter(l => l.status === 'PROPOSAL');
    this.wonLeads = filtered.filter(l => l.status === 'WON');
    this.lostLeads = filtered.filter(l => l.status === 'LOST');
  }

  onFilterChange() {
    this.distributeLeads();
  }

  clearFilters() {
    this.searchQuery = '';
    this.selectedStage = 'ALL';
    this.distributeLeads();
  }

  getTotalPipelineValue(): number {
    return this.leads.reduce((sum, lead) => sum + (Number(lead.value) || 0), 0);
  }

  drop(event: CdkDragDrop<Lead[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex,
      );

      // Status update logic based on container ID
      const newStatus = event.container.id; 
      const lead = event.container.data[event.currentIndex];
      
      lead.status = newStatus;
      this.http.put(`${environment.apiUrl}/crm/leads/${lead.id}/status`, { status: newStatus }).subscribe(() => {
        // Reload to update pipeline metrics
        this.loadLeads();
      });
    }
  }

  openModal() {
    this.showCreateModal = true;
    this.isSubmitted = false;
    this.isSaving = false;
    this.newLeadData = { title: '', companyName: '', contactName: '', email: '', phone: '', value: 0, currency: 'INR' };
  }

  closeModal() {
    if (this.isSaving) return;
    this.showCreateModal = false;
    this.isSubmitted = false;
  }

  createLead() {
    this.isSubmitted = true;

    // Validation: Title, Company Name, Email, and Phone are required
    if (
      !this.newLeadData.title.trim() || 
      !this.newLeadData.companyName.trim() ||
      !this.newLeadData.email.trim() ||
      !this.newLeadData.phone.trim()
    ) {
      return;
    }

    this.isSaving = true;

    this.http.post(`${environment.apiUrl}/crm/leads`, this.newLeadData).subscribe({
      next: () => {
        this.isSaving = false;
        this.closeModal();
        this.loadLeads();
      },
      error: (err) => {
        this.isSaving = false;
        alert(err?.error?.message || 'Failed to save lead.');
      }
    });
  }

  deleteLead(id: number, event: Event) {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this lead?')) {
      this.http.delete(`${environment.apiUrl}/crm/leads/${id}`).subscribe(() => {
        this.loadLeads();
      });
    }
  }
}
