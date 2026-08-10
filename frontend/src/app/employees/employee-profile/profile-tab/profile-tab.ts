import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  LucideEye, LucideEyeOff, LucideShuffle, LucidePlus, LucideX, 
  LucideTrash2, LucideHelpCircle, LucideAward, LucideBriefcase, 
  LucideMapPin, LucideBuilding, LucideUserCheck 
} from '@lucide/angular';
import { EmployeeService, Employee } from '../../../services/employee.service';
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
    LucideHelpCircle,
    LucideAward,
    LucideBriefcase,
    LucideMapPin,
    LucideBuilding,
    LucideUserCheck
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
  allEmployees: Employee[] = [];

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

  constructor(private employeeService: EmployeeService, private toast: HotToastService, private router: Router) {}

  ngOnInit() {
    this.initForm();
    this.loadAllEmployees();
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
        departmentName: this.employeeData.department?.name || 'Executive',
        jobPosition: extraMeta.jobPosition || this.employeeData.designation?.name || 'Sales Manager',
        jobTitle: extraMeta.jobTitle || 'Senior Manager',
        managerId: this.employeeData.managerId || this.employeeData.manager?.id || null,
        nextAppraisalDate: extraMeta.nextAppraisalDate || '2027-01-25',
        workAddress: extraMeta.workAddress || 'CES Tech India',
        workLocation: extraMeta.workLocation || 'Building 2, Remote, etc.',

        // Usual work location mapping per day (screenshot 2 & 3)
        usualWorkLocation: extraMeta.usualWorkLocation || {
          monday: 'Unspecified',
          tuesday: 'Unspecified',
          wednesday: 'Unspecified',
          thursday: 'Unspecified',
          friday: 'Unspecified',
          saturday: 'Unspecified',
          sunday: 'Unspecified'
        },
        workNotes: extraMeta.workNotes || '',

        // Skills & Resume Lines (screenshot 4 & 5)
        skills: extraMeta.skills || [
          { id: 1, category: 'Languages', name: 'French', level: 'A1' },
          { id: 2, category: 'Soft Skills', name: 'Leadership', level: 'Expert' }
        ],
        resumeLines: extraMeta.resumeLines || []
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

    if (!andNew) {
      this.closeUpdateSkillsModal();
    }
  }

  removeSkill(idx: number) {
    this.formData.skills.splice(idx, 1);
    this.toast.success('Skill removed');
  }

  // --- Resume Lines Modal Handlers ---
  openCreateResumeModal() {
    this.newResumeLine = {
      type: 'Experience',
      title: '',
      organization: '',
      startDate: '',
      endDate: '',
      description: ''
    };
    this.isCreateResumeModalOpen = true;
  }

  closeCreateResumeModal() {
    this.isCreateResumeModalOpen = false;
  }

  saveResumeLine() {
    if (!this.newResumeLine.title || !this.newResumeLine.organization) {
      this.toast.error('Title and Organization/Institution are required');
      return;
    }

    this.formData.resumeLines.push({
      id: Date.now(),
      type: this.newResumeLine.type || 'Experience',
      title: this.newResumeLine.title,
      organization: this.newResumeLine.organization,
      startDate: this.newResumeLine.startDate,
      endDate: this.newResumeLine.endDate,
      description: this.newResumeLine.description
    });

    this.toast.success('Resume line created');
    this.closeCreateResumeModal();
  }

  removeResumeLine(idx: number) {
    this.formData.resumeLines.splice(idx, 1);
    this.toast.success('Resume line removed');
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

    // Save extra metadata locally for 100% persistence
    const extraMeta = {
      jobPosition: this.formData.jobPosition,
      jobTitle: this.formData.jobTitle,
      nextAppraisalDate: this.formData.nextAppraisalDate,
      workAddress: this.formData.workAddress,
      workLocation: this.formData.workLocation,
      usualWorkLocation: this.formData.usualWorkLocation,
      workNotes: this.formData.workNotes,
      skills: this.formData.skills,
      resumeLines: this.formData.resumeLines
    };

    try {
      localStorage.setItem(`emp_extra_profile_${this.employeeData.id}`, JSON.stringify(extraMeta));
    } catch (e) {}

    // Construct payload for API
    const payload = {
      ...this.formData,
      managerId: this.formData.managerId ? Number(this.formData.managerId) : null
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
