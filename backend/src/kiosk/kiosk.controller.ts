import { Controller, Post, Body, HttpCode, HttpStatus, UnauthorizedException, Get, Query } from '@nestjs/common';
import { KioskService } from './kiosk.service';

@Controller('kiosk')
export class KioskController {
  constructor(private readonly kioskService: KioskService) {}

  @HttpCode(HttpStatus.OK)
  @Post('clock-in')
  async clockIn(@Body() data: { pin: string, companyId: number }) {
    if (!data.pin || !data.companyId) {
      throw new UnauthorizedException('PIN and company ID are required');
    }
    return this.kioskService.clockIn(data.pin, data.companyId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('clock-out')
  async clockOut(@Body() data: { pin: string, companyId: number }) {
    if (!data.pin || !data.companyId) {
      throw new UnauthorizedException('PIN and company ID are required');
    }
    return this.kioskService.clockOut(data.pin, data.companyId);
  }
}
