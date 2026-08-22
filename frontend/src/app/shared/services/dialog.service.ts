import { Injectable, signal } from '@angular/core';

export type DialogVariant = 'success' | 'error' | 'confirm';

export interface DialogState {
  variant: DialogVariant;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
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

  respond(result: boolean) {
    const current = this.state();
    if (!current) return;
    current.resolve(result);
    this.state.set(null);
  }
}
