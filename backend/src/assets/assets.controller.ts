import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AssetsService } from './assets.service';

@Controller('assets')
@UseGuards(AuthGuard)
export class AssetsController {
  constructor(private assetsService: AssetsService) {}

  // ==========================================
  // 1. ASSET INVENTORY ENDPOINTS
  // ==========================================
  @Get()
  getAllAssets(@Request() req) {
    return this.assetsService.getAllAssets(req.user.companyId);
  }

  @Post()
  createAsset(@Request() req, @Body() data: any) {
    return this.assetsService.createAsset(req.user.companyId, data);
  }

  @Put(':id')
  updateAsset(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.assetsService.updateAsset(req.user.companyId, id, data);
  }

  @Delete(':id')
  deleteAsset(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.assetsService.deleteAsset(req.user.companyId, id);
  }

  // ==========================================
  // 2. ASSIGNMENT ENDPOINTS
  // ==========================================
  @Get('assignments')
  getAssignments(@Request() req) {
    return this.assetsService.getAssignments(req.user.companyId);
  }

  @Post('assign')
  assignAsset(
    @Request() req,
    @Body() data: { assetId: number; employeeId: number; assignedDate?: string; conditionOnAssign?: string; notes?: string }
  ) {
    return this.assetsService.assignAsset(req.user.companyId, data);
  }

  @Put('assignments/:id/return')
  returnAsset(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { returnDate?: string; conditionOnReturn?: string; assetNextStatus?: string; notes?: string }
  ) {
    return this.assetsService.returnAsset(req.user.companyId, id, data);
  }

  // ==========================================
  // 3. HARDWARE REQUEST ENDPOINTS
  // ==========================================
  @Get('requests')
  getHardwareRequests(@Request() req) {
    return this.assetsService.getHardwareRequests(req.user.companyId, req.user.sub, req.user.role);
  }

  @Post('requests')
  createHardwareRequest(
    @Request() req,
    @Body() data: { requestType: string; category: string; urgency: string; reason: string; images?: string[] }
  ) {
    return this.assetsService.createHardwareRequest(req.user.companyId, req.user.sub, data);
  }

  @Put('requests/:id')
  updateHardwareRequest(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { requestType?: string; category?: string; urgency?: string; reason?: string; images?: string[] }
  ) {
    return this.assetsService.updateHardwareRequest(req.user.companyId, id, req.user.sub, data);
  }

  @Delete('requests/:id')
  cancelHardwareRequest(
    @Request() req,
    @Param('id', ParseIntPipe) id: number
  ) {
    return this.assetsService.cancelHardwareRequest(req.user.companyId, id, req.user.sub);
  }

  @Put('requests/:id/status')
  updateHardwareRequestStatus(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { status: string; rejectionReason?: string; fulfilledAssetId?: number }
  ) {
    return this.assetsService.updateHardwareRequestStatus(req.user.companyId, id, req.user.sub, req.user.role, data);
  }
}
