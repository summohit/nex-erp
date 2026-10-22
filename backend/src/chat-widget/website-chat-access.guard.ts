import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * Website Chat's own access check (runs after AuthGuard). Each API area maps
 * to a sidebar tab: /chat/kb → Knowledge Base, /chat/widgets → Widgets,
 * everything else → Inbox. No ADMIN bypass — see WEBSITE_CHAT_MODULE.
 */
@Injectable()
export class WebsiteChatAccessGuard implements CanActivate {
  constructor(private permissions: PermissionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user) throw new ForbiddenException('User session not authenticated');

    const path: string = req.route?.path || req.url || '';
    const tab = /\/chat\/kb(\/|$)/.test(path)
      ? 'website-chat/knowledge-base'
      : /\/chat\/widgets(\/|$)/.test(path)
        ? 'website-chat/widgets'
        : 'website-chat/inbox';

    const tabs = await this.permissions.websiteChatTabs(user.companyId, user.sub, user.role);
    if (!tabs.includes(tab)) throw new ForbiddenException('You do not have access to Website Chat.');
    return true;
  }
}
