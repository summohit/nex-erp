import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { MenusService } from './menus.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('v1/menus')
@UseGuards(AuthGuard)
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  @Get('sidebar')
  async getSidebar(@Request() req: any) {
    const user = req.user;
    // Access tokens carry the user id as `sub`; there is no `id` on them.
    return this.menusService.getSidebarMenus(user.companyId, user.sub ?? user.id, user.role);
  }
}
