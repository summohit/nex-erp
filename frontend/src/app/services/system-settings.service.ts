import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SystemSetting {
  id: number;
  companyId: number;
  shiftRosterVisibleToEmployees: boolean;
  offerLetterTemplateHtml?: string | null;
  offerLetterTemplateDocxUrl?: string | null;
  offerLetterConfig?: Record<string, any> | null;
  /** Employee every new ticket is auto-assigned to (the software dev PM). */
  defaultTicketAssigneeId?: number | null;
}

export interface PlaceholderTag {
  tag: string;
  label: string;
}

export interface PlaceholderGroup {
  group: string;
  tags: PlaceholderTag[];
}

export interface OfferLetterTemplateInfo {
  defaultHtml: string;
  placeholders: PlaceholderGroup[];
}

@Injectable({
  providedIn: 'root'
})
export class SystemSettingsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/system-settings`;

  getSettings(): Observable<SystemSetting> {
    return this.http.get<SystemSetting>(this.apiUrl);
  }

  updateSettings(data: Partial<SystemSetting>): Observable<SystemSetting> {
    return this.http.put<SystemSetting>(this.apiUrl, data);
  }

  /** Built-in template source + the full merge-tag reference. */
  getOfferLetterTemplate(): Observable<OfferLetterTemplateInfo> {
    return this.http.get<OfferLetterTemplateInfo>(`${this.apiUrl}/offer-letter/template`);
  }

  /** Active template rendered against sample candidate data, ready for an iframe. */
  previewOfferLetter(): Observable<{ html: string }> {
    return this.http.get<{ html: string }>(`${this.apiUrl}/offer-letter/preview`);
  }
}
