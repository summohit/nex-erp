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
    return this.menusService.getSidebarMenus(user.companyId, user.id, user.role);
  }
}
