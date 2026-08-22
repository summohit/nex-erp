import { Controller, Get, Post, Put, Body, Param, Request, UseGuards, ParseIntPipe, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  // --- Quotations ---
  @Post('quotations')
  @Permissions('sales/quotations')
  createQuotation(@Request() req, @Body() data: any) {
    return this.salesService.createQuotation(req.user.companyId, data, req.user.sub);
  }

  @Get('quotations')
  @Permissions('sales/quotations')
  getQuotations(@Request() req) {
    return this.salesService.getQuotations(req.user.companyId);
  }

  @Put('quotations/:id/approve')
  @Permissions('sales/quotations')
  approveQuotation(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.salesService.approveQuotation(req.user.companyId, id, req.user.sub);
  }

  @Post('quotations/:id/convert')
  @Permissions('sales/quotations')
  convertQuoteToOrder(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.salesService.convertQuoteToOrder(req.user.companyId, id);
  }

  // --- Sales Orders & Rentals ---
  @Get('orders')
  @Permissions('sales/orders')
  getSalesOrders(@Request() req, @Query('isRental') isRental: string) {
    const isRentalBool = isRental === 'true' ? true : (isRental === 'false' ? false : undefined);
    return this.salesService.getSalesOrders(req.user.companyId, isRentalBool);
  }

  // --- POS ---
  @Post('pos/checkout')
  @Permissions('sales/pos')
  posCheckout(@Request() req, @Body() data: any) {
    return this.salesService.createPosCheckout(req.user.companyId, data);
  }
}
