import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { PdfService } from './pdf.service';
import { AiScoringCron } from './ai-scoring.cron';
import { AskMiraService } from './ask-mira.service';
import { AskMiraController } from './ask-mira.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AiController, AskMiraController],
  providers: [AiService, PdfService, AiScoringCron, AskMiraService],
  exports: [AiService, PdfService],
})
export class AiModule {}
