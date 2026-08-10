import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmployeeService } from '../../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import { 
  LucideFileText, LucideSearch, LucideUploadCloud,
  LucideTrash2, LucideFilter, LucideFileCheck, LucideFolder,
  LucideX, LucideExternalLink, LucidePaperclip
} from '@lucide/angular';

@Component({
  selector: 'app-employee-documents',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule,
    LucideFileText, LucideSearch, LucideUploadCloud,
    LucideTrash2, LucideFilter, LucideFileCheck, LucideFolder,
    LucideX, LucideExternalLink, LucidePaperclip
  ],
  templateUrl: './documents.html',
  styleUrls: ['./documents.css']
})
export class EmployeeDocumentsComponent implements OnInit {
  private employeeService = inject(EmployeeService);
  private toast = inject(HotToastService);

  employees = signal<any[]>([]);
  isLoading = signal<boolean>(true);
  
  searchQuery = signal<string>('');
  selectedDepartment = signal<string>('ALL');
  
  isUploadModalOpen = signal<boolean>(false);
  uploadEmployeeId = signal<number | null>(null);
  uploadFileName = signal<string>('');
  uploadFileUrl = signal<string>('');
  isUploading = signal<boolean>(false);

  ngOnInit() {
    this.loadEmployeesAndDocs();
  }

  loadEmployeesAndDocs() {
    this.isLoading.set(true);
    this.employeeService.getEmployees().subscribe({
      next: (data) => {
        this.employees.set(data || []);
        this.isLoading.set(false);
      },
      error: () => {
        this.toast.error('Failed to load employee documents');
        this.isLoading.set(false);
      }
    });
  }

  departments = computed(() => {
    const set = new Set<string>();
    for (const emp of this.employees()) {
      if (emp.department?.name) set.add(emp.department.name);
    }
    return Array.from(set);
  });

  allDocuments = computed(() => {
    const list: any[] = [];
    for (const emp of this.employees()) {
      if (emp.documents && emp.documents.length > 0) {
        for (const doc of emp.documents) {
          list.push({
            ...doc,
            employee: emp
          });
        }
      }
    }
    return list;
  });

  filteredDocuments = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    const dept = this.selectedDepartment();
    
    return this.allDocuments().filter(doc => {
      const empName = `${doc.employee?.firstName || ''} ${doc.employee?.lastName || ''}`.toLowerCase();
      const docName = (doc.fileName || '').toLowerCase();
      const matchesSearch = !q || empName.includes(q) || docName.includes(q);
      const matchesDept = dept === 'ALL' || doc.employee?.department?.name === dept;
      return matchesSearch && matchesDept;
    });
  });

  totalDocsCount = computed(() => this.allDocuments().length);
  employeesWithDocsCount = computed(() => {
    return this.employees().filter(e => e.documents && e.documents.length > 0).length;
  });

  modalEmployeeSearch = signal<string>('');
  isEmployeeDropdownOpen = signal<boolean>(false);

  filteredModalEmployees = computed(() => {
    const q = this.modalEmployeeSearch().toLowerCase().trim();
    const list = this.employees();
    if (!q) return list;
    return list.filter(e => {
      const name = `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase();
      const dept = (e.department?.name || '').toLowerCase();
      return name.includes(q) || dept.includes(q);
    });
  });

  selectedEmployeeObject = computed(() => {
    const id = this.uploadEmployeeId();
    if (!id) return null;
    return this.employees().find(e => e.id === id) || null;
  });

  openUploadModal(employeeId?: number) {
    if (employeeId) this.uploadEmployeeId.set(employeeId);
    else if (this.employees().length > 0) this.uploadEmployeeId.set(this.employees()[0].id);
    this.uploadFileName.set('');
    this.uploadFileUrl.set('');
    this.modalEmployeeSearch.set('');
    this.isEmployeeDropdownOpen.set(false);
    this.isUploadModalOpen.set(true);
  }

  selectEmployee(emp: any) {
    this.uploadEmployeeId.set(emp.id);
    this.isEmployeeDropdownOpen.set(false);
  }

  closeUploadModal() {
    this.isUploadModalOpen.set(false);
    this.isEmployeeDropdownOpen.set(false);
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.uploadFileName.set(file.name);
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.uploadFileUrl.set(e.target.result);
      };
      reader.readAsDataURL(file);
    }
  }

  submitUpload() {
    const empId = this.uploadEmployeeId();
    const name = this.uploadFileName().trim();
    const url = this.uploadFileUrl().trim() || 'https://via.placeholder.com/150';

    if (!empId || !name) {
      this.toast.error('Please select an employee and specify a document name');
      return;
    }

    this.isUploading.set(true);
    this.employeeService.addDocument(empId, { fileName: name, fileUrl: url }).subscribe({
      next: () => {
        this.toast.success('Document uploaded successfully!');
        this.isUploading.set(false);
        this.closeUploadModal();
        this.loadEmployeesAndDocs();
      },
      error: () => {
        this.toast.error('Failed to upload document');
        this.isUploading.set(false);
      }
    });
  }

  deleteDocument(doc: any) {
    if (!confirm(`Are you sure you want to delete "${doc.fileName}"?`)) return;
    this.employeeService.deleteDocument(doc.employeeId, doc.id).subscribe({
      next: () => {
        this.toast.success('Document deleted');
        this.loadEmployeesAndDocs();
      },
      error: () => this.toast.error('Failed to delete document')
    });
  }

  getFileExtension(fileName: string): string {
    if (!fileName) return 'FILE';
    const parts = fileName.split('.');
    return parts.length > 1 ? parts[parts.length - 1].toUpperCase() : 'DOC';
  }
}
