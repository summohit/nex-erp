import { Component, EventEmitter, Input, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpParams } from '@angular/common/http';
import { HotToastService } from '@ngneat/hot-toast';
import { environment } from '../../../../environments/environment';

interface RowResult {
  row: number; sNo: string; project: string; title: string;
  action: 'CREATE' | 'UPDATE' | 'SKIP'; ok: boolean; errors: string[]; warnings: string[]; taskKey?: string;
}
interface Summary { total: number; toCreate: number; toUpdate: number; failed: number; rows: RowResult[]; failedFile?: string | null; }

/**
 * Export / import project tasks in the "template project task" Excel layout.
 *
 * With `projectId` it works on that one project (Project Board); without, it
 * spans every project and each row names its own (Projects page, admins).
 * Import is always preview → confirm: nothing is written until the person has
 * seen which rows will be created, updated or skipped, and why.
 */
@Component({
  selector: 'app-task-transfer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './task-transfer.html',
  styleUrls: ['./task-transfer.css'],
})
export class TaskTransferComponent {
  private http = inject(HttpClient);
  private toast = inject(HotToastService);
  private api = `${environment.apiUrl}/project-tasks`;

  @Input() projectId: number | null = null;
  @Input() projectName = '';
  @Output() closed = new EventEmitter<void>();
  @Output() imported = new EventEmitter<void>();

  tab = signal<'export' | 'import'>('export');
  includeDone = false;
  busy = signal(false);

  file: File | null = null;
  preview = signal<Summary | null>(null);
  result = signal<Summary | null>(null);
  showOnlyProblems = signal(false);

  private params(): HttpParams {
    return this.projectId ? new HttpParams().set('projectIds', String(this.projectId)) : new HttpParams();
  }

  download(kind: 'export' | 'template') {
    let params = this.params();
    if (kind === 'export' && this.includeDone) params = params.set('includeDone', '1');
    this.busy.set(true);
    this.http.get(`${this.api}/${kind}`, { params, responseType: 'blob' }).subscribe({
      next: (blob) => {
        this.busy.set(false);
        const slug = (this.projectName || 'all-projects').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
        this.save(blob, kind === 'template' ? `task-template-${slug}.xlsx` : `tasks-${slug}.xlsx`);
      },
      error: async (err) => {
        this.busy.set(false);
        this.toast.error(await this.messageOf(err));
      },
    });
  }

  pick(event: Event) {
    const f = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.file = f;
    this.preview.set(null);
    this.result.set(null);
    if (f) this.runPreview();
  }

  private form(): FormData {
    const fd = new FormData();
    fd.append('file', this.file!);
    return fd;
  }

  private scope(): HttpParams {
    return this.projectId ? new HttpParams().set('projectId', String(this.projectId)) : new HttpParams();
  }

  runPreview() {
    if (!this.file) return;
    this.busy.set(true);
    this.http.post<Summary>(`${this.api}/import/preview`, this.form(), { params: this.scope() }).subscribe({
      next: (s) => { this.busy.set(false); this.preview.set(s); this.showOnlyProblems.set(s.failed > 0); },
      error: async (err) => { this.busy.set(false); this.toast.error(await this.messageOf(err)); },
    });
  }

  confirmImport() {
    if (!this.file || !this.preview()) return;
    this.busy.set(true);
    this.http.post<Summary>(`${this.api}/import`, this.form(), { params: this.scope() }).subscribe({
      next: (s) => {
        this.busy.set(false);
        this.result.set(s);
        this.preview.set(null);
        const done = s.total - s.failed;
        if (done) this.toast.success(`${done} task(s) imported`);
        if (s.failed) this.toast.error(`${s.failed} row(s) not imported — download them to fix`);
        this.imported.emit();
      },
      error: async (err) => { this.busy.set(false); this.toast.error(await this.messageOf(err)); },
    });
  }

  downloadFailed() {
    const b64 = this.result()?.failedFile;
    if (!b64) return;
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    this.save(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'tasks-to-fix.xlsx');
  }

  reset() {
    this.file = null;
    this.preview.set(null);
    this.result.set(null);
  }

  visibleRows(s: Summary): RowResult[] {
    return this.showOnlyProblems() ? s.rows.filter((r) => !r.ok || r.warnings.length) : s.rows;
  }

  private save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Errors on a blob request arrive as a Blob; read the JSON message out of it. */
  private async messageOf(err: any): Promise<string> {
    try {
      if (err?.error instanceof Blob) {
        const j = JSON.parse(await err.error.text());
        return Array.isArray(j.message) ? j.message.join(', ') : j.message || 'Something went wrong';
      }
    } catch { /* fall through */ }
    const m = err?.error?.message;
    return Array.isArray(m) ? m.join(', ') : m || 'Something went wrong';
  }
}
