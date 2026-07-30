import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('payroll')
@UseGuards(AuthGuard)
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  // ==================== 1. SALARY COMPONENTS ====================

  @Get('components')
  getSalaryComponents(@Request() req) {
    return this.payrollService.getSalaryComponents(req.user.companyId);
  }

  @Post('components')
  createSalaryComponent(@Request() req, @Body() data: { name: string; type: string; description?: string }) {
    return this.payrollService.createSalaryComponent(req.user.companyId, data);
  }

  @Put('components/:id')
  updateSalaryComponent(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: { name?: string; description?: string }) {
    return this.payrollService.updateSalaryComponent(req.user.companyId, id, data);
  }

  @Delete('components/:id')
  deleteSalaryComponent(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.payrollService.deleteSalaryComponent(req.user.companyId, id);
  }

  // ==================== 2. SALARY STRUCTURE ====================

  @Get('structure/:employeeId')
  getSalaryStructure(@Request() req, @Param('employeeId', ParseIntPipe) employeeId: number) {
    return this.payrollService.getSalaryStructure(req.user.companyId, employeeId);
  }

  @Post('structure/:employeeId')
  updateSalaryStructure(
    @Request() req,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() items: { componentId: number; amount: number }[]
  ) {
    return this.payrollService.updateSalaryStructure(req.user.companyId, employeeId, items);
  }

  // ==================== 3. PAYSLIPS ====================

  @Post('payslips/generate')
  generatePayslips(@Request() req, @Body() body: { month: number; year: number }) {
    return this.payrollService.generatePayslips(req.user.companyId, Number(body.month), Number(body.year));
  }

  @Post('payslips/send-emails')
  batchSendEmails(@Request() req, @Body() body: { month: number; year: number }) {
    return this.payrollService.batchSendPayslipEmails(req.user.companyId, Number(body.month), Number(body.year));
  }

  @Get('payslips/me')
  getMyPayslips(@Request() req) {
    return this.payrollService.getMyPayslips(req.user.companyId, req.user.sub);
  }

  @Get('payslips')
  getPayslips(@Request() req, @Query('month') month?: number, @Query('year') year?: number) {
    return this.payrollService.getPayslips(req.user.companyId, month, year);
  }

  @Put('payslips/finalize-all')
  batchFinalizePayslips(@Request() req, @Body() body: { month: number; year: number }) {
    return this.payrollService.batchFinalizePayslips(req.user.companyId, Number(body.month), Number(body.year));
  }

  @Put('payslips/mark-paid')
  markPayslipsPaid(@Request() req, @Body() body: { month: number; year: number }) {
    return this.payrollService.markPayslipsPaid(req.user.companyId, Number(body.month), Number(body.year));
  }

  @Put('payslips/:id')
  updatePayslip(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { lossOfPay?: number; totalEarnings?: number; totalDeductions?: number; expenseAmount?: number; status?: string }
  ) {
    return this.payrollService.updatePayslip(req.user.companyId, id, data);
  }

  // ==================== 4. EXPENSE CLAIMS ====================

  @Post('expenses')
  createExpenseClaim(
    @Request() req,
    @Body() data: { title: string; description?: string; amount: number; category?: string; receiptUrl?: string }
  ) {
    return this.payrollService.createExpenseClaim(req.user.companyId, req.user.sub, data);
  }

  @Get('expenses/me')
  getMyExpenseClaims(@Request() req) {
    return this.payrollService.getMyExpenseClaims(req.user.companyId, req.user.sub);
  }

  @Get('expenses')
  getAllExpenseClaims(@Request() req) {
    return this.payrollService.getAllExpenseClaims(req.user.companyId);
  }

  @Put('expenses/:id/status')
  updateExpenseClaimStatus(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { status: string; rejectionReason?: string }
  ) {
    return this.payrollService.updateExpenseClaimStatus(req.user.companyId, req.user.sub, id, data);
  }

  @Delete('expenses/:id')
  deleteExpenseClaim(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.payrollService.deleteExpenseClaim(req.user.companyId, req.user.sub, id);
  }
}
