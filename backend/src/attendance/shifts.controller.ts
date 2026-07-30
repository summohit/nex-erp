import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { ShiftsService } from './shifts.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('shifts')
@UseGuards(AuthGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Get()
  findAll(@Request() req) {
    return this.shiftsService.findAll(req.user.companyId);
  }

  @Post()
  create(@Request() req, @Body() data: any) {
    return this.shiftsService.create(req.user.companyId, data);
  }

  @Put(':id')
  update(@Request() req, @Param('id', ParseIntPipe) id: number, @Body() data: any) {
    return this.shiftsService.update(req.user.companyId, id, data);
  }

  @Delete(':id')
  delete(@Request() req, @Param('id', ParseIntPipe) id: number) {
    return this.shiftsService.delete(req.user.companyId, id);
  }
}
