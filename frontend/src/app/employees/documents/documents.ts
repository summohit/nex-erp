import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EmployeeService } from '../../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import JSZip from 'jszip';
import { SearchableSelectComponent } from '../../shared/components/searchable-select/searchable-select.component';
import {
  LucideFileText, LucideSearch, LucideUploadCloud,
  LucideTrash2, LucideFilter, LucideFileCheck, LucideFolder,
  LucideX, LucideExternalLink, LucidePaperclip, LucideDownload, LucideArchive
} from '@lucide/angular';

@Component({
  selector: 'app-employee-documents',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SearchableSelectComponent,
    LucideFileText, LucideSearch, LucideUploadCloud,
    LucideTrash2, LucideFilter, LucideFileCheck, LucideFolder,
    LucideX, LucideExternalLink, LucidePaperclip, LucideDownload, LucideArchive
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
  selectedEmployeeFilterId = signal<number | null>(null);
  isZipping = signal<boolean>(false);

  isUploadModalOpen = signal<boolean>(false);
  uploadEmployeeId = signal<number | null>(null);
  selectedFiles = signal<{ name: string; url: string }[]>([]);
  readonly maxUploadFiles = 5;
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
    const empFilterId = this.selectedEmployeeFilterId();

    return this.allDocuments().filter(doc => {
      const empName = `${doc.employee?.firstName || ''} ${doc.employee?.lastName || ''}`.toLowerCase();
      const docName = (doc.fileName || '').toLowerCase();
      const matchesSearch = !q || empName.includes(q) || docName.includes(q);
      const matchesDept = dept === 'ALL' || doc.employee?.department?.name === dept;
      const matchesEmployee = !empFilterId || doc.employee?.id === empFilterId;
      return matchesSearch && matchesDept && matchesEmployee;
    });
  });

  employeeFilterOptions = computed(() =>
    this.employees()
      .filter(e => e.documents && e.documents.length > 0)
      .map(e => ({ id: e.id, name: `${e.firstName} ${e.lastName}` }))
  );

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
    this.selectedFiles.set([]);
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
    const files: File[] = Array.from(event.target.files || []);
    if (files.length === 0) return;

    if (files.length > this.maxUploadFiles) {
      this.toast.error(`You can upload a maximum of ${this.maxUploadFiles} files at a time. Please remove ${files.length - this.maxUploadFiles} file(s) and try again.`);
      event.target.value = '';
      this.selectedFiles.set([]);
      return;
    }

    const results: { name: string; url: string }[] = [];
    let readCount = 0;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        results.push({ name: file.name, url: e.target.result });
        readCount++;
        if (readCount === files.length) {
          this.selectedFiles.set(results);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  removeSelectedFile(index: number) {
    this.selectedFiles.update(list => list.filter((_, i) => i !== index));
  }

  submitUpload() {
    const empId = this.uploadEmployeeId();
    const files = this.selectedFiles();

    if (!empId) {
      this.toast.error('Please select an employee');
      return;
    }
    if (files.length === 0) {
      this.toast.error('Please select at least one file to upload');
      return;
    }
    if (files.length > this.maxUploadFiles) {
      this.toast.error(`You can upload a maximum of ${this.maxUploadFiles} files at a time.`);
      return;
    }

    this.isUploading.set(true);
    this.employeeService.addDocuments(empId, files).subscribe({
      next: () => {
        this.isUploading.set(false);
        this.toast.success(`${files.length} document${files.length > 1 ? 's' : ''} uploaded successfully!`);
        this.closeUploadModal();
        this.loadEmployeesAndDocs();
      },
      error: (err) => {
        this.isUploading.set(false);
        this.toast.error(err?.error?.message || 'Failed to upload documents');
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

  private triggerBlobDownload(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async downloadDocument(doc: any) {
    try {
      const res = await fetch(doc.fileUrl);
      if (!res.ok) throw new Error('Fetch failed');
      const blob = await res.blob();
      this.triggerBlobDownload(blob, doc.fileName || 'document');
    } catch {
      this.toast.error(`Failed to download "${doc.fileName}"`);
    }
  }

  async downloadAllAsZip() {
    const docs = this.filteredDocuments();
    if (docs.length === 0) {
      this.toast.error('No documents to download');
      return;
    }

    this.isZipping.set(true);
    const zip = new JSZip();
    const usedNames = new Set<string>();
    let failedCount = 0;

    for (const doc of docs) {
      try {
        const res = await fetch(doc.fileUrl);
        if (!res.ok) throw new Error('Fetch failed');
        const blob = await res.blob();

        const empName = `${doc.employee?.firstName || 'Unknown'}_${doc.employee?.lastName || ''}`.trim().replace(/\s+/g, '_');
        let fileName = `${empName}/${doc.fileName || 'document'}`;
        let suffix = 1;
        while (usedNames.has(fileName)) {
          const dotIdx = (doc.fileName || 'document').lastIndexOf('.');
          const base = dotIdx > -1 ? doc.fileName.slice(0, dotIdx) : doc.fileName;
          const ext = dotIdx > -1 ? doc.fileName.slice(dotIdx) : '';
          fileName = `${empName}/${base} (${suffix})${ext}`;
          suffix++;
        }
        usedNames.add(fileName);
        zip.file(fileName, blob);
      } catch {
        failedCount++;
      }
    }

    if (usedNames.size === 0) {
      this.isZipping.set(false);
      this.toast.error('Failed to download any documents');
      return;
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const filterLabel = this.selectedEmployeeFilterId()
      ? (this.employees().find(e => e.id === this.selectedEmployeeFilterId())?.firstName || 'employee')
      : 'all-employees';
    this.triggerBlobDownload(zipBlob, `documents-${filterLabel}-${new Date().toISOString().slice(0, 10)}.zip`);
    this.isZipping.set(false);

    if (failedCount > 0) {
      this.toast.error(`${failedCount} document(s) could not be included in the ZIP`);
    } else {
      this.toast.success(`Downloaded ${usedNames.size} document(s) as ZIP`);
    }
  }
}
