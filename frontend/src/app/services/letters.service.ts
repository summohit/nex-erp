import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface LetterTemplate {
  id: number;
  title: string;
  body: string;
  description?: string | null;
  isActive: boolean;
  autoOnOnboarding?: boolean;
  scope?: string; // EMPLOYEE | CANDIDATE
  useForOfferLetter?: boolean;
  displayOrder: number;
  createdAt?: string;
  updatedAt?: string;
  _count?: { letters: number };
}

export interface MergeTag {
  tag: string;
  label: string;
  group: string;
}

export interface GeneratedLetter {
  id: number;
  title: string;
  body?: string | null;
  pdfUrl?: string | null;
  createdAt: string;
  employee: {
    id: number | null;
    firstName: string;
    lastName: string;
    employeeCode?: string | null;
    avatarUrl?: string | null;
    email?: string | null;
    phone?: string | null;
    designation?: string | null;
    department?: string | null;
  };
  template?: { id: number | null; title: string } | null;

  /** TEMPLATE = rendered from a letter template; OFFER = recruitment offer letter. */
  source?: 'TEMPLATE' | 'OFFER';

  // Offer-letter rows only
  applicationId?: number | null;
  candidateEmail?: string | null;
  candidatePhone?: string | null;
  jobTitle?: string | null;
  offerStatus?: string;
  isSigned?: boolean;
  signatureName?: string | null;
  signatureType?: string | null;
  signatureIp?: string | null;
  signatureImage?: string | null;
  signedAt?: string | null;
  viewedAt?: string | null;
  signedPdfUrl?: string | null;
  offeredSalary?: number | null;
  joiningDate?: string | null;
}

@Injectable({ providedIn: 'root' })
export class LettersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/letters`;

  getMergeTags(scope?: string): Observable<MergeTag[]> {
    const qs = scope ? `?scope=${scope}` : '';
    return this.http.get<MergeTag[]>(`${this.apiUrl}/merge-tags${qs}`);
  }

  getTemplates(): Observable<LetterTemplate[]> {
    return this.http.get<LetterTemplate[]>(`${this.apiUrl}/templates`);
  }

  getTemplate(id: number): Observable<LetterTemplate> {
    return this.http.get<LetterTemplate>(`${this.apiUrl}/templates/${id}`);
  }

  createTemplate(data: Partial<LetterTemplate>): Observable<LetterTemplate> {
    return this.http.post<LetterTemplate>(`${this.apiUrl}/templates`, data);
  }

  updateTemplate(id: number, data: Partial<LetterTemplate>): Observable<LetterTemplate> {
    return this.http.put<LetterTemplate>(`${this.apiUrl}/templates/${id}`, data);
  }

  deleteTemplate(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/templates/${id}`);
  }

  preview(data: { templateId: number; employeeId: number; signatoryEmployeeId?: number }) {
    return this.http.post<{ title: string; body: string }>(`${this.apiUrl}/preview`, data);
  }

  getLetters(employeeId?: number): Observable<GeneratedLetter[]> {
    const qs = employeeId ? `?employeeId=${employeeId}` : '';
    return this.http.get<GeneratedLetter[]>(`${this.apiUrl}${qs}`);
  }

  getLetter(id: number, source?: string): Observable<GeneratedLetter> {
    const qs = source ? `?source=${source}` : '';
    return this.http.get<GeneratedLetter>(`${this.apiUrl}/${id}${qs}`);
  }

  generate(data: {
    templateId: number; employeeId: number; signatoryEmployeeId?: number;
    title?: string; body?: string;
  }): Observable<GeneratedLetter> {
    return this.http.post<GeneratedLetter>(this.apiUrl, data);
  }

  deleteLetter(id: number, source?: string): Observable<void> {
    const qs = source ? `?source=${source}` : '';
    return this.http.delete<void>(`${this.apiUrl}/${id}${qs}`);
  }
}
