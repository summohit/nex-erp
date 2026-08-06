import { Component, EventEmitter, Output, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { MasterDataService, Department, Designation } from '../../../services/master-data.service';

interface BulkUploadResult {
  totalRows: number;
  successCount: number;
  failedCount: number;
  errors: { row: number; email?: string; reason: string }[];
}

@Component({
  selector: 'app-bulk-upload-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './bulk-upload-modal.html',
  styleUrls: ['./bulk-upload-modal.css']
})
export class BulkUploadModalComponent implements OnInit {
  @Output() close = new EventEmitter<boolean>(); // Emit true if upload succeeded
  
  private http = inject(HttpClient);
  private masterDataService = inject(MasterDataService);
  
  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);

  selectedDepartmentId: number | null = null;
  selectedDesignationId: number | null = null;
  selectedRole: string | null = null;

  selectedFile: File | null = null;
  isUploading = false;
  uploadResult: BulkUploadResult | null = null;
  uploadError: string | null = null;

  ngOnInit() {
    this.masterDataService.getDepartments(true).subscribe(data => this.departments.set(data));
    this.masterDataService.getDesignations(true).subscribe(data => this.designations.set(data));
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
      this.uploadResult = null;
      this.uploadError = null;
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.selectedFile = event.dataTransfer.files[0];
      this.uploadResult = null;
      this.uploadError = null;
    }
  }

  downloadTemplate() {
    // Generate a simple CSV blob and trigger download
    const headers = "FirstName,LastName,Email,Role,Department,Designation,Phone\n";
    const sampleData = "John,Doe,john.doe@example.com,EMPLOYEE,Sales,Manager,+1234567890\n";
    const csvContent = headers + sampleData;
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Employee_Upload_Template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }

  uploadFile() {
    if (!this.selectedFile) return;

    this.isUploading = true;
    this.uploadError = null;

    const formData = new FormData();
    formData.append('file', this.selectedFile);
    if (this.selectedDepartmentId) formData.append('departmentId', this.selectedDepartmentId.toString());
    if (this.selectedDesignationId) formData.append('designationId', this.selectedDesignationId.toString());
    if (this.selectedRole) formData.append('role', this.selectedRole);

    this.http.post<BulkUploadResult>(`${environment.apiUrl}/employees/bulk-upload`, formData)
      .subscribe({
        next: (res) => {
          this.uploadResult = res;
          this.isUploading = false;
        },
        error: (err) => {
          console.error('Upload failed', err);
          this.uploadError = err.error?.message || 'Failed to upload file. Please try again.';
          this.isUploading = false;
        }
      });
  }

  closeModal() {
    // If we had a success count > 0, we emit true to signal the parent to reload data
    const didUploadSomething = this.uploadResult ? this.uploadResult.successCount > 0 : false;
    this.close.emit(didUploadSomething);
  }
}
