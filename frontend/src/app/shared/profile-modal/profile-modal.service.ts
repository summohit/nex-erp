import { Injectable, signal } from '@angular/core';

/**
 * Open anyone's full profile in a popup from any page (17 Oct 2026):
 * inject this and call open(employeeId). Mounted once in the main layout.
 */
@Injectable({ providedIn: 'root' })
export class ProfileModalService {
  readonly employeeId = signal<number | null>(null);
  open(id: number | string | null | undefined) {
    const n = Number(id);
    if (n) this.employeeId.set(n);
  }
  close() { this.employeeId.set(null); }
}
