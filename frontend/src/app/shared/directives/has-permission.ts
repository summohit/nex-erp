import { Directive, Input, TemplateRef, ViewContainerRef, inject, effect } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { RoleService } from '../../services/role.service';

@Directive({
  selector: '[appHasPermission]',
  standalone: true
})
export class HasPermission {
  private authService = inject(AuthService);
  private roles = inject(RoleService);
  private templateRef = inject(TemplateRef);
  private viewContainer = inject(ViewContainerRef);
  
  private permissionRequired: string | null = null;
  private hasView = false;

  constructor() {
    effect(() => {
      const user = this.authService.currentUser();
      this.checkPermission(user);
    });
  }

  @Input() set appHasPermission(permission: string) {
    this.permissionRequired = permission;
    this.checkPermission(this.authService.currentUser());
  }

  private checkPermission(user: any) {
    if (!user || !this.permissionRequired) {
      this.clearView();
      return;
    }

    // The company owner is not subject to granular permissions.
    //
    // This tested 'SUPER_ADMIN', a spelling no User row has ever held, so the
    // bypass never fired. Nothing broke only because the directive is not yet
    // used in any template — the first `*appHasPermission` added would have
    // hidden itself from every Super Admin, none of whom hold explicit
    // permission rows.
    if (this.roles.isSuperAdmin()) {
      this.showView();
      return;
    }

    // Check if the user has the required permission
    // Format: "resource:action" e.g., "EMPLOYEE:CREATE"
    const [resourceType, action] = this.permissionRequired.split(':');
    
    let hasPerm = false;

    if (user.userRoles) {
      for (const ur of user.userRoles) {
        if (ur.role && ur.role.permissions) {
          for (const rp of ur.role.permissions) {
            if (
              rp.permission.resourceType === resourceType &&
              rp.permission.action === action &&
              rp.effect === 'ALLOW'
            ) {
              hasPerm = true;
              break;
            }
          }
        }
        if (hasPerm) break;
      }
    }

    if (hasPerm) {
      this.showView();
    } else {
      this.clearView();
    }
  }

  private showView() {
    if (!this.hasView) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this.hasView = true;
    }
  }

  private clearView() {
    if (this.hasView) {
      this.viewContainer.clear();
      this.hasView = false;
    }
  }
}
