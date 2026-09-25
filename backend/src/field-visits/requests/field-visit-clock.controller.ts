import { Controller, Get, Post, Body, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { FieldVisitClockService } from './field-visit-clock.service';
import type { ClockData } from './field-visit-clock.service';

/**
 * The employee's side of a field visit (§5): what am I on today, and clocking
 * in and out of it from the site.
 *
 * Its own base path rather than hanging off `field-visits`, where a `:id`
 * route would swallow `today` before it ever reached here.
 */
@UseGuards(AuthGuard)
@Controller('field-visit-attendance')
export class FieldVisitClockController {
  constructor(private readonly clock: FieldVisitClockService) {}

  /** Today's approved visit, with the tasks this person may clock against. */
  @Get('today')
  today(@Req() req) {
    return this.clock.today(req.user.sub);
  }

  @Post('clock-in')
  clockIn(@Req() req, @Body() body: ClockData) {
    const ipAddress = req.headers['x-forwarded-for'] || req.connection?.remoteAddress || req.ip;
    return this.clock.clockIn(req.user.sub, { ...body, ipAddress });
  }

  @Post('clock-out')
  clockOut(@Req() req, @Body() body: ClockData) {
    return this.clock.clockOut(req.user.sub, body);
  }
}
