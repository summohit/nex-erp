import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  LucidePlus, LucideX,
  LucideTrash2, LucideLayoutGrid,
  LucideCreditCard, LucideUser, LucideShieldCheck, LucideGraduationCap,
  LucidePlane, LucideUsers, LucideSettings, LucideEdit2, LucidePaperclip, LucideMapPin,
  LucideUploadCloud, LucideFileText, LucideCheckCircle2, LucideMail
} from '@lucide/angular';
import { EmployeeService, Employee } from '../../../services/employee.service';
import { MasterDataService, Branch, Department, Designation } from '../../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
import { AuthService } from '../../../services/auth.service';
import { Country, State, City } from 'country-state-city';

export interface ResumeLine {
  id: number;
  type: 'Experience' | 'Education' | 'Certification';
  title: string;
  organization: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  attachmentUrl?: string;
}

export interface SkillItem {
  id: number;
  category: string;
  name: string;
  level: string;
}

export interface ProfileFormErrors {
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: string;
  homeWorkDistanceKm?: string;
  childrenCount?: string;
}

@Component({
  selector: 'app-profile-tab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucidePlus,
    LucideX, 
    LucideTrash2,
    LucideMapPin,
    LucideLayoutGrid, 
    LucideCreditCard, 
    LucideUser, 
    LucideShieldCheck,
    LucideGraduationCap, 
    LucidePlane, 
    LucideUsers, 
    LucideSettings,
    LucideEdit2,
    LucidePaperclip,
    LucideUploadCloud,
    LucideFileText,
    LucideCheckCircle2,
    LucideMail
  ],
  templateUrl: './profile-tab.html',
  styleUrls: ['./profile-tab.css']
})
export class ProfileTabComponent implements OnInit {
  private _employeeData: any;

  // Re-builds the form whenever employeeData changes (initial load AND after
  // a save triggers refreshProfile), so the form never shows stale values.
  @Input() set employeeData(value: any) {
    this._employeeData = value;
    if (value) {
      this.initForm();
    }
  }
  get employeeData(): any {
    return this._employeeData;
  }

  @Input() isOwner: boolean = false;
  @Input() activeSubTab: string = 'work';
  @Output() refreshProfile = new EventEmitter<void>();
  @Output() tabChange = new EventEmitter<'work' | 'resume' | 'personal'>();

  formData: any = {};
  errors: ProfileFormErrors = {};
  personalSubTab: 'all' | 'contact_bank' | 'personal' | 'citizenship_visa' | 'location' | 'family_edu' | 'bio' = 'all';

  // Maps each validated field to the tab/sub-tab that contains it, so validation
  // errors can auto-navigate to the right section before scrolling to the field.
  private fieldTabMap: Record<string, { parent: 'work' | 'resume' | 'personal'; subTab?: 'all' | 'contact_bank' | 'personal' | 'citizenship_visa' | 'location' | 'family_edu' | 'bio' }> = {
    firstName: { parent: 'personal', subTab: 'personal' },
    lastName: { parent: 'personal', subTab: 'personal' },
    phone: { parent: 'personal', subTab: 'contact_bank' },
    dateOfBirth: { parent: 'personal', subTab: 'personal' },
    homeWorkDistanceKm: { parent: 'personal', subTab: 'location' },
    childrenCount: { parent: 'personal', subTab: 'family_edu' }
  };

  setPersonalSubTab(tab: 'all' | 'contact_bank' | 'personal' | 'citizenship_visa' | 'location' | 'family_edu' | 'bio') {
    this.personalSubTab = tab;
  }
  allEmployees: Employee[] = [];
  companyBranches: Branch[] = [];
  companyDepartments: Department[] = [];
  companyDesignations: Designation[] = [];
  dynamicLocationOptions: string[] = ['Unspecified', 'Home', 'Other'];

