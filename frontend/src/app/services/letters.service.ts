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
  body?: string;
  pdfUrl?: string | null;
  createdAt: string;
  employee: { id: number; firstName: string; lastName: string; employeeCode?: string | null; avatarUrl?: string | null };
  template?: { id: number; title: string } | null;
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

  getLetter(id: number): Observable<GeneratedLetter> {
    return this.http.get<GeneratedLetter>(`${this.apiUrl}/${id}`);
  }

  generate(data: {
    templateId: number; employeeId: number; signatoryEmployeeId?: number;
    title?: string; body?: string;
  }): Observable<GeneratedLetter> {
    return this.http.post<GeneratedLetter>(this.apiUrl, data);
  }

  deleteLetter(id: number): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
