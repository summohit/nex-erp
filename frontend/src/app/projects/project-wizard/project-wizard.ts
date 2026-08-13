import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ProjectsService } from '../../services/projects';
import { EmployeeService } from '../../services/employee.service';
import { FormsModule } from '@angular/forms';
import { 
  LucideUploadCloud, LucideBrainCircuit, LucideCheckCircle2, 
  LucideFileText, LucideLayoutList, LucideAlertTriangle,
  LucideCheck, LucideChevronRight, LucideChevronLeft,
  LucideTrash2, LucideFile, LucidePlus, LucideX, LucideAlertCircle,
  LucideLayers, LucideListChecks, LucideUsers, LucideDollarSign,
  LucideShieldAlert, LucideCheckSquare, LucideTarget, LucideActivity,
  LucideCalendar, LucideHelpCircle, LucideAward, LucideInfo,
  LucideSparkles, LucideClock, LucidePieChart, LucideTrendingUp,
  LucideShield, LucideLock, LucideZap, LucideAlertOctagon, LucideCheckCircle,
  LucideUser, LucideLink, LucideRotateCcw, LucideSearch
} from '@lucide/angular';

export interface ValidationWarning {
  code: string;
  severity: 'BLOCKING' | 'NON_BLOCKING';
  message: string;
}

export interface AnalysisData {
  validationWarnings?: ValidationWarning[];
  isReadyForKickoff?: boolean;
  kickoffBlockers?: string[];
  costEstimate?: any;
  health?: any;
  requirements?: any[];
  wbsTasks?: any[];
  resourcePlans?: any[];
  risks?: any[];
  dependencies?: any[];
  assumptions?: any[];
  stakeholders?: any[];
  raci?: any[];
  openQuestions?: any[];
  missingInfo?: any[];
  roadmap?: any;
  milestones?: any[];
  summary?: any;
  scope?: any;
  estimatedMargin?: any;
  marginDisplay?: any;
}

@Component({
  selector: 'app-project-wizard',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideUploadCloud, LucideBrainCircuit, 
    LucideCheckCircle2, LucideFileText, LucideAlertTriangle,
    LucideCheck, LucideChevronRight, LucideChevronLeft,
    LucideTrash2, LucidePlus, LucideX, LucideAlertCircle,
    LucideLayers, LucideListChecks, LucideUsers, LucideDollarSign,
    LucideShieldAlert, LucideCheckSquare, LucideTarget, LucideActivity,
    LucideCalendar, LucideHelpCircle, LucideAward, LucideInfo,
    LucideSparkles, LucideClock,
    LucideZap, LucideAlertOctagon, LucideCheckCircle,
    LucideLink, LucideRotateCcw, LucideSearch
  ],
  templateUrl: './project-wizard.html',
  styleUrls: ['./project-wizard.css']
})
export class ProjectWizardComponent implements OnInit {
  protected readonly Math = Math;
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private projectsService = inject(ProjectsService);
  private employeeService = inject(EmployeeService);

  projectId = signal<number | null>(null);
  currentStep = signal<number>(1);
  activeSection = signal<string>('summary');
  
  // Status flags
  isUploading = signal(false);
  uploadProgress = signal<number>(0);
  isAnalyzing = signal(false);
  analysisError = signal<string | null>(null);
  fileLimitError = signal<string | null>(null);

  // Drag and Drop state
  isDragging = signal(false);

  // Kickoff Approval Modal state
  showKickoffModal = signal(false);
  isKickingOff = signal(false);

  // Multiple files tracking (max 8)
  readonly MAX_FILES = 8;
  selectedFiles = signal<File[]>([]);

  // AI Output
  analysisData = signal<AnalysisData | null>(null);
  
  executiveSummaryHtml = computed(() => {
    return this.convertMarkdownToHtml(this.analysisData()?.summary?.executiveSummary || '');
  });

  // Employees for assignment & Search Filter
  availableEmployees = signal<any[]>([]);
  teamSearchQuery = signal<string>('');

