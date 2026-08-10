import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { ClientsService } from '../../services/clients';
import { LucideBuilding, LucideMail, LucidePhone, LucideMapPin, LucideBriefcase, LucideDollarSign, LucideUsers, LucideCheckCircle2, LucideFileText } from '@lucide/angular';

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
  imports: [CommonModule, RouterModule, LucideBuilding, LucideMail, LucidePhone, LucideMapPin, LucideBriefcase, LucideDollarSign, LucideUsers, LucideCheckCircle2, LucideFileText],
  templateUrl: './client-profile.html',
  styleUrls: ['./client-profile.css']
})
export class ClientProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private clientsService = inject(ClientsService);

  client: Client | null = null;
  isLoading = true;
  activeTab = 'overview';

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
}
