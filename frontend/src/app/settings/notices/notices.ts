import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HotToastService } from '@ngneat/hot-toast';
import {
  LucideMegaphone, LucidePlus, LucideX, LucideMail, LucideArchive, LucideEdit2,
  LucidePaperclip, LucideUploadCloud, LucideFileText, LucideLoader2,
} from '@lucide/angular';
import { NoticesService, Notice } from '../../services/notices';
import { UploadService } from '../../services/upload.service';

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
    LucidePaperclip, LucideUploadCloud, LucideFileText, LucideLoader2,
  ],
  templateUrl: './notices.html',
  styleUrls: ['./notices.css'],
})
export class NoticesComponent {
  private api = inject(NoticesService);
  private toast = inject(HotToastService);
  private uploads = inject(UploadService);

  notices = signal<Notice[]>([]);
  /**
   * Whether this person may post, as the server reports it.
   *
   * Taken from the response rather than inferred from a role string here:
   * the server decides who may announce things, and a second opinion in the
   * client is a second thing to keep in step with it.
   */
  canPost = signal(false);
  loading = signal(true);
  saving = signal(false);
  formOpen = signal(false);
  editingId = signal<number | null>(null);

  form = this.blank();

  /**
   * Files chosen for the notice being written.
   *
   * Uploaded as they are picked rather than on submit, so a slow upload does
   * not sit between the author pressing Post and the notice existing -- and
   * so a failure is reported next to the file that failed rather than as one
   * opaque error at the end.
   */
  attachments = signal<{ fileName: string; fileUrl: string; fileSize?: number }[]>([]);
  uploading = signal(false);

  onFilesPicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;

    this.uploading.set(true);
    let remaining = files.length;

    for (const file of files) {
      this.uploads.uploadFile(file).subscribe({
        next: (res: any) => {
          const url = res?.url || res?.fileUrl || res?.secure_url;
          if (url) {
            this.attachments.update((list) => [
              ...list,
              { fileName: file.name, fileUrl: url, fileSize: file.size },
            ]);
          } else {
            this.toast.error(`${file.name} uploaded but returned no link`);
          }
          if (--remaining === 0) this.uploading.set(false);
        },
        error: (err) => {
          if (--remaining === 0) this.uploading.set(false);
          this.toast.error(err?.error?.message || `Could not upload ${file.name}`);
        },
      });
    }
  }

  removeAttachment(index: number) {
    this.attachments.update((list) => list.filter((_, i) => i !== index));
  }

  fileSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  activeCount = computed(() => this.notices().filter((n) => n.isActive).length);

  /**
   * Whether a notice has stopped showing to everybody else.
   *
   * Only whoever may post sees expired notices at all, and without this the
   * board showed them looking perfectly ordinary -- so an expired notice read
   * as a live one to the only person able to notice it had lapsed.
   */
  hasExpired(n: Notice): boolean {
    return !!n.expiresAt && new Date(n.expiresAt).getTime() < Date.now();
  }

  /** Not yet showing: written today for next week. */
  isScheduled(n: Notice): boolean {
    return !!n.publishedAt && new Date(n.publishedAt).getTime() > Date.now();
  }

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
      next: (res) => {
        this.notices.set(res?.notices || []);
        this.canPost.set(!!res?.canPost);
        this.loading.set(false);
      },
      error: (err) => {
        this.loading.set(false);
        this.toast.error(err?.error?.message || 'Could not load the notice board');
      },
    });
  }

  openNew() {
    this.form = this.blank();
    this.attachments.set([]);
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
      attachments: this.attachments(),
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
