import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { 
  LucideLoader2, 
  LucideCheckCircle2, 
  LucideAlertCircle, 
  LucideSend,
  LucideUser,
  LucideMail,
  LucideBuilding,
  LucidePhone,
  LucideGlobe,
  LucideMessageSquare,
  LucideMapPin,
  LucideBriefcase,
  LucideShieldCheck,
  LucideSparkles,
  LucideChevronDown,
  LucideArrowRight,
  LucideRotateCcw
} from '@lucide/angular';

export interface PublicField {
  fieldKey: string;
  label: string;
  type: string;
  required: boolean;
  isName: boolean;
  options?: string[];
}

type Status = 'loading' | 'ready' | 'success' | 'notfound' | 'error';

@Component({
  selector: 'app-public-lead-form',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    LucideLoader2, 
    LucideCheckCircle2, 
    LucideAlertCircle, 
    LucideSend,
    LucideUser,
    LucideMail,
    LucideBuilding,
    LucidePhone,
    LucideGlobe,
    LucideMessageSquare,
    LucideMapPin,
    LucideBriefcase,
    LucideShieldCheck,
    LucideSparkles,
    LucideChevronDown,
    LucideArrowRight,
    LucideRotateCcw
  ],
  templateUrl: './lead-form.html',
  styleUrls: ['./lead-form.css']
})
export class PublicLeadFormComponent implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);

  formKey = '';
  status: Status = 'loading';
  name = '';
  description = '';
  successMessage = '';
  fields: PublicField[] = [];
  values: Record<string, string> = {};
  errors: Record<string, string> = {};
  submitting = false;
  serverError = '';

  ngOnInit() {
    this.route.paramMap.subscribe((params) => {
      this.formKey = params.get('formId') || '';
      this.loadForm();
    });
  }

  loadForm() {
    this.status = 'loading';
    this.http.get<any>(`${environment.apiUrl}/public/lead-form/${this.formKey}`).subscribe({
      next: (form) => {
        this.name = form.name || '';
        this.description = form.description || '';
        this.successMessage = form.successMessage || 'Thank you! Your enquiry has been received.';
        this.fields = form.fields || [];
        this.values = {};
        this.errors = {};
        this.status = 'ready';
      },
      error: () => {
        this.status = this.isLikelyNotFound() ? 'notfound' : 'error';
      }
    });
  }

  private isLikelyNotFound(): boolean {
    return true;
  }

  isFullWidth(field: PublicField): boolean {
    if (field.type === 'textarea') return true;
    const key = (field.fieldKey || '').toLowerCase();
    return key === 'message' || key === 'address' || key === 'description' || key === 'notes' || key === 'comments';
  }

  getFieldIconType(field: PublicField): string {
    const key = (field.fieldKey || '').toLowerCase();
    const type = (field.type || '').toLowerCase();

    if (key.includes('name') || field.isName) return 'user';
    if (key.includes('email') || type === 'email') return 'mail';
    if (key.includes('company') || key.includes('org') || key.includes('business')) return 'building';
    if (key.includes('phone') || key.includes('mobile') || key.includes('tel') || type === 'tel') return 'phone';
    if (key.includes('web') || key.includes('url') || key.includes('site') || type === 'url') return 'globe';
    if (key.includes('message') || key.includes('desc') || key.includes('note') || type === 'textarea') return 'message';
    if (key.includes('city') || key.includes('state') || key.includes('country') || key.includes('postal') || key.includes('zip') || key.includes('address')) return 'map-pin';
    if (key.includes('source') || key.includes('lead') || key.includes('referral') || key.includes('campaign')) return 'sparkles';
    if (type === 'select') return 'select';
    return 'default';
  }

  resetForm() {
    this.values = {};
    this.errors = {};
    this.serverError = '';
    this.status = 'ready';
  }

  get completedFieldsCount(): number {
    return Object.keys(this.values).filter(k => (this.values[k] || '').trim().length > 0).length;
  }

  onSubmit() {
    if (this.submitting) return;
    this.errors = {};
    let valid = true;
    for (const field of this.fields) {
      const v = (this.values[field.fieldKey] || '').trim();
      if ((field.required || field.isName) && !v) {
        this.errors[field.fieldKey] = `${field.label} is required.`;
        valid = false;
        continue;
      }
      if (!v) continue;
      if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        this.errors[field.fieldKey] = 'Please enter a valid email address.';
        valid = false;
      }
      if (field.type === 'url') {
        const test = v.startsWith('http') ? v : `https://${v}`;
        if (!/^(https?:\/\/)?([\w-]+\.)+[\w-]+(\/[\w\-./?%&=]*)?$/i.test(test)) {
          this.errors[field.fieldKey] = 'Please enter a valid website URL.';
          valid = false;
        }
      }
    }
    if (!valid) return;

    this.submitting = true;
    this.serverError = '';
    this.http.post<any>(`${environment.apiUrl}/public/lead-form/${this.formKey}/submit`, this.values).subscribe({
      next: (res) => {
        this.submitting = false;
        this.successMessage = res.message || 'Thank you! Your enquiry has been received.';
        this.status = 'success';
        if (res.redirectUrl) {
          setTimeout(() => {
            window.location.href = res.redirectUrl;
          }, 1500);
        }
      },
      error: (err) => {
        this.submitting = false;
        this.serverError = err?.error?.message || 'Something went wrong. Please try again.';
      }
    });
  }

  placeholderFor(field: PublicField): string {
    switch (field.fieldKey) {
      case 'name': return 'e.g. Alexander Pierce';
      case 'email': return 'alexander@company.com';
      case 'companyName': return 'e.g. Acme Innovations Ltd.';
      case 'website': return 'https://company.com';
      case 'mobile': return '+1 (555) 019-2834';
      case 'message': return 'Please outline your deal size, requirements, target timeline, or any specific questions...';
      case 'city': return 'e.g. New York';
      case 'state': return 'e.g. NY';
      case 'postalCode': return 'e.g. 10001';
      case 'address': return 'e.g. 120 Broadway, Suite 300';
      case 'source': return 'e.g. Website, Partner Referral, Conference';
      default: return `Enter ${field.label.toLowerCase()}...`;
    }
  }
}
