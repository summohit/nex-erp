import { Component, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ProjectsService } from '../../services/projects';
import { FormsModule } from '@angular/forms';
import { 
  LucideUploadCloud, LucideBrainCircuit, LucideCheckCircle2, 
  LucideFileText, LucideLayoutList, LucideAlertTriangle,
  LucideCheck, LucideChevronRight, LucideChevronLeft,
  LucideTrash2, LucideFile, LucidePlus, LucideX, LucideAlertCircle,
  LucideLayers, LucideListChecks, LucideUsers, LucideDollarSign,
  LucideShieldAlert, LucideCheckSquare, LucideTarget, LucideActivity
} from '@lucide/angular';

@Component({
  selector: 'app-project-wizard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideUploadCloud, LucideBrainCircuit, 
    LucideCheckCircle2, LucideFileText, LucideLayoutList, LucideAlertTriangle,
    LucideCheck, LucideChevronRight, LucideChevronLeft,
    LucideTrash2, LucideFile, LucidePlus, LucideX, LucideAlertCircle,
    LucideLayers, LucideListChecks, LucideUsers, LucideDollarSign,
    LucideShieldAlert, LucideCheckSquare, LucideTarget, LucideActivity
  ],
  templateUrl: './project-wizard.html',
  styleUrls: ['./project-wizard.css']
})
export class ProjectWizardComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private projectsService = inject(ProjectsService);

  projectId = signal<number | null>(null);
  currentStep = signal<number>(1);
  
  // Status flags
  isUploading = signal(false);
  uploadProgress = signal<number>(0);
  isAnalyzing = signal(false);
  analysisError = signal<string | null>(null);
  fileLimitError = signal<string | null>(null);

  // Drag and Drop state
  isDragging = signal(false);

  // Multiple files tracking (max 8)
  readonly MAX_FILES = 8;
  selectedFiles = signal<File[]>([]);

  // AI Output
  analysisData = signal<any>(null);
  
  steps = [
    { id: 1, title: 'Upload Documents', icon: 'LucideUploadCloud' },
    { id: 2, title: 'Processing', icon: 'LucideBrainCircuit' },
    { id: 3, title: 'Review & Approve', icon: 'LucideCheckCircle2' }
  ];

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id && id !== 'new') {
        this.projectId.set(+id);
        this.fetchExistingAnalysis(+id);
      }
    });
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    
    if (event.dataTransfer?.files) {
      this.addFiles(Array.from(event.dataTransfer.files));
    }
  }

  onFileSelected(event: any) {
    if (event.target.files) {
      this.addFiles(Array.from(event.target.files));
      event.target.value = '';
    }
  }

  private addFiles(files: File[]) {
    this.fileLimitError.set(null);
    const validFiles = files.filter(file => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      return ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'csv'].includes(ext || '');
    });

    if (validFiles.length < files.length) {
      this.fileLimitError.set('Some unsupported files were skipped. Supported: PDF, DOCX, XLSX, TXT, CSV.');
    }

    const currentList = this.selectedFiles();
    const availableSlots = this.MAX_FILES - currentList.length;

    if (availableSlots <= 0) {
      this.fileLimitError.set(`Maximum limit of ${this.MAX_FILES} files reached.`);
      return;
    }

    const newFilesToAdd = validFiles.slice(0, availableSlots);
    if (validFiles.length > availableSlots) {
      this.fileLimitError.set(`Only ${availableSlots} more file(s) can be added (max ${this.MAX_FILES}).`);
    }

    const uniqueNewFiles = newFilesToAdd.filter(nf => 
      !currentList.some(cf => cf.name === nf.name && cf.size === nf.size)
    );

    this.selectedFiles.set([...currentList, ...uniqueNewFiles]);
  }

  removeFile(index: number) {
    this.fileLimitError.set(null);
    const currentList = [...this.selectedFiles()];
    currentList.splice(index, 1);
    this.selectedFiles.set(currentList);
  }

  clearAllFiles() {
    this.fileLimitError.set(null);
    this.selectedFiles.set([]);
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  formatPercent(val: any): string {
    if (val === null || val === undefined) return '0%';
    let num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num)) return '0%';
    if (num <= 1 && num > 0) {
      num = num * 100;
    }
    return Math.round(num) + '%';
  }

  async startOnboarding() {
    const files = this.selectedFiles();
    if (files.length === 0) return;
    
    this.isUploading.set(true);
    this.uploadProgress.set(10);
    
    try {
      const name = "Project Setup " + new Date().getTime();
      const projRes = await this.projectsService.createAiProject({ name }).toPromise();
      const pId = projRes.id;
      this.projectId.set(pId);

      const total = files.length;
      for (let i = 0; i < files.length; i++) {
        await this.projectsService.uploadProjectDocument(pId, files[i]).toPromise();
        this.uploadProgress.set(Math.round(((i + 1) / total) * 90));
      }
      
      this.isUploading.set(false);
      this.currentStep.set(2);
      
      this.runAiAnalysis(pId);
      
    } catch (err: any) {
      this.analysisError.set(err.message || 'Error during document upload/setup');
      this.isUploading.set(false);
    }
  }

  async runAiAnalysis(id: number) {
    this.isAnalyzing.set(true);
    this.analysisError.set(null);
    try {
      await this.projectsService.analyzeProjectDocuments(id).toPromise();
      await this.fetchExistingAnalysis(id);
    } catch (err: any) {
      console.error('Analysis error:', err);
      let message = 'We encountered an issue while processing your documents.';
      if (err?.error?.message) {
        message = err.error.message;
      } else if (err?.status === 500) {
        message = 'The document engine encountered an unreadable section. Please verify your uploaded files and try again.';
      } else if (err?.status === 400) {
        message = 'No readable text was found in the uploaded documents. Please upload valid PDFs, DOCX files, or spreadsheets.';
      }
      this.analysisError.set(message);
    } finally {
      this.isAnalyzing.set(false);
    }
  }

  async fetchExistingAnalysis(id: number) {
    try {
      const data = await this.projectsService.getProjectAnalysis(id).toPromise();
      this.analysisData.set(data);
      this.currentStep.set(3);
    } catch (err) {
      console.log("No analysis found yet.");
    }
  }

  approveProject() {
    this.router.navigate(['/projects', this.projectId()]);
  }
}
