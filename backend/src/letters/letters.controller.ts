import {
  Controller, Get, Post, Put, Delete, Body, Param, Query,
  UseGuards, Request, ParseIntPipe,
} from '@nestjs/common';
import { LettersService } from './letters.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('letters')
@UseGuards(AuthGuard, PermissionsGuard)
export class LettersController {
  constructor(private readonly lettersService: LettersService) {}

  // ── templates ─────────────────────────────────────────────────────────
  // Fixed segments come before ':id' so they aren't parsed as an id.
  @Get('merge-tags')
  getMergeTags(@Query('scope') scope?: string) {
    return this.lettersService.getMergeTags(scope);
  }

  @Get('templates')
  @Permissions('settings/letter-templates')
  findTemplates(@Request() req) {
    return this.lettersService.findTemplates(req.user.companyId);
  }

  @Get('templates/:id')
  @Permissions('settings/letter-templates')
  findTemplate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.lettersService.findTemplate(req.user.companyId, id);
  }

  @Post('templates')
  @Permissions('settings/letter-templates')
  createTemplate(@Request() req, @Body() data: any) {
    return this.lettersService.createTemplate(req.user.companyId, data);
  }

  @Put('templates/:id')
  @Permissions('settings/letter-templates')
  updateTemplate(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.lettersService.updateTemplate(req.user.companyId, id, data);
  }

  @Delete('templates/:id')
  @Permissions('settings/letter-templates')
  deleteTemplate(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.lettersService.deleteTemplate(req.user.companyId, id);
  }

  // ── generating ────────────────────────────────────────────────────────
  @Post('preview')
  @Permissions('settings/letter-templates')
  preview(@Request() req, @Body() data: any) {
    return this.lettersService.preview(req.user.companyId, data);
  }

  @Get()
  @Permissions('settings/letter-templates')
  findLetters(@Request() req, @Query('employeeId') employeeId?: string) {
    return this.lettersService.findLetters(
      req.user.companyId, employeeId ? parseInt(employeeId, 10) : undefined);
  }

  @Get(':id')
  @Permissions('settings/letter-templates')
  findLetter(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.lettersService.findLetter(req.user.companyId, id);
  }

  @Post()
  @Permissions('settings/letter-templates')
  generate(@Request() req, @Body() data: any) {
    return this.lettersService.generate(req.user.companyId, req.user.sub, data);
  }

  @Delete(':id')
  @Permissions('settings/letter-templates')
  deleteLetter(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.lettersService.deleteLetter(req.user.companyId, id);
  }
}
