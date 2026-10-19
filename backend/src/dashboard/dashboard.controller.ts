import { Controller, Get, Query, Request, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  getDashboard(@Request() req: any) {
    return this.dashboardService.getDashboard(req.user);
  }

  /** My Calendar for a month or week: ?from=YYYY-MM-DD&to=YYYY-MM-DD (up to 62 days). */
  @Get('calendar')
  getCalendar(@Request() req: any, @Query('from') from: string, @Query('to') to: string) {
    return this.dashboardService.getCalendar(req.user, from, to);
  }
}
