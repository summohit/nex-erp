import { Component, signal, inject, OnInit, ViewChild, ElementRef } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { 
  LucidePlus, LucideBriefcase, LucideMapPin, LucideClock, LucideSparkles, 
  LucideX, LucideMoreVertical, LucideSearch, LucideBold, LucideItalic, 
  LucideList, LucideListOrdered, LucideHelpCircle, LucideTrash2, LucideBuilding 
} from '@lucide/angular';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { MasterDataService, Department, Designation, Branch } from '../../services/master-data.service';
import { JobsService, Job } from '../../services/jobs.service';
import { ActionCellRendererComponent } from '../../shared/components/action-cell-renderer.component';
import { environment } from '../../../environments/environment';

ModuleRegistry.registerModules([AllCommunityModule]);

declare var Quill: any;

@Component({
  selector: 'app-job-postings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LucidePlus, 
    LucideSparkles, LucideX, LucideSearch, 
    LucideHelpCircle, LucideTrash2, LucideBuilding, AgGridAngular, DatePipe
  ],
  templateUrl: './job-postings.html',
  styleUrls: ['./job-postings.css'],
  providers: [DatePipe]
})
export class JobPostingsComponent implements OnInit {
  private masterDataService = inject(MasterDataService);
  private http = inject(HttpClient);
  private jobsService = inject(JobsService);
  
  @ViewChild('quillContainer') quillContainer!: ElementRef;
  private quillInstance: any = null;

  departments = signal<Department[]>([]);
  designations = signal<Designation[]>([]);
  filteredDesignations = signal<Designation[]>([]);
  branches = signal<Branch[]>([]);

  jobs = signal<Job[]>([]);

  ngOnInit() {
    this.masterDataService.getDepartments(true).subscribe(res => {
      this.departments.set(res);
    });
    this.masterDataService.getDesignations(true).subscribe(res => {
      this.designations.set(res);
    });
    this.masterDataService.getBranches().subscribe(res => {
      this.branches.set(res);
    });
    this.loadJobs();
  }

  loadJobs() {
    this.jobsService.getJobs().subscribe({
      next: (res) => {
        const mappedJobs = res.map(j => {
          let questions = [];
          if (j.screeningQuestions) {
             try { questions = JSON.parse(j.screeningQuestions); } catch(e) {}
          }
          return {
            ...j,
            department: j.department?.name || 'General',
            designation: j.designation?.name || '',
            location: j.branch?.name || 'Remote',
            address: j.branch?.address || '',
            applicants: j._count?.applications || 0,
            screeningQuestions: questions as any
          };
        });
        this.jobs.set(mappedJobs);
      },
      error: (err) => console.error('Error fetching jobs', err)
    });
  }

  onDepartmentChange() {
    const deptId = Number(this.jobForm.departmentId);
    if (deptId) {
      this.filteredDesignations.set(this.designations().filter(d => d.departmentId === deptId));
      this.jobForm.designationId = '';
    }
  }

  onBranchChange() {
    const branch = this.branches().find(b => b.id === Number(this.jobForm.branchId));
    if (branch) {
      this.jobForm.location = branch.name;
      this.jobForm.address = branch.address || branch.name;
    }
  }

  // Grid State
  gridApi: any;
  searchText = '';
  filterStatus = '';
  filterDepartment = '';

  defaultColDef: ColDef = {
    flex: 1,
    minWidth: 150,
    filter: true,
    sortable: true
  };

  gridOptions = {
    rowSelection: {
      mode: 'multiRow' as const,
      checkboxes: true,
      headerCheckbox: true,
      enableClickSelection: false
    },
    pagination: true,
    paginationPageSize: 10,
    paginationPageSizeSelector: [10, 25, 50, 100]
  };

