import { Injectable, computed, inject } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * The roles a User row can carry. These are the values the database actually
 * holds — checked against it, not inferred from the code, because the code
 * disagreed with itself for a long time (see SUPER_ADMIN below).
 */
export type CompanyRole =
  | 'SUPERADMIN'
  | 'ADMIN'
  | 'HR'
  | 'FINANCE'
  | 'OPERATIONS_MANAGER'
  | 'SALES'
  | 'OFFICE_STAFF'
  | 'EMPLOYEE';

/**
 * The one place that decides what a role may do.
 *
 * Every screen used to answer this for itself — `currentUser()?.role ===
 * 'SUPERADMIN'` written out in Projects, Assets, Security and Field Visits,
 * each with its own spelling and its own idea of which roles counted. They
 * drifted, as duplicated rules do: some listed ADMIN, some did not, and the
 * permission directive tested a spelling that does not exist.
 *
 * `SUPER_ADMIN`, with the underscore, is that mistake. No User row has ever
 * held it — the value is `SUPERADMIN` — so anything testing for it was dead.
 * It is accepted here so a stale token or an older row cannot lock somebody
 * out, and nowhere else needs to know it existed.
 */
@Injectable({ providedIn: 'root' })
export class RoleService {
  private auth = inject(AuthService);

  /** The signed-in user's role, normalised. Null when signed out. */
  readonly role = computed<CompanyRole | null>(() => {
    const raw = this.auth.currentUser()?.role;
    if (!raw) return null;
    // The underscored spelling never existed in the database, but a token
    // issued against older code could still carry it.
    return (raw === 'SUPER_ADMIN' ? 'SUPERADMIN' : raw) as CompanyRole;
  });

  /** The company owner. Sees everything, decides everything. */
  readonly isSuperAdmin = computed(() => this.role() === 'SUPERADMIN');

  /** Super Admin or Admin — "may administer the company". */
  readonly isAdmin = computed(() => {
    const r = this.role();
    return r === 'SUPERADMIN' || r === 'ADMIN';
  });

  /** Administration plus the people function. */
  readonly isHrAdmin = computed(() => this.isAdmin() || this.role() === 'HR');

  /** Administration plus the money function. */
  readonly isFinanceAdmin = computed(() => this.isAdmin() || this.role() === 'FINANCE');

  /** True when the signed-in user holds any of the given roles. */
  hasRole(...roles: CompanyRole[]): boolean {
    const r = this.role();
    return !!r && roles.includes(r);
  }
}
