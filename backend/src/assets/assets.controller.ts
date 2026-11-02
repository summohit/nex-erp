import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AssetsService } from './assets.service';

@Controller('assets')
// Inventory and assignments follow the same module permissions as the menu
// (Super Admin and Admin always pass). Until now any signed-in employee could
// add, edit, delete or hand out company assets. Hardware requests and the
// category list stay open: every employee raises requests.
@UseGuards(AuthGuard, PermissionsGuard)
export class AssetsController {
  constructor(private assetsService: AssetsService) {}

  // ==========================================
  // 1. ASSET INVENTORY ENDPOINTS
  // ==========================================
  @Get()
  @Permissions('assets/inventory')
  getAllAssets(@Request() req) {
    return this.assetsService.getAllAssets(req.user.companyId);
  }

  @Get('categories')
  getCategories(@Request() req) {
    return this.assetsService.getCategories(req.user.companyId);
  }

  @Post()
  @Permissions('assets/inventory')
  createAsset(@Request() req, @Body() data: any) {
    return this.assetsService.createAsset(req.user.companyId, data);
  }

  @Put(':id')
  @Permissions('assets/inventory')
  updateAsset(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.assetsService.updateAsset(req.user.companyId, id, data);
  }

  @Delete(':id')
  @Permissions('assets/inventory')
  deleteAsset(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.assetsService.deleteAsset(req.user.companyId, id);
  }

  // ==========================================
  // 2. ASSIGNMENT ENDPOINTS
  // ==========================================
  @Get('assignments')
  @Permissions('assets/inventory', 'assets/assignments')
  getAssignments(@Request() req) {
    return this.assetsService.getAssignments(req.user.companyId);
  }

  @Post('assign')
  @Permissions('assets/inventory', 'assets/assignments')
  assignAsset(
    @Request() req,
    @Body() data: { assetId: number; employeeId: number; assignedDate?: string; conditionOnAssign?: string; notes?: string }
  ) {
    return this.assetsService.assignAsset(req.user.companyId, data);
  }

  @Put('assignments/:id/return')
  @Permissions('assets/inventory', 'assets/assignments')
  returnAsset(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { returnDate?: string; conditionOnReturn?: string; assetNextStatus?: string; notes?: string }
  ) {
    return this.assetsService.returnAsset(req.user.companyId, id, data);
  }

  // ==========================================
  // 3. PRODUCT/BATCH INVENTORY ENDPOINTS
  // ==========================================
  @Get('inventory')
  @Permissions('assets/inventory')
  getInventoryItems(@Request() req) {
    return this.assetsService.getInventoryItems(req.user.companyId);
  }

  @Post('inventory')
  @Permissions('assets/inventory')
  createInventoryItem(@Request() req, @Body() data: any) {
    return this.assetsService.createInventoryItem(req.user.companyId, req.user.sub, data);
  }

  @Post('inventory/import')
  @Permissions('assets/inventory')
  importInventoryItems(@Request() req, @Body() body: { rows: any[] }) {
    return this.assetsService.importInventoryItems(req.user.companyId, req.user.sub, body?.rows || []);
  }

  @Put('inventory/:id')
  @Permissions('assets/inventory')
  updateInventoryItem(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.assetsService.updateInventoryItem(req.user.companyId, id, data);
  }

  @Delete('inventory/:id')
  @Permissions('assets/inventory')
  deleteInventoryItem(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.assetsService.deleteInventoryItem(req.user.companyId, id);
  }

  @Get('inventory/assignments')
  @Permissions('assets/inventory', 'assets/assignments')
  getInventoryAssignments(@Request() req) {
    return this.assetsService.getInventoryAssignments(req.user.companyId);
  }

  @Get('inventory/:id/transactions')
  @Permissions('assets/inventory', 'assets/assignments')
  getInventoryTransactions(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.assetsService.getInventoryTransactions(req.user.companyId, id);
  }

  @Post('inventory/:id/assign')
  @Permissions('assets/inventory', 'assets/assignments')
  assignInventoryItem(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.assetsService.assignInventoryItem(req.user.companyId, req.user.sub, id, data);
  }

  @Put('inventory/transactions/:txnId/return')
  @Permissions('assets/inventory', 'assets/assignments')
  returnInventoryUnits(@Request() req, @Param('txnId', ParseIntPipe) txnId: number, @Body() data: any) {
    return this.assetsService.returnInventoryUnits(req.user.companyId, req.user.sub, txnId, data);
  }

  @Post('inventory/:id/consume')
  @Permissions('assets/inventory')
  consumeInventoryItem(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.assetsService.consumeInventoryItem(req.user.companyId, req.user.sub, id, data);
  }

  @Post('inventory/:id/expire')
  @Permissions('assets/inventory')
  expireInventoryItem(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.assetsService.expireInventoryItem(req.user.companyId, req.user.sub, id, data);
  }

  @Post('inventory/:id/adjust')
  @Permissions('assets/inventory')
  adjustInventoryStock(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.assetsService.adjustInventoryStock(req.user.companyId, req.user.sub, id, data);
  }

  @Put('inventory/:id/status')
  @Permissions('assets/inventory')
  setInventoryItemStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { status: string }) {
    return this.assetsService.setInventoryItemStatus(req.user.companyId, id, data.status);
  }

  // ==========================================
  // 4. HARDWARE REQUEST ENDPOINTS
  // ==========================================
  @Get('requests')  getHardwareRequests(@Request() req) {
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
