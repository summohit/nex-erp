import { Controller, Req, Get, Post, Param, Body, Query, ParseIntPipe } from '@nestjs/common';
import type { Request } from 'express';
import { PublicJobsService, CandidateApplicationDto } from './public-jobs.service';
import { OfferLettersService } from '../recruitment/offer-letters.service';
import { Buffer } from 'buffer';

@Controller('public')
export class PublicJobsController {
  constructor(
    private readonly publicJobsService: PublicJobsService,
    private readonly offerLettersService: OfferLettersService,
  ) {}

  @Get('jobs')
  async getOpenJobs() {
    return await this.publicJobsService.getOpenJobs();
  }

  // New endpoint: get jobs for a specific company (companyId is base64‑encoded)
  @Get('jobs/:encryptedId')
  async getJobsByCompany(@Param('encryptedId') encryptedId: string) {
    const companyId = Buffer.from(encryptedId, 'base64').toString('utf-8');
    return await this.publicJobsService.getJobsByCompanyId(companyId);
  }

  @Get('jobs/:id')
  async getJobById(@Param('id', ParseIntPipe) id: number) {
    return await this.publicJobsService.getJobById(id);
  }

  @Get('applications/lookup')
  async lookupPreviousApplication(@Query('email') email: string, @Query('companyId') companyId: string) {
    const parsedCompanyId = parseInt(companyId, 10);
    if (!email || !parsedCompanyId) return { found: false };
    return await this.publicJobsService.lookupPreviousApplication(email, parsedCompanyId);
  }

  @Post('applications')
  async submitApplication(@Body() dto: CandidateApplicationDto) {
    return await this.publicJobsService.submitApplication(dto);
  }

  @Get('offer-letters/:token')
  async getOfferLetter(@Param('token') token: string) {
    return await this.offerLettersService.getByToken(token);
  }

  /** Unlock-screen metadata — safe to serve before the password is entered. */
  @Get('offer-letters/:token/access')
  async getOfferLetterAccess(@Param('token') token: string) {
    return await this.offerLettersService.getAccessInfo(token);
  }

  /** Verifies the document password and stamps the audit trail. */
  @Post('offer-letters/:token/unlock')
  async unlockOfferLetter(@Param('token') token: string, @Body('password') password: string) {
    return await this.offerLettersService.unlock(token, password);
  }

  /** Rendered document for the signing viewer (password-gated). */
  @Post('offer-letters/:token/document')
  async getOfferLetterDocument(@Param('token') token: string, @Body('password') password: string) {
    return await this.offerLettersService.getSigningDocument(token, password);
  }

  @Post('offer-letters/:token/respond')
  async respondToOfferLetter(
    @Param('token') token: string,
    @Body('decision') decision: 'ACCEPTED' | 'DECLINED',
    @Body('signatureName') signatureName: string,
    @Req() req: Request,
    @Body('signatureImage') signatureImage?: string,
    @Body('signatureType') signatureType?: string,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];
    return await this.offerLettersService.respond(
      token, decision, signatureName, ip, userAgent, signatureImage, signatureType,
    );
  }
}