  filteredEmployees = computed(() => {
    const query = this.teamSearchQuery().toLowerCase().trim();
    const all = this.availableEmployees();
    if (!query) return all;
    return all.filter(emp => {
      const name = `${emp.firstName || ''} ${emp.lastName || ''}`.toLowerCase();
      const email = (emp.email || emp.user?.email || '').toLowerCase();
      const role = this.getMemberDesignation(emp).toLowerCase();
      return name.includes(query) || email.includes(query) || role.includes(query);
    });
  });

  // Resource Constraints State
  resourceConfig = signal({
    teamMembers: [] as any[],
    methodology: 'Agile' as 'Agile' | 'Waterfall',
    targetBudget: null as string | number | null,
    maxHoursPerDay: 8,
    daysOff: { Saturday: true, Sunday: true, Monday: false, Tuesday: false, Wednesday: false, Thursday: false, Friday: false } as Record<string, boolean>,
    startDate: new Date().toISOString().split('T')[0],
    endDate: null as string | null,
    aiModel: 'llama-3.3-70b-versatile'
  });

  getPhaseBadgeClass(phase?: string): string {
    if (!phase) return 'phase-badge-default';
    const p = phase.toLowerCase();
    if (p.includes('plan') || p.includes('design') || p.includes('architecture')) return 'phase-badge-planning';
    if (p.includes('execut') || p.includes('develop') || p.includes('implement') || p.includes('build')) return 'phase-badge-execution';
    if (p.includes('test') || p.includes('qa') || p.includes('audit') || p.includes('verify')) return 'phase-badge-testing';
    if (p.includes('deploy') || p.includes('release') || p.includes('launch') || p.includes('kickoff')) return 'phase-badge-deployment';
    return 'phase-badge-default';
  }

