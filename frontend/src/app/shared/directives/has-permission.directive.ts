import { Directive, Input, TemplateRef, ViewContainerRef, inject, OnInit } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { PermissionsService } from '../../services/permissions.service';

@Directive({
  selector: '[hasPermission]',
  standalone: true
})
export class HasPermissionDirective implements OnInit {
  private templateRef = inject(TemplateRef<any>);
  private viewContainer = inject(ViewContainerRef);
  private authService = inject(AuthService);
  private permissionsService = inject(PermissionsService);

  private moduleName: string = '';
  private actionName: string = 'VIEW';
  private hasView = false;

  @Input() set hasPermission(val: string | { module: string; action?: string }) {
    if (typeof val === 'string') {
      this.moduleName = val;
      this.actionName = 'VIEW';
    } else if (val && typeof val === 'object') {
      this.moduleName = val.module;
      this.actionName = val.action || 'VIEW';
    }
    this.updateView();
  }

  ngOnInit() {
    this.updateView();
  }

  private updateView() {
    const user = this.authService.currentUser();
    if (!user) {
      this.clearView();
      return;
    }

    if (user.role === 'SUPERADMIN' || user.role === 'ADMIN') {
      this.showView();
      return;
    }

    this.permissionsService.getAllPermissions(user.role).subscribe({
      next: (perms) => {
        const allowed = perms && perms.some(p => p.module === this.moduleName && (p.action === this.actionName || p.action === 'VIEW'));
        if (allowed) {
          this.showView();
        } else {
          this.clearView();
        }
      },
      error: () => this.clearView()
    });
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