  get canEditWorkDetails(): boolean {
    const token = localStorage.getItem('access_token');
    let role = '';
    if (token) {
      try {
        role = JSON.parse(atob(token.split('.')[1])).role;
      } catch (e) {}
    }
    return role === 'ADMIN' || role === 'HR' || role === 'SUPERADMIN';
  }

  get canEditPersonalDetails(): boolean {
    return this.isOwner || this.canEditWorkDetails;
  }

  // HR/Admin/Superadmin can edit and save work details of other employees.
  // This mirrors the backend checkProfileEditPermission (role-based + designation editors).
  get canSaveProfile(): boolean {
    return this.isOwner || this.canEditWorkDetails;
  }

  countries = Country.getAllCountries();
  states: any[] = [];
  cities: any[] = [];

  // Skills Modal State
  isUpdateSkillsModalOpen = false;
  selectedSkillCategory = 'Languages';
  selectedSkillNames = new Set<string>();
  selectedSkillLevel = 'A1';

  skillCategories = ['Languages', 'Soft Skills', 'Technical Skills', 'Management'];

  skillsByCategory: Record<string, string[]> = {
    'Languages': [
      'French', 'Spanish', 'English', 'German', 'Filipino', 'Arabic', 'Bengali', 
      'Mandarin Chinese', 'Wu Chinese', 'Hindi', 'Russian', 'Portuguese', 'Indonesian', 
      'Urdu', 'Japanese', 'Punjabi', 'Javanese', 'Telugu', 'Turkish', 'Korean', 'Marathi'
    ],
    'Soft Skills': [
      'Leadership', 'Communication', 'Problem Solving', 'Time Management', 
      'Teamwork', 'Negotiation', 'Conflict Resolution', 'Critical Thinking'
    ],
    'Technical Skills': [
      'Angular', 'React', 'TypeScript', 'Node.js', 'Python', 'PostgreSQL', 
      'AWS', 'UI/UX Design', 'Docker', 'Git', 'REST APIs'
    ],
    'Management': [
      'Project Management', 'Agile / Scrum', 'Resource Planning', 'Budgeting', 'Risk Management'
    ]
  };

  levelsByCategory: Record<string, string[]> = {
    'Languages': ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
    'Soft Skills': ['Beginner', 'Intermediate', 'Advanced', 'Expert'],
    'Technical Skills': ['Beginner', 'Intermediate', 'Advanced', 'Expert'],
    'Management': ['Beginner', 'Intermediate', 'Advanced', 'Expert']
  };

  // Resume Lines Modal State
  isCreateResumeModalOpen = false;
  newResumeLine: Partial<ResumeLine> = {
    type: 'Experience',
    title: '',
    organization: '',
    startDate: '',
    endDate: '',
    description: ''
  };

  constructor(
    private employeeService: EmployeeService, 
    private masterDataService: MasterDataService,
    private toast: HotToastService, 
    private router: Router,
    private authService: AuthService
  ) {}

  ngOnInit() {
    this.loadAllEmployees();
    this.loadBranches();
    this.loadDepartments();
    this.loadDesignations();
  }

  loadDepartments() {
    this.masterDataService.getDepartments().subscribe({
      next: (deps) => this.companyDepartments = deps || [],
      error: (err) => console.error('Failed to load departments', err)
    });
  }

  loadDesignations() {
    this.masterDataService.getDesignations().subscribe({
      next: (desgs) => this.companyDesignations = desgs || [],
      error: (err) => console.error('Failed to load designations', err)
    });
  }

  loadBranches() {
    this.masterDataService.getBranches().subscribe({
      next: (branches) => {
        this.companyBranches = branches || [];
        this.dynamicLocationOptions = [
          'Unspecified', 
          'Home', 
          ...this.companyBranches.map(b => b.name), 
          'Other'
        ];
      },
      error: (err) => console.error('Failed to load branches', err)
    });
  }

