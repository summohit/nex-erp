import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideMegaphone, LucidePlus, LucideX, LucideMail, LucideArchive, LucideEdit2,
} from '@lucide/angular';
import { NoticesService, Notice } from '../../services/notices';

/**
 * Posting to the company notice board.
 *
 * Posting emails everybody by default, which is the point of a notice board
 * rather than a page people are expected to visit. The switch exists for the
 * case where the announcement is a correction to one sent ten minutes ago.
 */
@Component({
  selector: 'app-notices',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    LucideMegaphone, LucidePlus, LucideX, LucideMail, LucideArchive, LucideEdit2,
  ],
  templateUrl: './notices.html',
  styleUrls: ['./notices.css'],
})
export class NoticesComponent {
  private api = inject(NoticesService);
  private toast = inject(HotToastService);

  notices = signal<Notice[]>([]);
  loading = signal(true);
  saving = signal(false);
  formOpen = signal(false);
  editingId = signal<number | null>(null);

  form = this.blank();

  activeCount = computed(() => this.notices().filter((n) => n.isActive).length);

  readonly priorities = [
    { value: 'NORMAL', label: 'Normal — appears on the notice board' },
    { value: 'HIGH', label: 'Important — opens on everyone’s dashboard' },
    { value: 'LOW', label: 'Low — informational' },
  ];

  constructor() {
    this.load();
  }

  private blank() {
    return {
      title: '',
      body: '',
      priority: 'NORMAL',
      publishedAt: '',
      expiresAt: '',
      sendEmail: true,
    };
  }

  load() {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (rows) => { this.notices.set(rows || []); this.loading.set(false); },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || 'Could not load the notice board');
      },
    });
  }

  openNew() {
    this.form = this.blank();
    this.editingId.set(null);
    this.formOpen.set(true);
  }

  openEdit(n: Notice) {
    this.form = {
      title: n.title,
      body: n.body,
      priority: n.priority,
      publishedAt: n.publishedAt ? n.publishedAt.slice(0, 10) : '',
      expiresAt: n.expiresAt ? n.expiresAt.slice(0, 10) : '',
      // Editing never re-sends: the announcement has already gone out, and a
      // correction that mails everybody again reads as a second announcement.
      sendEmail: false,
    };
    this.editingId.set(n.id);
    this.formOpen.set(true);
  }

  close() {
    this.formOpen.set(false);
    this.editingId.set(null);
  }

  save() {
    const title = this.form.title.trim();
    const body = this.form.body.trim();
    if (!title) { this.toast.error('A notice needs a title'); return; }
    if (!body) { this.toast.error('A notice needs something to say'); return; }

    const payload = {
      title,
      body,
      priority: this.form.priority,
      publishedAt: this.form.publishedAt || null,
      expiresAt: this.form.expiresAt || null,
      sendEmail: this.form.sendEmail,
    };

    this.saving.set(true);
    const id = this.editingId();
    const req$ = id ? this.api.update(id, payload) : this.api.create(payload as any);

    req$.subscribe({
      next: () => {
        this.saving.set(false);
        this.close();
        this.load();
        this.toast.success(
          id ? 'Notice updated'
             : (this.form.sendEmail ? 'Notice posted and emailed' : 'Notice posted'),
        );
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.message || 'Could not save the notice');
      },
    });
  }

  retire(n: Notice) {
    if (!confirm(`Retire "${n.title}"? It stops appearing on dashboards, but the record is kept.`)) return;
    this.api.retire(n.id).subscribe({
      next: () => { this.load(); this.toast.success('Notice retired'); },
      error: (err) => this.toast.error(err?.error?.message || 'Could not retire the notice'),
    });
  }
}
