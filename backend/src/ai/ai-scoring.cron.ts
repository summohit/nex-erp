import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService } from './ai.service';
import { PdfService } from './pdf.service';

@Injectable()
export class AiScoringCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;
  private isProcessing = false;

  constructor(
    private prisma: PrismaService,
    private aiService: AiService,
    private pdfService: PdfService
  ) {}

  onModuleInit() {
    // Run the job every 2 minutes. 
    // Uses setInterval instead of @nestjs/schedule due to NPM installation restrictions.
    const intervalMs = 2 * 60 * 1000; 
    
    // Initial run after a short delay
    setTimeout(() => this.processUnscoredApplications(), 5000);
    
    this.timer = setInterval(() => {
      this.processUnscoredApplications();
    }, intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async processUnscoredApplications() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Find up to 5 applications that have not been scored yet and have a resume
      const applications = await this.prisma.jobApplication.findMany({
        where: {
          isAiScored: false,
          resumeUrl: { not: null }
        },
        include: {
          job: true
        },
        take: 5
      });

      for (const app of applications) {
        if (!app.job?.descriptionHtml) {
          // If there is no job description, mark as scored with 0 to prevent infinite retries
          await this.prisma.jobApplication.update({
            where: { id: app.id },
            data: { isAiScored: true, aiScore: 0, aiSummary: 'Job description missing. Cannot score.' }
          });
          continue;
        }

        try {
          console.log(`[AI Scoring Cron] Scoring application #${app.id} for job: ${app.job.title}`);
          
          // 1. Extract text from PDF
          const resumeText = await this.pdfService.extractTextFromUrl(app.resumeUrl!, {
            experienceYears: app.experienceYears,
            jobTitle: app.job.title,
            name: app.fullName
          });

          // 2. Score with AI
          const result = await this.aiService.scoreResume(resumeText, app.job.descriptionHtml);

          // 3. Save score to DB
          await this.prisma.jobApplication.update({
            where: { id: app.id },
            data: {
              isAiScored: true,
              aiScore: result.score,
              aiSummary: result.summary // Now a stringified JSON object
            }
          });
          
          console.log(`[AI Scoring Cron] Successfully scored application #${app.id}: Score ${result.score}`);
        } catch (err) {
          console.error(`[AI Scoring Cron] Failed to score application #${app.id}:`, err.message);
          // Don't set isAiScored to true, so it will retry next time.
        }
      }
    } catch (err) {
      console.error('[AI Scoring Cron] General Error:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }
}
