import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucideLoader2, LucideCheckCircle2, LucideAlertCircle, LucideSend } from '@lucide/angular';

interface PublicField {
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
  imports: [CommonModule, FormsModule, LucideLoader2, LucideCheckCircle2, LucideAlertCircle, LucideSend],
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
    // A 404 from the server means the form was not found or inactive.
    return true;
  }

  onSubmit() {
    if (this.submitting) return;
    this.errors = {};
    let valid = true;
    for (const field of this.fields) {
      const v = (this.values[field.fieldKey] || '').trim();
      if (field.required && !v) {
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
      case 'name': return 'Your full name';
      case 'email': return 'you@company.com';
      case 'companyName': return 'Company name';
      case 'website': return 'https://example.com';
      case 'mobile': return 'Phone number';
      case 'message': return 'Write your message...';
      case 'city': return 'City';
      case 'state': return 'State';
      case 'postalCode': return 'Postal code';
      case 'address': return 'Street address';
      default: return '';
    }
  }
}
