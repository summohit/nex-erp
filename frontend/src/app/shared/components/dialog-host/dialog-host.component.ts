import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogService } from '../../services/dialog.service';

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

  /**
   * Proof is meant to be a screenshot or a photo, so the ceiling is generous
   * but real: the upload endpoint will refuse something enormous anyway, and
   * finding that out after the clock-out has been submitted is the worst place
   * to find it out.
   */
  private static readonly MAX_BYTES = 10 * 1024 * 1024;

  onFilePicked(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.attachError.set(null);

    if (file && file.size > DialogHostComponent.MAX_BYTES) {
      this.attachError.set('That file is over 10 MB. Please attach a smaller one.');
      // Cleared so the same file can be picked again after it is shrunk;
      // a file input will not re-fire change for an unchanged value.
      input.value = '';
      return;
    }

    this.dialog.promptFile = file;
    input.value = '';
  }

  clearFile() {
    this.dialog.promptFile = null;
    this.attachError.set(null);
  }

  fileSizeLabel(file: File): string {
    const kb = file.size / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  }

  respond(result: boolean) {
    this.attachError.set(null);
    this.dialog.respond(result);
  }

  /** A required prompt cannot be submitted empty — the server would refuse it. */
  get canSubmitPrompt(): boolean {
    const s = this.dialog.state();
    if (s?.variant !== 'prompt') return true;
    return !s.required || this.dialog.promptValue.trim().length > 0;
  }
}
