import { Controller, Get, Put, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { SystemSettingsService } from './system-settings.service';
import { OfferLettersService } from '../recruitment/offer-letters.service';
import { AuthGuard } from '../auth/auth.guard';
import { TwoFactorService } from '../auth/two-factor.service';
import type { Request } from 'express';

@Controller('system-settings')
@UseGuards(AuthGuard)
export class SystemSettingsController {
  constructor(
    private readonly systemSettingsService: SystemSettingsService,
    private readonly offerLettersService: OfferLettersService,
    private readonly twoFactorService: TwoFactorService,
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
  async updateSettings(@Req() req: Request, @Body() data: any) {
    const user = req.user as any;
    if (user.role !== 'SUPERADMIN') {
      throw new ForbiddenException('Only a SuperAdmin can change system settings.');
    }

    // Requiring two-factor company-wide while the person turning it on has no
    // authenticator is how a company locks itself out entirely: nobody can sign
    // in, and the only way back is hand-run SQL. Insist that whoever closes the
    // door is already holding a key.
    if (data?.twoFactorRequired === true && !(await this.twoFactorService.isEnabled(user.sub))) {
      throw new ForbiddenException(
        'Set up two-factor authentication on your own account before requiring it for everyone. ' +
        'Otherwise nobody, including you, would be able to sign in.',
      );
    }

    return this.systemSettingsService.updateSettings(user.companyId, data);
  }
}
