import { Controller, Get, Put, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { OfferLettersService } from '../recruitment/offer-letters.service';
import { AuthGuard } from '../auth/auth.guard';
import type { Request } from 'express';

@Controller('system-settings')
@UseGuards(AuthGuard)
export class SystemSettingsController {
  constructor(
    private readonly systemSettingsService: SystemSettingsService,
    private readonly offerLettersService: OfferLettersService,
  ) {}

  /** Built-in template source + the full merge-tag reference for the settings UI. */
  @Get('offer-letter/template')
  getOfferLetterTemplate() {
    return {
      defaultHtml: this.offerLettersService.getDefaultTemplateHtml(),
      placeholders: this.offerLettersService.getPlaceholderReference(),
    };
  }

  /** Live preview of the active template rendered against sample candidate data. */
  @Get('offer-letter/preview')
  async previewOfferLetter(@Req() req: Request) {
    const { html, header, footer } = await this.offerLettersService.previewTemplate(
      (req.user as any).companyId,
    );
    // Self-contained document so the UI can drop it straight into an iframe.
    return {
      html: `<!doctype html><html><head><meta charset="utf-8">
        <style>body{margin:0;background:#fff;padding:24px 28px;}</style>
        </head><body>${header}${html}${footer}</body></html>`,
    };
  }

  @Get()
  getSettings(@Req() req: Request) {
    const companyId = (req.user as any).companyId;
    return this.systemSettingsService.getSettings(companyId);
  }

  @Put()
  updateSettings(@Req() req: Request, @Body() data: any) {
    const user = req.user as any;
    if (user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only a SuperAdmin can change system settings.');
    }
    return this.systemSettingsService.updateSettings(user.companyId, data);
  }
}