  getEngineerInitials(name?: string): string {
    if (!name) return 'TM';
    const parts = name.trim().split(' ');
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  getEngineerImage(name?: string): string | null {
    if (!name) return null;
    const employees = this.availableEmployees();
    const employee = employees.find(e => 
      `${e.firstName} ${e.lastName}`.toLowerCase() === name.toLowerCase().trim()
    );
    return employee ? this.getMemberAvatar(employee) : null;
  }

  getMemberDesignation(emp: any): string {
    if (emp?.designation?.name) return emp.designation.name;
    if (emp?.designationName) return emp.designationName;
    if (emp?.jobTitle) return emp.jobTitle;
    if (emp?.user?.role) return emp.user.role;
    return 'Team Member';
  }

  getMemberAvatar(emp: any): string | null {
    return emp?.avatarUrl || emp?.user?.avatarUrl || emp?.avatar || emp?.profilePicture || null;
  }

  getInitials(firstName: string, lastName?: string): string {
    const f = firstName ? firstName.charAt(0).toUpperCase() : '';
    const l = lastName ? lastName.charAt(0).toUpperCase() : '';
    return (f + l) || 'U';
  }

  toggleTeamMember(emp: any) {
    const config = this.resourceConfig();
    const members = config.teamMembers;
    const exists = members.find(m => m.id === emp.id);
    let updatedMembers = [];
    if (exists) {
      updatedMembers = members.filter(m => m.id !== emp.id);
    } else {
      updatedMembers = [...members, emp];
    }
    this.resourceConfig.set({ ...config, teamMembers: updatedMembers });
  }

  isMemberSelected(emp: any): boolean {
    return !!this.resourceConfig().teamMembers.find(m => m.id === emp.id);
  }

  toggleDayOff(day: string) {
    const current = this.resourceConfig();
    const updated = {
      ...current,
      daysOff: {
        ...current.daysOff,
        [day]: !current.daysOff[day]
      }
    };
    this.resourceConfig.set(updated);
  }

  setWeekendOnly() {
    const current = this.resourceConfig();
    this.resourceConfig.set({
      ...current,
      daysOff: {
        Monday: false,
        Tuesday: false,
        Wednesday: false,
        Thursday: false,
        Friday: false,
        Saturday: true,
        Sunday: true
      }
    });
  }

  steps = [
    { id: 1, title: 'Upload Documents', icon: 'LucideUploadCloud' },
    { id: 2, title: 'Resource Configuration', icon: 'LucideUsers' },
    { id: 3, title: 'Processing', icon: 'LucideBrainCircuit' },
    { id: 4, title: 'Review & Approve', icon: 'LucideCheckCircle2' }
  ];

  ngOnInit() {
    // Fetch available employees
    this.employeeService.getEmployees().subscribe({
      next: (res: any) => {
        // API might return array directly or wrapped in data
        const emps = Array.isArray(res) ? res : (res.data || []);
        this.availableEmployees.set(emps);
      },
      error: (err) => console.error('Failed to fetch employees', err)
    });

    this.route.paramMap.subscribe(params => {
      const id = params.get('id');
      if (id && id !== 'new') {
        this.projectId.set(+id);
        this.fetchExistingAnalysis(+id);
      }
    });
  }

  scrollToSection(sectionId: string, event?: Event) {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    this.activeSection.set(sectionId);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
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

    if (uniqueNewFiles.length < newFilesToAdd.length) {
      this.fileLimitError.set('Duplicate file(s) were automatically skipped.');
    }

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

  hasMarginData(): boolean {
    const cost = this.analysisData()?.costEstimate;
    return !!(cost && cost.estimatedMargin !== null && cost.estimatedMargin !== undefined && cost.estimatedRevenue && cost.estimatedRevenue > 0);
  }

  getHealthBadgeClass(): string {
    const status = this.analysisData()?.health?.healthStatus;
    const scoreRaw = this.analysisData()?.health?.readinessScore;
    let score = typeof scoreRaw === 'number' ? scoreRaw : parseFloat(scoreRaw || '0');
    if (score <= 1 && score > 0) score = score * 100;

    if (status === 'CRITICAL' || score < 50) return 'critical';
    if (status === 'AT_RISK' || (score >= 50 && score < 80)) return 'at-risk';
    return 'healthy';
  }

  getHealthStatusLabel(): string {
    const status = this.analysisData()?.health?.healthStatus;
    const scoreRaw = this.analysisData()?.health?.readinessScore;
    let score = typeof scoreRaw === 'number' ? scoreRaw : parseFloat(scoreRaw || '0');
    if (score <= 1 && score > 0) score = score * 100;

    if (score >= 80) return 'HEALTHY';
    if (score >= 50) return 'AT_RISK';
    return 'CRITICAL';
  }

  getTotalWbsHours(): number {
    const tasks = this.analysisData()?.wbsTasks || [];
    return tasks.reduce((sum: number, t: any) => sum + (t.estimatedEffort || 0), 0);
  }

  getTotalResourceHours(): number {
    const plans = this.analysisData()?.resourcePlans || [];
    return plans.reduce((sum: number, r: any) => sum + (r.estimatedHours || 0), 0);
  }

  async goToResourceConfig() {
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
      this.currentStep.set(2); // Go to Resource Config
      
    } catch (err: any) {
      this.analysisError.set(err.message || 'Error during document upload/setup');
      this.isUploading.set(false);
    }
  }

  async startAnalysis() {
    const pId = this.projectId();
    if (!pId) return;
    
    this.currentStep.set(3); // Go to Processing
    this.runAiAnalysis(pId);
  }

  async runAiAnalysis(id: number) {
    this.isAnalyzing.set(true);
    this.analysisError.set(null);
    try {
      // Map daysOff dictionary to array of strings
      const config = this.resourceConfig();
      const daysOffArray = Object.keys(config.daysOff).filter(day => config.daysOff[day]);
      
      const payload = {
        resourceConstraints: {
          teamMembers: config.teamMembers,
          methodology: config.methodology,
          targetBudget: config.targetBudget,
          maxHoursPerDay: config.maxHoursPerDay,
          startDate: config.startDate,
          endDate: config.endDate,
          daysOff: daysOffArray
        },
        aiModel: config.aiModel
      };

      await this.projectsService.analyzeProjectDocuments(id, payload).toPromise();
      await this.fetchExistingAnalysis(id);
    } catch (err: any) {
      console.error('Analysis error:', err);
      let message = 'We encountered an issue while processing your documents.';
      if (err?.error?.message) {
        message = err.error.message;
        if (message.includes('429') || message.toLowerCase().includes('rate limit') || message.toLowerCase().includes('high demand')) {
          message = 'The selected AI model is currently experiencing high demand or rate limits. Please try again in a few minutes, or switch to a different model in the previous step.';
        }
      } else if (err?.status === 503 || err?.status === 429) {
        message = 'The selected AI model is currently experiencing high demand or rate limits. Please try again in a few minutes, or switch to a different model in the previous step.';
      } else if (err?.status === 500) {
        message = 'The document engine encountered an unreadable section. Please verify your uploaded files and try again.';
      } else if (err?.status === 400) {
        message = 'No readable text was found in the uploaded documents. Please upload valid PDFs, DOCX files, or spreadsheets.';
      }
      this.analysisError.set(message);
    } finally {
      this.isAnalyzing.set(false);
      if (!this.analysisError()) {
        this.currentStep.set(4);
      }
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

  openKickoffGate() {
    this.showKickoffModal.set(true);
  }

  closeKickoffGate() {
    this.showKickoffModal.set(false);
  }

  async confirmKickoff() {
    this.showKickoffModal.set(false);
    const id = this.projectId();
    if (!id) return;
    
    try {
      this.isKickingOff.set(true);
      await this.projectsService.kickoffProject(id).toPromise();
      this.router.navigate(['/projects', id]);
    } catch (e) {
      console.error('Kickoff failed:', e);
      // Fallback navigation in case of error (so user isn't stuck forever)
      this.router.navigate(['/projects', id]);
    } finally {
      this.isKickingOff.set(false);
    }
  }

  // --- UI Enhancement Helpers ---

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

  getParsedInScope(): string[] {
    const text = this.analysisData()?.scope?.inScope;
    if (!text) return [];
    if (Array.isArray(text)) return text;
    return text.split(/(?:\. |\n|; )/).map((s: string) => s.trim()).filter((s: string) => s.length > 3);
  }

  getParsedOutOfScope(): string[] {
    const text = this.analysisData()?.scope?.outOfScope;
    if (!text) return [];
    if (Array.isArray(text)) return text;
    return text.split(/(?:\. |\n|; )/).map((s: string) => s.trim()).filter((s: string) => s.length > 3);
  }

  getParsedDeliverables(): string[] {
    const text = this.analysisData()?.scope?.deliverables;
    if (!text) return [];
    if (Array.isArray(text)) return text;
    return text.split(/(?:\. |\n|; )/).map((s: string) => s.trim()).filter((s: string) => s.length > 3);
  }

  getSumOfCostComponents(): number {
    const c = this.analysisData()?.costEstimate;
    if (!c) return 0;
    return (c.resourceCost || 0) + 
           (c.infrastructureCost || 0) + 
           (c.vendorCost || 0) + 
           (c.licenseCost || 0) + 
           (c.contingency || 0) + 
           (c.otherCost || 0);
  }

  getUnexplainedVariance(): number {
    const reportedTotal = this.analysisData()?.costEstimate?.totalCost || 0;
    const sumComponents = this.getSumOfCostComponents();
    return Math.abs(sumComponents - reportedTotal);
  }

  hasCostVariance(): boolean {
    const reportedTotal = this.analysisData()?.costEstimate?.totalCost || 0;
    const sumComponents = this.getSumOfCostComponents();
    return reportedTotal > 0 && sumComponents > 0 && Math.abs(sumComponents - reportedTotal) > 100;
  }

  getWbsVarianceDetails() {
    const wbsHrs = this.getTotalWbsHours();
    const resHrs = this.getTotalResourceHours();
    const diff = resHrs - wbsHrs;
    const pct = resHrs > 0 ? Math.round((diff / resHrs) * 100) : 0;
    return {
      wbsHrs,
      resHrs,
      diff,
      pct,
      isExcessCapacity: diff > 0,
      isDeficit: diff < 0
    };
  }

  getCostComponentPercentage(val: number): number {
    const total = this.getSumOfCostComponents() || this.analysisData()?.costEstimate?.totalCost || 1;
    if (total <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((val / total) * 100)));
  }

  getWbsCapacityPercentage(): number {
    const resHrs = this.getTotalResourceHours();
    const wbsHrs = this.getTotalWbsHours();
    if (resHrs <= 0) return 22;
    return Math.min(100, Math.round((wbsHrs / resHrs) * 100));
  }
}
