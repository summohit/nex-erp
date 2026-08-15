import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideEye, LucideFileText, LucidePlus, LucideTrash2, LucideUploadCloud, LucideFolderOpen } from '@lucide/angular';
import { EmployeeService } from '../../../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-documents-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideEye, LucideFileText, LucidePlus, LucideTrash2, LucideUploadCloud, LucideFolderOpen],
  templateUrl: './documents-tab.html',
  styleUrls: ['./documents-tab.css']
})
export class DocumentsTabComponent implements OnInit {
  @Input() employeeData: any;
  @Output() refreshProfile = new EventEmitter<void>();

  showModal = false;
  uploading = false;
  fileName = '';
  selectedFile: File | null = null;
  selectedFileUrl: string | null = null;

  documentTypes = [
    'PAN Card',
    'Aadhaar Card',
    'Passport',
    'Bank Proof / Cancelled Cheque',
    'Educational Certificate',
    'Relieving / Experience Letter',
    'Payslips',
    'Form 16 / Tax Proof',
    'Driving License / Voter ID',
    'Other'
  ];

  selectedDocumentType = 'PAN Card';

  constructor(private employeeService: EmployeeService, private toast: HotToastService) {}

  ngOnInit() {}

  get availableDocumentTypes(): string[] {
    const existingTypes = (this.employeeData?.documents || []).map((d: any) => d.documentType);
    return this.documentTypes.filter(type => !existingTypes.includes(type) || type === 'Other');
  }

  openModal() {
    const available = this.availableDocumentTypes;
    if (available.length === 0) {
      this.toast.info('You have already uploaded all available document types.');
      return;
    }
    this.showModal = true;
    this.fileName = '';
    this.selectedDocumentType = available[0];
    this.selectedFile = null;
    this.selectedFileUrl = null;
  }

  closeModal() {
    this.showModal = false;
  }

  handleFileInput(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedFile = file;
      if (!this.fileName) {
        this.fileName = file.name.split('.')[0];
      }
    }
  }

  submitDocument() {
    if (!this.fileName || !this.selectedFile) {
      this.toast.error('File name and file are required');
      return;
    }
    
    this.uploading = true;
    this.toast.loading('Uploading document...', { id: 'doc-upload' });

    this.employeeService.uploadDocument(this.selectedFile).subscribe({
      next: (uploadRes) => {
        const payload = {
          fileName: this.fileName,
          fileUrl: uploadRes.url,
          documentType: this.selectedDocumentType
        };

        this.employeeService.addDocument(this.employeeData.id, payload).subscribe({
          next: () => {
            this.toast.success('Document uploaded successfully', { id: 'doc-upload' });
            this.closeModal();
            this.refreshProfile.emit();
            this.uploading = false;
          },
          error: (err: any) => {
            this.toast.error('Failed to save document record', { id: 'doc-upload' });
            console.error(err);
            this.uploading = false;
          }
        });
      },
      error: (err: any) => {
        this.toast.error('Failed to upload file to ImageKit', { id: 'doc-upload' });
        console.error(err);
        this.uploading = false;
      }
    });
  }

  deleteDocument(documentId: number) {
    if (!confirm('Are you sure you want to delete this document?')) return;
    
    this.employeeService.deleteDocument(this.employeeData.id, documentId).subscribe({
      next: () => {
        this.toast.success('Document deleted');
        this.refreshProfile.emit();
      },
      error: (err: any) => {
        this.toast.error('Failed to delete document');
        console.error(err);
      }
    });
  }

  viewDocument(fileUrl: string) {
    if (fileUrl.startsWith('data:')) {
      // Workaround for Chrome blocking data URL navigation in top frame
      const win = window.open();
      if (win) {
        win.document.write(`<iframe src="${fileUrl}" frameborder="0" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%; position:absolute;" allowfullscreen></iframe>`);
        win.document.close();
      }
    } else {
      window.open(fileUrl, '_blank');
    }
  }

  timeAgo(dateString: string) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000); // in seconds

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} days ago`;
    return `${Math.floor(diff / 604800)} weeks ago`;
  }
}
