import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  LucideEye, LucideEyeOff, LucideShuffle, LucidePlus, LucideX, 
  LucideTrash2, LucideLayoutGrid,
  LucideCreditCard, LucideUser, LucideShieldCheck, LucideGraduationCap,
  LucidePlane, LucideUsers, LucideSettings, LucideEdit2, LucidePaperclip, LucideMapPin,
  LucideUploadCloud, LucideFileText, LucideCheckCircle2
} from '@lucide/angular';
import { EmployeeService, Employee } from '../../../services/employee.service';
import { MasterDataService, Branch, Department, Designation } from '../../../services/master-data.service';
import { HotToastService } from '@ngneat/hot-toast';
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

@Component({
  selector: 'app-profile-tab',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    LucideEye, 
    LucideEyeOff, 
    LucideShuffle, 
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
    LucideCheckCircle2
  ],
  templateUrl: './profile-tab.html',
  styleUrls: ['./profile-tab.css']
})
export class ProfileTabComponent implements OnInit {
  @Input() employeeData: any;
  @Input() isOwner: boolean = false;
  @Input() activeSubTab: string = 'work';
  @Output() refreshProfile = new EventEmitter<void>();

  formData: any = {};
  showPassword = false;
  personalSubTab: 'all' | 'contact_bank' | 'personal' | 'citizenship_visa' | 'location' | 'family_edu' | 'bio' = 'all';

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

  countries = Country.getAllCountries();
  states: any[] = [];
  cities: any[] = [];

  // Skills Modal State
  isUpdateSkillsModalOpen = false;
  selectedSkillCategory = 'Languages';
  selectedSkillName = '';
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
    private router: Router
  ) {}

  ngOnInit() {
    this.initForm();
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
    this.employeeService.getEmployees().subscribe({
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
    this.selectedSkillName = this.skillsByCategory['Languages'][0];
    this.selectedSkillLevel = this.levelsByCategory['Languages'][0];
    this.isUpdateSkillsModalOpen = true;
  }

  closeUpdateSkillsModal() {
    this.isUpdateSkillsModalOpen = false;
  }

  onCategoryChange(cat: string) {
    this.selectedSkillCategory = cat;
    const skills = this.skillsByCategory[cat] || [];
    this.selectedSkillName = skills[0] || '';
    const levels = this.levelsByCategory[cat] || [];
    this.selectedSkillLevel = levels[0] || '';
  }

  selectSkillName(skill: string) {
    this.selectedSkillName = skill;
  }

  selectSkillLevel(lvl: string) {
    this.selectedSkillLevel = lvl;
  }

  saveSkill(andNew: boolean = false) {
    if (!this.selectedSkillName) return;

    const existingIdx = this.formData.skills.findIndex(
      (s: any) => s.category === this.selectedSkillCategory && s.name === this.selectedSkillName
    );

    if (existingIdx > -1) {
      this.formData.skills[existingIdx].level = this.selectedSkillLevel;
    } else {
      this.formData.skills.push({
        id: Date.now(),
        category: this.selectedSkillCategory,
        name: this.selectedSkillName,
        level: this.selectedSkillLevel
      });
    }

    this.toast.success(`Skill "${this.selectedSkillName}" updated`);
    this.saveProfile();

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

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  generatePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
    let pass = '';
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.formData.password = pass;
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

  saveProfile() {
    if (!this.isOwner) return;
    
    // Validate phone number if present
    if (this.formData.phone) {
      const phoneRegex = /^\+?[0-9]{10,15}$/;
      if (!phoneRegex.test(this.formData.phone)) {
        this.toast.error('Invalid Mobile number. Must be 10-15 digits.');
        return;
      }
    }

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
        this.toast.success('Profile updated successfully');
        this.refreshProfile.emit();
      },
      error: (err: any) => {
        this.toast.error('Failed to update profile');
        console.error(err);
      }
    });
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
