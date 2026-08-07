import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucidePlus } from '@lucide/angular';
import { EmployeeService } from '../../../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ModuleRegistry, AllCommunityModule } from 'ag-grid-community';
import { ActionCellRendererComponent } from '../../../shared/components/action-cell-renderer.component';

ModuleRegistry.registerModules([AllCommunityModule]);

@Component({
  selector: 'app-emergency-contacts-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, LucidePlus, AgGridAngular],
  templateUrl: './emergency-contacts-tab.html',
  styleUrls: ['./emergency-contacts-tab.css']
})
export class EmergencyContactsTabComponent implements OnInit {
  @Input() employeeData: any;
  @Input() isOwner: boolean = false;
  @Output() refreshProfile = new EventEmitter<void>();

  showModal = false;
  submitted = false;
  newContact: any = {
    name: '',
    email: '',
    mobile: '',
    relationship: 'Father'
  };

  columnDefs: ColDef[] = [];
  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  constructor(private employeeService: EmployeeService, private toast: HotToastService) {}

  ngOnInit() {
    this.columnDefs = [
      { 
        field: 'name', 
        headerName: 'Name', 
        flex: 1, 
        minWidth: 150,
        headerCheckboxSelection: true,
        checkboxSelection: true
      },
      { field: 'email', headerName: 'Email', flex: 1, minWidth: 200, valueFormatter: p => p.value || '-' },
      { field: 'mobile', headerName: 'Mobile', flex: 1, minWidth: 150 },
      { field: 'relationship', headerName: 'Relationship', flex: 1, minWidth: 150 }
    ];

    if (this.isOwner) {
      this.columnDefs.push({
        headerName: 'Action',
        width: 100,
        flex: 0,
        cellRenderer: ActionCellRendererComponent,
        cellRendererParams: {
          onDelete: (data: any) => this.deleteContact(data.id)
        },
        sortable: false,
        filter: false,
        pinned: 'right'
      });
    }
  }

  openModal() {
    this.showModal = true;
    this.submitted = false;
    this.newContact = {
      name: '',
      email: '',
      mobile: '',
      relationship: 'Father'
    };
  }

  closeModal() {
    this.showModal = false;
  }

  saveContact() {
    this.submitted = true;
    if (!this.newContact.name || !this.newContact.mobile) {
      this.toast.error('Name and Mobile are required');
      return;
    }

    const nameRegex = /^[a-zA-Z\s.'-]+$/;
    if (!nameRegex.test(this.newContact.name.trim())) {
      this.toast.error('Please enter a valid name (letters only)');
      return;
    }

    const phoneRegex = /^\+?[0-9\s\-()]{7,15}$/;
    if (!phoneRegex.test(this.newContact.mobile)) {
      this.toast.error('Please enter a valid mobile number');
      return;
    }
    
    this.employeeService.addContact(this.employeeData.id, this.newContact).subscribe({
      next: () => {
        this.toast.success('Contact added');
        this.closeModal();
        this.refreshProfile.emit();
      },
      error: (err: any) => {
        this.toast.error('Failed to add contact');
        console.error(err);
      }
    });
  }

  deleteContact(contactId: number) {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    
    this.employeeService.deleteContact(this.employeeData.id, contactId).subscribe({
      next: () => {
        this.toast.success('Contact deleted');
        this.refreshProfile.emit();
      },
      error: (err: any) => {
        this.toast.error('Failed to delete contact');
        console.error(err);
      }
    });
  }
}
