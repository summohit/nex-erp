import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Request, UseGuards, ParseIntPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SalesService } from './sales.service';
import { QuotationPdfService } from './quotation-pdf.service';
import { AuthGuard } from '../auth/auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@Controller('sales')
@UseGuards(AuthGuard, PermissionsGuard)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly quotationPdfService: QuotationPdfService,
  ) {}

  /**
   * The printable quotation. Streamed rather than uploaded anywhere — it is
   * derived entirely from the quotation and the company profile, so there is
   * nothing to store and it always reflects the current details.
   */
  @Get('quotations/:id/pdf')
  async quotationPdf(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const { buffer, isPdf, fileName } = await this.quotationPdfService.generate(req.user.companyId, id);
    res.setHeader('Content-Type', isPdf ? 'application/pdf' : 'text/html');
    // inline, so it opens in a tab rather than dropping into Downloads — the
    // common case is checking it before sending, not filing it.
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.send(buffer);
  }

  /**
   * Email the quotation to the buyer. Outward-facing and not undoable, so the
   * client confirms before calling this — the server does not send on its own.
   */
  @Post('quotations/:id/email')
  @Permissions('sales/quotations')
  emailQuotation(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { to?: string; message?: string },
  ) {
    return this.quotationPdfService.emailToBuyer(req.user.companyId, id, body?.to, body?.message);
  }

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
  @Patch('quotations/:id')
  @Permissions('sales/quotations')
  updateQuotation(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.salesService.updateQuotation(req.user.companyId, id, body);
  }

  @Patch('quotations/:id/status')
  @Permissions('sales/quotations')
  updateQuotationStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    return this.salesService.updateQuotationStatus(req.user.companyId, id, status);
  }

  @Delete('quotations/:id')
  @Permissions('sales/quotations')
  deleteQuotation(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.salesService.deleteQuotation(req.user.companyId, id);
  }

  @Patch('orders/:id/status')
  @Permissions('sales/orders')
  updateOrderStatus(@Request() req, @Param('id', ParseIntPipe) id: number, @Body('status') status: string) {
    return this.salesService.updateOrderStatus(req.user.companyId, id, status);
  }

  @Patch('orders/:id/return')
  @Permissions('sales/orders')
  returnRental(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.salesService.returnRental(req.user.companyId, id);
  }

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