  loadAllEmployees() {
    // Use the minimal list endpoint so any authenticated employee (e.g. viewing
    // their own profile) can populate the manager selector + org chart without
    // needing full employee-directory permission.
    this.employeeService.getEmployeesBasicList().subscribe({
      next: (list) => {
        this.allEmployees = list || [];
      },
      error: (err) => console.error('Failed to load employee list for manager selector', err)
    });
  }

  initForm() {
    if (this.employeeData) {
      // Load extra profile metadata from localStorage
      let extraMeta: any = {};
      try {
        const stored = localStorage.getItem(`emp_extra_profile_${this.employeeData.id}`);
        if (stored) {
          extraMeta = JSON.parse(stored);
        }
      } catch (e) {}

      this.formData = {
        salutation: this.employeeData.salutation || 'Mr',
        firstName: this.employeeData.firstName,
        lastName: this.employeeData.lastName,
        email: this.employeeData.user?.email,
        password: '',
        country: this.employeeData.country || '',
        state: this.employeeData.state || '',
        city: this.employeeData.city || '',
        phone: this.employeeData.phone || '',
        language: this.employeeData.language || 'English',
        gender: this.employeeData.gender || 'Male',
        dateOfBirth: this.employeeData.dateOfBirth ? new Date(this.employeeData.dateOfBirth).toISOString().split('T')[0] : '',
        slackId: this.employeeData.slackId || '',
        maritalStatus: this.employeeData.maritalStatus || 'Single',
        address: this.employeeData.address || '',
        about: this.employeeData.about || '',
        avatarUrl: this.employeeData.avatarUrl || '',

        // Work fields from screenshot 1 & 2
        departmentId: this.employeeData.departmentId || this.employeeData.department?.id || null,
        designationId: this.employeeData.designationId || this.employeeData.designation?.id || null,
        managerId: this.employeeData.managerId || this.employeeData.manager?.id || null,
        branchId: this.employeeData.branchId || this.employeeData.branch?.id || null,
        nextAppraisalDate: this.employeeData.nextAppraisalDate 
          ? new Date(this.employeeData.nextAppraisalDate).toISOString().split('T')[0] 
          : '',

        // Usual work location mapping per day (screenshot 2 & 3)
        usualWorkLocation: this.employeeData.usualWorkLocation || {
          monday: 'Unspecified',
          tuesday: 'Unspecified',
          wednesday: 'Unspecified',
          thursday: 'Unspecified',
          friday: 'Unspecified',
          saturday: 'Unspecified',
          sunday: 'Unspecified'
        },
        workNotes: this.employeeData.workNotes || '',

        // Bank Details
        bankName: this.employeeData.bankName || '',
        bankAccountNumber: this.employeeData.bankAccountNumber || '',
        ifscCode: this.employeeData.ifscCode || '',

        // Place of Birth
        placeOfBirthCity: this.employeeData.placeOfBirthCity || '',
        placeOfBirthCountry: this.employeeData.placeOfBirthCountry || '',

        // Citizenship & Identification
        nationality: this.employeeData.nationality || 'Indian',
        identificationNo: this.employeeData.identificationNo || '',
        passportNo: this.employeeData.passportNo || '',

        // Visa & Work Permit
        visaNo: this.employeeData.visaNo || '',
        workPermitNo: this.employeeData.workPermitNo || '',

        // Location & Distance
        zipCode: this.employeeData.zipCode || '',
        homeWorkDistanceKm: this.employeeData.homeWorkDistanceKm !== null && this.employeeData.homeWorkDistanceKm !== undefined ? this.employeeData.homeWorkDistanceKm : '',

        // Family Details
        spouseName: this.employeeData.spouseName || '',
        spouseBirthdate: this.employeeData.spouseBirthdate ? new Date(this.employeeData.spouseBirthdate).toISOString().split('T')[0] : '',
        childrenCount: this.employeeData.childrenCount !== null && this.employeeData.childrenCount !== undefined ? this.employeeData.childrenCount : '',

        // Education
        educationLevel: this.employeeData.educationLevel || 'Bachelor',
        fieldOfStudy: this.employeeData.fieldOfStudy || '',

        // Resume & Skills (from backend DB)
        skills: this.employeeData.skills || [],
        resumeLines: this.employeeData.resumeLines || []
      };
      
      this.onCountryChange(false);
      this.onStateChange(false);
    }
  }

