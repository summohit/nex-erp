import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { EmployeeService } from '../../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import { ProfileTabComponent } from './profile-tab/profile-tab';
import { EmergencyContactsTabComponent } from './emergency-contacts-tab/emergency-contacts-tab';
import { DocumentsTabComponent } from './documents-tab/documents-tab';

@Component({
  selector: 'app-employee-profile',
  standalone: true,
  imports: [CommonModule, ProfileTabComponent, EmergencyContactsTabComponent, DocumentsTabComponent],
  templateUrl: './employee-profile.html',
  styleUrls: ['./employee-profile.css']
})
export class EmployeeProfileComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);

  activeTab = signal<'work' | 'resume' | 'personal' | 'contacts' | 'documents'>('work');
  employeeData = signal<any>(null);
  isLoading = signal(true);
  isOwner = signal(false);
  /** Server-resolved: the owner, HR, admins and designation-level profile editors. */
  canManageDocuments = signal(false);

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      let id = params.get('id');
      if (id) {
         this.loadProfile(id);
      }
    });
  }

  loadProfile(id: string) {
    this.isLoading.set(true);
    this.employeeService.getProfile(id).subscribe({
      next: (data) => {
        this.employeeData.set(data);
        this.isOwner.set(data.isOwner);
        // Fall back to isOwner: an endpoint that forgets the flag must never
        // hide someone's own documents from them.
        this.canManageDocuments.set(!!data.canManageDocuments || !!data.isOwner);
        this.isLoading.set(false);
      },
      error: (err) => {
        this.toast.error('Failed to load profile');
        this.isLoading.set(false);
      }
    });
  }

  setTab(tab: 'work' | 'resume' | 'personal' | 'contacts' | 'documents') {
    this.activeTab.set(tab);
  }
}
