import { Body, Controller, Get, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../auth/auth.guard';
import { TravelAllowanceService, TravelConfig } from './travel-allowance.service';

/** Field visit travel allowance: rates, the NCR suggestion and journey taps. */
@UseGuards(AuthGuard)
@Controller('travel-allowance')
export class TravelAllowanceController {
  constructor(private readonly travel: TravelAllowanceService) {}

  /** Rates and the NCR radius. Anyone signed in may read them (the app lists vehicles). */
  @Get('settings')
  settings(@Req() req) {
    return this.travel.getConfig(req.user.companyId);
  }

  /** Super admin only. */
  @Put('settings')
  saveSettings(@Req() req, @Body() body: Partial<TravelConfig>) {
    return this.travel.setConfig(req.user.companyId, req.user.role, body);
  }

  /** Delhi NCR or Outstation for a site, for the field visit form to pre-select. */
  @Get('zone')
  zone(@Req() req, @Query('lat') lat: string, @Query('lng') lng: string) {
    return this.travel.suggestZone(req.user.companyId, Number(lat), Number(lng));
  }

  /** { requestId?, lat, lng, vehicle } — one location read where they set off. */
  @Post('journey/start')
  start(@Req() req, @Body() body: any) {
    return this.travel.startJourney(req.user.sub, body);
  }

  /** { requestId?, lat, lng } — optional, where they finished. */
  @Post('journey/end')
  end(@Req() req, @Body() body: any) {
    return this.travel.endJourney(req.user.sub, body);
  }
}