  // --- Org Chart Helpers ---
  get selectedManager() {
    if (!this.formData.managerId) return null;
    return this.allEmployees.find(e => Number(e.id) === Number(this.formData.managerId)) || null;
  }

  get directReports() {
    if (!this.employeeData?.id) return [];
    return this.allEmployees.filter(e => e.id !== this.employeeData.id && (e as any).managerId === this.employeeData.id);
  }

  // --- Skills Modal Handlers ---
  openUpdateSkillsModal() {
    this.selectedSkillCategory = 'Languages';
    this.selectedSkillNames = new Set<string>();
    this.selectedSkillLevel = this.levelsByCategory['Languages'][0];
    this.isUpdateSkillsModalOpen = true;
  }

  closeUpdateSkillsModal() {
    this.isUpdateSkillsModalOpen = false;
  }

  onCategoryChange(cat: string) {
    this.selectedSkillCategory = cat;
    this.selectedSkillNames = new Set<string>();
    const levels = this.levelsByCategory[cat] || [];
    this.selectedSkillLevel = levels[0] || '';
  }

  toggleSkillName(skill: string) {
    if (this.selectedSkillNames.has(skill)) {
      this.selectedSkillNames.delete(skill);
    } else {
      this.selectedSkillNames.add(skill);
    }
  }

  selectSkillLevel(lvl: string) {
    this.selectedSkillLevel = lvl;
  }

  saveSkill(andNew: boolean = false) {
    if (this.selectedSkillNames.size === 0) return;

    for (const skillName of this.selectedSkillNames) {
      const existingIdx = this.formData.skills.findIndex(
        (s: any) => s.category === this.selectedSkillCategory && s.name === skillName
      );

      if (existingIdx > -1) {
        this.formData.skills[existingIdx].level = this.selectedSkillLevel;
      } else {
        this.formData.skills.push({
          id: Date.now() + Math.random(),
          category: this.selectedSkillCategory,
          name: skillName,
          level: this.selectedSkillLevel
        });
      }
    }

    this.toast.success(`${this.selectedSkillNames.size} skill(s) updated`);
    this.saveProfile();
    this.selectedSkillNames = new Set<string>();

    if (!andNew) {
      this.closeUpdateSkillsModal();
    }
  }

  removeSkill(idx: number) {
    this.formData.skills.splice(idx, 1);
    this.toast.success('Skill removed');
    this.saveProfile();
  }

  // --- Resume Lines Modal Handlers ---
  resumeFormSubmitted = false;
  selectedResumeFile: File | null = null;
  isUploadingResume = false;
  editingResumeLineIndex: number | null = null;

  openCreateResumeModal(line?: any, index?: number) {
    this.resumeFormSubmitted = false;
    this.selectedResumeFile = null;
    if (line !== undefined && index !== undefined) {
      this.editingResumeLineIndex = index;
      this.newResumeLine = { ...line };
    } else {
      this.editingResumeLineIndex = null;
      this.newResumeLine = {
        type: 'Experience',
        title: '',
        organization: '',
        startDate: '',
        endDate: '',
        description: ''
      };
    }
    this.isCreateResumeModalOpen = true;
  }

  closeCreateResumeModal() {
    this.isCreateResumeModalOpen = false;
    this.selectedResumeFile = null;
    this.editingResumeLineIndex = null;
  }

  isEndDateInvalid(): boolean {
    if (this.newResumeLine.startDate && this.newResumeLine.endDate) {
      return new Date(this.newResumeLine.endDate) < new Date(this.newResumeLine.startDate);
    }
    return false;
  }

