import { Body, Controller, Get, Put, Request, UseGuards } from '@nestjs/common';
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

  /** The signed-in person's own sidebar order (16 Nov 2026). */
  @Get('order')
  getOrder(@Request() req: any) {
    return this.menusService.getMenuOrder(req.user.sub ?? req.user.id);
  }

  /** Save it; `null` resets to the default order. */
  @Put('order')
  saveOrder(@Request() req: any, @Body() body: { order: unknown }) {
    return this.menusService.saveMenuOrder(req.user.sub ?? req.user.id, body?.order ?? null);
  }
}
