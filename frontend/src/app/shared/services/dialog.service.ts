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

  respond(result: boolean) {
    const current = this.state();
    if (!current) return;
    current.resolve(result);
    this.state.set(null);
  }
}