  onResumeFileSelected(event: any) {
    const file = event.target.files[0];
    if (file) {
      this.selectedResumeFile = file;
    }
  }

  clearResumeFile(event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.selectedResumeFile = null;
    if (this.newResumeLine) {
      this.newResumeLine.attachmentUrl = undefined;
    }
  }

  saveResumeLine() {
    this.resumeFormSubmitted = true;
    if (!this.newResumeLine.title?.trim() || !this.newResumeLine.organization?.trim()) {
      return;
    }
    if (this.isEndDateInvalid()) {
      return;
    }

    if (this.selectedResumeFile) {
      this.isUploadingResume = true;
      this.toast.loading('Uploading attachment...', { id: 'resume-upload' });
      this.employeeService.uploadResumePdf(this.selectedResumeFile).subscribe({
        next: (res) => {
          this.toast.success('Attachment uploaded', { id: 'resume-upload' });
          this.isUploadingResume = false;
          this.pushResumeLineToForm(res.url);
        },
        error: (err) => {
          this.toast.error('Failed to upload attachment', { id: 'resume-upload' });
          this.isUploadingResume = false;
          console.error(err);
        }
      });
    } else {
      this.pushResumeLineToForm();
    }
  }

  private pushResumeLineToForm(attachmentUrl?: string) {
    const payload = {
      id: this.newResumeLine.id || Date.now(),
      type: this.newResumeLine.type || 'Experience',
      title: (this.newResumeLine.title || '').trim(),
      organization: (this.newResumeLine.organization || '').trim(),
      startDate: this.newResumeLine.startDate,
      endDate: this.newResumeLine.endDate,
      description: this.newResumeLine.description,
      attachmentUrl: attachmentUrl || this.newResumeLine.attachmentUrl || null
    };

    if (this.editingResumeLineIndex !== null) {
      this.formData.resumeLines[this.editingResumeLineIndex] = payload;
      this.toast.success('Resume line updated');
    } else {
      this.formData.resumeLines.push(payload);
      this.toast.success('Resume line created');
    }

    this.closeCreateResumeModal();
    this.saveProfile();
  }

  removeResumeLine(idx: number) {
    this.formData.resumeLines.splice(idx, 1);
    this.toast.success('Resume line removed');
    this.saveProfile();
  }

  // --- Country / State / City Handlers ---
  onCountryChange(resetChildren: boolean = true) {
    if (this.formData.country) {
      this.states = State.getStatesOfCountry(this.formData.country);
      if (resetChildren) {
        this.formData.state = '';
        this.cities = [];
        this.formData.city = '';
      } else {
        if (!this.states.find(s => s.isoCode === this.formData.state)) {
          this.formData.state = '';
        }
      }
    } else {
      this.states = [];
      this.formData.state = '';
      this.cities = [];
      this.formData.city = '';
    }
  }

  onStateChange(resetChildren: boolean = true) {
    if (this.formData.country && this.formData.state) {
      this.cities = City.getCitiesOfState(this.formData.country, this.formData.state);
      if (resetChildren) {
        this.formData.city = '';
      } else {
        if (!this.cities.find(c => c.name === this.formData.city)) {
          this.formData.city = '';
        }
      }
    } else {
      this.cities = [];
      this.formData.city = '';
    }
  }

  isSendingResetEmail = false;

  sendPasswordResetEmail() {
    if (!this.isOwner || this.isSendingResetEmail) return;
    this.isSendingResetEmail = true;
    this.authService.sendPasswordResetEmail().subscribe({
      next: (res: any) => {
        this.isSendingResetEmail = false;
        this.toast.success(res?.message || 'Password reset code sent to your email.');
      },
      error: (err: any) => {
        this.isSendingResetEmail = false;
        this.toast.error(err.error?.message || 'Failed to send password reset email.');
      }
    });
  }

