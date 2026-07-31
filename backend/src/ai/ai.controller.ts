import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('ai')
@UseGuards(AuthGuard)
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('generate-job-description')
  async generateJobDescription(
    @Body() body: { title: string; department?: string; location?: string; instructions?: string },
  ) {
    const result = await this.aiService.generateJobDescription(body);
    return { result };
  }
}