  colDefs: ColDef[] = [
    { 
      headerName: 'Job Title', 
      field: 'title',
      minWidth: 220,
      flex: 1.5,
      pinned: 'left',
      cellRenderer: (params: any) => {
        if (!params.value) return '';
        const exp = params.data.experienceYears ? `<span style="font-size: 11px; color: #64748B; margin-left: 6px;">(${params.data.experienceYears})</span>` : '';
        return `<div style="font-weight: 600; color: #0F172A;">${params.value}${exp}</div>`;
      }
    },
    { field: 'department', headerName: 'Department' },
    { field: 'experienceYears', headerName: 'Experience', width: 140, flex: 0 },
    { field: 'location', headerName: 'Location' },
    { field: 'type', headerName: 'Type', width: 120, flex: 0 },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      flex: 0,
      cellRenderer: (params: any) => {
        const val = params.value;
        let bg = '#F1F5F9', color = '#475569';
        if (val === 'Open') { bg = '#DCFCE7'; color = '#166534'; }
        if (val === 'Closed') { bg = '#FEE2E2'; color = '#991B1B'; }
        if (val === 'Draft') { bg = '#FEF9C3'; color = '#CA8A04'; }
        return `<span style="background: ${bg}; color: ${color}; padding: 4px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; text-transform: uppercase;">${val}</span>`;
      }
    },
    { field: 'applicants', headerName: 'Applicants', width: 120, flex: 0 },
    {
      field: 'postedDate',
      headerName: 'Posted Date',
      valueFormatter: (params: any) => {
        if (!params.value) return '';
        const d = new Date(params.value);
        return d.toLocaleDateString();
      }
    },
    {
      headerName: 'Actions',
      width: 100,
      flex: 0,
      sortable: false,
      filter: false,
      pinned: 'right',
      cellRenderer: ActionCellRendererComponent,
      cellRendererParams: {
        onView: (data: any) => this.viewJobDetails(data),
        viewLabel: 'View Details',
        onEdit: (data: any) => this.editJob(data),
        onDelete: (data: any) => this.deleteJob(data)
      }
    }
  ];

  onGridReady(params: any) {
    this.gridApi = params.api;
  }

  onSearch() {
    if (this.gridApi) {
      this.gridApi.setGridOption('quickFilterText', this.searchText);
    }
  }

  applyFilters() {
    if (!this.gridApi) return;
    const filterModel: any = {};
    if (this.filterStatus) {
      filterModel['status'] = { filterType: 'text', type: 'equals', filter: this.filterStatus };
    }
    if (this.filterDepartment) {
      filterModel['department'] = { filterType: 'text', type: 'equals', filter: this.filterDepartment };
    }
    this.gridApi.setFilterModel(Object.keys(filterModel).length > 0 ? filterModel : null);
  }

  clearFilters() {
    this.searchText = '';
    this.filterStatus = '';
    this.filterDepartment = '';
    this.onSearch();
    if (this.gridApi) this.gridApi.setFilterModel(null);
  }

  // Drawer & Form State
  isCreateModalOpen = signal(false);
  drawerMode = signal<'create' | 'edit' | 'view'>('create');
  selectedJob = signal<Job | null>(null);
  screeningQuestions = signal<string[]>([]);
  newQuestionInput = '';
  
  jobForm: any = {
    title: '',
    departmentId: '',
    designationId: '',
    branchId: '',
    experienceYears: '3-5 Years',
    type: 'Full-time',
    status: 'Open',
    location: '',
    address: '',
    descriptionHtml: '',
    aiPrompt: ''
  };

  // AI State
  isGeneratingAI = signal(false);

  openCreateModal() {
    this.drawerMode.set('create');
    this.selectedJob.set(null);
    this.screeningQuestions.set([]);
    this.jobForm = { 
      title: '', 
      departmentId: '', 
      designationId: '', 
      branchId: '',
      experienceYears: '3-5 Years',
      type: 'Full-time', 
      status: 'Open',
      location: '', 
      address: '',
      descriptionHtml: '', 
      aiPrompt: '' 
    };
    this.filteredDesignations.set([]);
    this.isCreateModalOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  closeCreateModal() {
    this.isCreateModalOpen.set(false);
  }

  editJob(job: Job) {
    this.selectedJob.set(job);
    this.drawerMode.set('edit');
    const dept = this.departments().find(d => d.name.toLowerCase() === job.department.toLowerCase());
    const deptId = dept ? String(dept.id) : '';
    
    if (deptId) {
      this.filteredDesignations.set(this.designations().filter(d => d.departmentId === Number(deptId)));
    }
    
    const desig = this.designations().find(d => d.name.toLowerCase() === (job.designation || '').toLowerCase());
    const branch = this.branches().find(b => b.name.toLowerCase() === (job.location || '').toLowerCase());
    
    this.jobForm = {
      title: job.title,
      departmentId: deptId,
      designationId: desig ? String(desig.id) : '',
      branchId: branch ? String(branch.id) : '',
      experienceYears: job.experienceYears || '3-5 Years',
      type: job.type,
      status: job.status || 'Open',
      location: job.location || '',
      address: job.address || branch?.address || '',
      descriptionHtml: job.descriptionHtml || `<h3>About the Role</h3><p>We are seeking an experienced ${job.title} to join our ${job.department} team.</p>`,
      aiPrompt: ''
    };
    this.screeningQuestions.set((job.screeningQuestions as any) || []);
    this.isCreateModalOpen.set(true);
    setTimeout(() => this.initQuill(), 100);
  }

  viewJobDetails(job: Job) {
    this.selectedJob.set(job);
    this.drawerMode.set('view');
    this.isCreateModalOpen.set(true);
  }

  deleteJob(job: Job) {
    if (confirm(`Are you sure you want to delete the job posting "${job.title}"?`)) {
      this.jobsService.deleteJob(job.id).subscribe({
        next: () => {
          this.jobs.update(jobs => jobs.filter(j => j.id !== job.id));
        },
        error: (err) => console.error('Error deleting job', err)
      });
    }
  }

  saveJob() {
    const deptId = Number(this.jobForm.departmentId) || null;
    const desigId = Number(this.jobForm.designationId) || null;
    const branchId = Number(this.jobForm.branchId) || null;
    
    const payload = {
      title: this.jobForm.title || 'Untitled Job',
      departmentId: deptId,
      designationId: desigId,
      branchId: branchId,
      experienceYears: this.jobForm.experienceYears,
      type: this.jobForm.type,
      status: this.jobForm.status,
      descriptionHtml: this.jobForm.descriptionHtml,
      screeningQuestions: JSON.stringify(this.screeningQuestions())
    };
    
    if (this.drawerMode() === 'edit' && this.selectedJob()) {
      const currentId = this.selectedJob()!.id;
      this.jobsService.updateJob(currentId, payload).subscribe({
        next: () => {
          this.loadJobs();
          this.closeCreateModal();
        },
        error: (err) => console.error('Error updating job', err)
      });
    } else {
      this.jobsService.createJob(payload).subscribe({
        next: () => {
          this.loadJobs();
          this.closeCreateModal();
        },
        error: (err) => console.error('Error creating job', err)
      });
    }
  }

  addScreeningQuestion() {
    if (this.newQuestionInput.trim()) {
      this.screeningQuestions.update(q => [...q, this.newQuestionInput.trim()]);
      this.newQuestionInput = '';
    }
  }

  removeScreeningQuestion(index: number) {
    this.screeningQuestions.update(q => q.filter((_, i) => i !== index));
  }

  initQuill() {
    if (!this.quillContainer) return;
    
    if (!this.quillInstance) {
      if (typeof Quill === 'undefined') {
        console.warn('Quill is loading...');
        setTimeout(() => this.initQuill(), 200);
        return;
      }

      const toolbarOptions = [
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote', 'code-block'],
        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
        [{ 'script': 'sub'}, { 'script': 'super' }],
        [{ 'indent': '-1'}, { 'indent': '+1' }],
        [{ 'color': [] }, { 'background': [] }],
        [{ 'align': [] }],
        ['link', 'clean']
      ];

      this.quillInstance = new Quill(this.quillContainer.nativeElement, {
        modules: { toolbar: toolbarOptions },
        theme: 'snow',
        placeholder: 'Compose job description...'
      });

      this.quillInstance.on('text-change', () => {
        this.jobForm.descriptionHtml = this.quillInstance.root.innerHTML;
      });
    }

    if (this.quillInstance) {
      this.quillInstance.clipboard.dangerouslyPasteHTML(this.jobForm.descriptionHtml || '');
    }
  }

  async generateWithAI() {
    const desig = this.designations().find(d => d.id === Number(this.jobForm.designationId))?.name || this.jobForm.title;
    if (!desig && !this.jobForm.aiPrompt) return;
    
    this.isGeneratingAI.set(true);
    
    const dept = this.departments().find(d => d.id === Number(this.jobForm.departmentId))?.name || 'General';

    try {
      const response: any = await firstValueFrom(
        this.http.post(`${environment.apiUrl}/ai/generate-job-description`, {
          title: desig || 'Professional',
          department: dept,
          location: this.jobForm.location,
          instructions: `Required Experience: ${this.jobForm.experienceYears}. ${this.jobForm.aiPrompt || ''}`
        })
      );

      const rawText: string = response.result || '';

      // Separate Screening Questions from main Job Description
      let descriptionPart = rawText;
      let extractedQuestions: string[] = [];

      const questionsMatch = rawText.match(/(###?\s*Suggested Screening Questions[\s\S]*)/i);
      if (questionsMatch) {
        const questionsBlock = questionsMatch[1];
        descriptionPart = rawText.replace(questionsBlock, '').trim();

        // Extract numbered questions
        const matches = questionsBlock.match(/\d+\.\s+([^\n]+)/g);
        if (matches) {
          extractedQuestions = matches.map(q => q.replace(/^\d+\.\s+/, '').trim());
        }
      }

      this.screeningQuestions.set(extractedQuestions);

      // Convert Markdown to clean HTML
      const htmlContent = this.convertMarkdownToHtml(descriptionPart);
      this.jobForm.descriptionHtml = htmlContent;

      if (this.quillInstance) {
        this.quillInstance.clipboard.dangerouslyPasteHTML(htmlContent);
      }

    } catch (err: any) {
      console.error('Groq AI Generation error:', err);
      const errHtml = '<p style="color: #ef4444;">Failed to generate job description. Please ensure your Groq API key is set and backend is running.</p>';
      this.jobForm.descriptionHtml = errHtml;
      if (this.quillInstance) {
        this.quillInstance.clipboard.dangerouslyPasteHTML(errHtml);
      }
    } finally {
      this.isGeneratingAI.set(false);
    }
  }

  private convertMarkdownToHtml(md: string): string {
    if (!md) return '';
    let html = md
      .replace(/^### (.*$)/gim, '<h3 style="font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 16px; margin-bottom: 6px;">$1</h3>')
      .replace(/^#### (.*$)/gim, '<h4 style="font-size: 13px; font-weight: 700; color: #0f172a; margin-top: 12px; margin-bottom: 4px;">$1</h4>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/^\* (.*$)/gim, '<li>$1</li>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      .replace(/^• (.*$)/gim, '<li>$1</li>');

    html = html.replace(/\n\n/g, '<br>').replace(/\n/g, '<br>');
    return html;
  }
}