  handleAvatarUpload(event: any) {
    if (!this.isOwner) return;
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.formData.avatarUrl = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  isSaving = false;

  saveProfile() {
    if (!this.canSaveProfile || this.isSaving) return;

    if (!this.validateForm()) {
      return;
    }

    this.isSaving = true;

    // Construct payload for API
    const payload = {
      ...this.formData,
      managerId: this.formData.managerId ? Number(this.formData.managerId) : null,
      branchId: this.formData.branchId ? Number(this.formData.branchId) : null,
      departmentId: this.formData.departmentId ? Number(this.formData.departmentId) : null,
      designationId: this.formData.designationId ? Number(this.formData.designationId) : null,
      skills: this.formData.skills,
      resumeLines: this.formData.resumeLines
    };

    if (!payload.password) {
      delete payload.password;
    }

    this.employeeService.updateProfile(this.employeeData.id, payload).subscribe({
      next: () => {
        this.isSaving = false;
        this.toast.success('Profile updated successfully');
        this.errors = {};
        this.refreshProfile.emit();
      },
      error: (err: any) => {
        this.isSaving = false;
        this.toast.error('Failed to update profile');
        console.error(err);
      }
    });
  }

  private validateForm(): boolean {
    this.errors = {};
    let valid = true;

    if (!this.formData.firstName?.trim()) {
      this.errors.firstName = 'First name is required.';
      valid = false;
    }

    if (!this.formData.lastName?.trim()) {
      this.errors.lastName = 'Last name is required.';
      valid = false;
    }

    if (this.formData.phone) {
      const phoneRegex = /^\+?[0-9]{10,15}$/;
      if (!phoneRegex.test(this.formData.phone)) {
        this.errors.phone = 'Enter a valid mobile number (10–15 digits).';
        valid = false;
      }
    }

    if (this.formData.dateOfBirth) {
      const dob = new Date(this.formData.dateOfBirth + 'T00:00:00');
      if (dob > new Date()) {
        this.errors.dateOfBirth = 'Date of birth cannot be in the future.';
        valid = false;
      }
    }

    const distance = Number(this.formData.homeWorkDistanceKm);
    if (this.formData.homeWorkDistanceKm !== '' && this.formData.homeWorkDistanceKm != null && !isNaN(distance) && distance < 0) {
      this.errors.homeWorkDistanceKm = 'Distance cannot be negative.';
      valid = false;
    }

    const children = Number(this.formData.childrenCount);
    if (this.formData.childrenCount !== '' && this.formData.childrenCount != null && !isNaN(children) && children < 0) {
      this.errors.childrenCount = 'Children count cannot be negative.';
      valid = false;
    }

    if (!valid) {
      this.toast.error('Please fix the highlighted fields below.');
      this.focusFirstError();
    }

    return valid;
  }

  clearError(field: keyof ProfileFormErrors) {
    if (this.errors[field]) {
      delete this.errors[field];
    }
  }

  private focusFirstError() {
    const order: (keyof ProfileFormErrors)[] = ['firstName', 'lastName', 'phone', 'dateOfBirth', 'homeWorkDistanceKm', 'childrenCount'];
    const first = order.find(k => !!this.errors[k]);
    if (!first) return;

    const target = this.fieldTabMap[first];

    // Navigate to the tab/sub-tab that contains the errored field
    if (this.activeSubTab !== target.parent) {
      this.tabChange.emit(target.parent);
    }
    if (target.parent === 'personal' && target.subTab) {
      this.personalSubTab = target.subTab;
    }

    // Wait a tick for the tab content to render, then scroll & focus the field
    setTimeout(() => {
      const el = document.getElementById(`field-${first}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const input = el.querySelector('input, select, textarea') as HTMLElement | null;
        input?.focus({ preventScroll: true });
      }
    }, 60);
  }

  goBack() {
    const token = localStorage.getItem('access_token');
    let role = '';
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        role = payload.role;
      } catch (e) {}
    }
    
    if (role === 'ADMIN' || role === 'HR') {
      this.router.navigate(['/employees']);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
