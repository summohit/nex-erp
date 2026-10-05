import { Component, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogService, DialogTone } from '../../services/dialog.service';

@Component({
  selector: 'app-dialog-host',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './dialog-host.component.html',
  styleUrls: ['./dialog-host.component.css']
})
export class DialogHostComponent {
  dialog = inject(DialogService);

  /** Rejected files say why, rather than silently not attaching. */
  attachError = signal<string | null>(null);
  isDragging = signal(false);
  imagePreviewUrl = signal<string | null>(null);

  /**
   * Proof is meant to be a screenshot or a photo, so the ceiling is generous
   * but real: the upload endpoint will refuse something enormous anyway, and
   * finding that out after the clock-out has been submitted is the worst place
   * to find it out.
   */
  private static readonly MAX_BYTES = 10 * 1024 * 1024;

  get currentTone(): DialogTone {
    return this.dialog.getTone(this.dialog.state());
  }

  get charCount(): number {
    return (this.dialog.promptValue || '').trim().length;
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    const s = this.dialog.state();
    if (!s) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      if (this.canSubmitPrompt) {
        event.preventDefault();
        this.respond(true);
      }
    }
  }

  close() {
    this.respond(false);
  }

  onFilePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.handleFile(file);
    input.value = '';
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (file) {
      this.handleFile(file);
    }
  }

  private handleFile(file: File | null) {
    this.attachError.set(null);
    this.clearImagePreview();

    if (!file) return;

    if (file.size > DialogHostComponent.MAX_BYTES) {
      this.attachError.set('That file is over 10 MB. Please attach a smaller one.');
      return;
    }

    this.dialog.promptFile = file;
    if (file.type.startsWith('image/')) {
      this.imagePreviewUrl.set(URL.createObjectURL(file));
    }
  }

  clearFile() {
    this.clearImagePreview();
    this.dialog.promptFile = null;
    this.attachError.set(null);
  }

  private clearImagePreview() {
    const url = this.imagePreviewUrl();
    if (url) {
      URL.revokeObjectURL(url);
      this.imagePreviewUrl.set(null);
    }
  }

  fileSizeLabel(file: File): string {
    const kb = file.size / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }

  respond(result: boolean) {
    this.clearImagePreview();
    this.attachError.set(null);
    this.dialog.respond(result);
  }

  /** A required prompt cannot be submitted empty — the server would refuse it. */
  get canSubmitPrompt(): boolean {
    const s = this.dialog.state();
    if (!s) return false;
    if (s.variant !== 'prompt') return true;
    return !s.required || this.dialog.promptValue.trim().length > 0;
  }
}
