import { Injectable, signal } from '@angular/core';

export type DialogVariant = 'success' | 'error' | 'confirm' | 'prompt';

export interface DialogState {
  variant: DialogVariant;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** 'prompt' only: placeholder for the text box. */
  placeholder?: string;
  /** 'prompt' only: a prompt whose answer is mandatory cannot be confirmed empty. */
  required?: boolean;
  /**
   * 'prompt' only: offer a file alongside the text (§Att4).
   *
   * Optional even when present — a typed reason is still a valid answer on its
   * own, and an approver can ask for proof if they want it. Making evidence
   * mandatory would only teach people to attach any file at all.
   */
  attachment?: { accept: string; label: string; hint?: string };
  resolve: (result: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class DialogService {
  state = signal<DialogState | null>(null);

  confirm(message: string, title = 'Are you sure?', confirmLabel = 'Confirm', cancelLabel = 'Cancel'): Promise<boolean> {
    return new Promise(resolve => {
      this.state.set({ variant: 'confirm', title, message, confirmLabel, cancelLabel, resolve });
    });
  }

  success(message: string, title = 'Success'): Promise<void> {
    return new Promise(resolve => {
      this.state.set({ variant: 'success', title, message, confirmLabel: 'OK', resolve: () => resolve() });
    });
  }

  error(message: string, title = 'Something went wrong'): Promise<void> {
    return new Promise(resolve => {
      this.state.set({ variant: 'error', title, message, confirmLabel: 'OK', resolve: () => resolve() });
    });
  }

  /**
   * Ask for a sentence, not a yes or no.
   *
   * Added for the late clock-out reason, which the server refuses to accept
   * without. Resolves to the trimmed text, or null if the user cancelled —
   * which distinguishes "they declined" from "they typed nothing", and a
   * boolean cannot.
   */
  prompt(
    message: string,
    title = 'Please explain',
    opts: { placeholder?: string; confirmLabel?: string; cancelLabel?: string; required?: boolean } = {},
  ): Promise<string | null> {
    return new Promise(resolve => {
      this.promptValue = '';
      this.state.set({
        variant: 'prompt',
        title,
        message,
        confirmLabel: opts.confirmLabel ?? 'Submit',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        placeholder: opts.placeholder ?? '',
        required: opts.required !== false,
        resolve: (ok: boolean) => resolve(ok ? (this.promptValue ?? '').trim() : null),
      });
    });
  }

  /**
   * The prompt's live text.
   *
   * A plain field rather than part of the state signal: the textarea writes on
   * every keystroke, and re-setting the signal that renders the dialog on every
   * keystroke rebuilds it and takes the caret with it.
   */
  promptValue = '';

  /** The file chosen in a prompt that offers one. Same reasoning as above. */
  promptFile: File | null = null;

  /**
   * Ask for a sentence and, optionally, something to back it up (§Att4).
   *
   * Separate from `prompt` rather than an extra argument to it, because the
   * answer is a different shape: callers of `prompt` get a string, and
   * widening that return type would make every one of them handle a file they
   * never asked for.
   */
  promptWithAttachment(
    message: string,
    title = 'Please explain',
    opts: {
      placeholder?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      required?: boolean;
      accept?: string;
      attachmentLabel?: string;
      attachmentHint?: string;
    } = {},
  ): Promise<{ text: string; file: File | null } | null> {
    return new Promise(resolve => {
      this.promptValue = '';
      this.promptFile = null;
      this.state.set({
        variant: 'prompt',
        title,
        message,
        confirmLabel: opts.confirmLabel ?? 'Submit',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        placeholder: opts.placeholder ?? '',
        required: opts.required !== false,
        attachment: {
          accept: opts.accept ?? 'image/*,application/pdf',
          label: opts.attachmentLabel ?? 'Attach proof (optional)',
          hint: opts.attachmentHint,
        },
        resolve: (ok: boolean) =>
          resolve(ok ? { text: (this.promptValue ?? '').trim(), file: this.promptFile } : null),
      });
    });
  }

  respond(result: boolean) {
    const current = this.state();
    if (!current) return;
    current.resolve(result);
    this.state.set(null);
  }
}
