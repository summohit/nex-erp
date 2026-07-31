import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PdfService } from './pdf.service';
import { AiScoringCron } from './ai-scoring.cron';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AiController],
  providers: [AiService, PdfService, AiScoringCron],
  exports: [AiService, PdfService],
})
export class AiModule {}
