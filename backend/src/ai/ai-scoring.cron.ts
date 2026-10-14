import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiService, AiRateLimitedError } from './ai.service';
import { PdfService, ResumeUnreadableError } from './pdf.service';

/** Tries before an application that keeps failing is set aside, so it cannot block the queue. */
const MAX_ATTEMPTS = 3;

@Injectable()
export class AiScoringCron implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout;
  private isProcessing = false;
  /** Failed tries per application since the process started. */
  private attempts = new Map<number, number>();

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
        // Newest first: after a bulk re-score, the candidates people are looking
        // at now come back first.
        orderBy: { id: 'desc' },
        take: 5
      });

      for (const app of applications) {
        if (!app.job?.descriptionHtml) {
          // If there is no job description, mark as scored with 0 to prevent infinite retries
          await this.prisma.jobApplication.update({
            where: { id: app.id },
            data: { isAiScored: true, aiScore: null, aiSummary: this.notScored('Job description missing. Cannot score.') }
          });
          continue;
        }

        try {
          console.log(`[AI Scoring Cron] Scoring application #${app.id} for job: ${app.job.title}`);
          
          // 1. Extract text from PDF
          const resumeText = await this.pdfService.extractTextFromUrl(app.resumeUrl!);

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
          
          this.attempts.delete(app.id);
          console.log(`[AI Scoring Cron] Successfully scored application #${app.id}: Score ${result.score}`);
        } catch (err) {
          if (err instanceof AiRateLimitedError) {
            // Groq's per-minute limit, not this candidate: don't count it as a
            // failed try, and stop the batch — the rest would only hit it too.
            console.warn(`[AI Scoring Cron] Groq rate limit at application #${app.id}; resuming next run.`);
            break;
          }
          if (err instanceof ResumeUnreadableError) {
            // Retrying cannot help. Record why, with no score — a number here
            // would be shown as "% Match" and read as a judgement on the person.
            await this.setAside(app.id, `Resume could not be read: ${err.message}.`);
            console.warn(`[AI Scoring Cron] Application #${app.id}: resume unreadable — ${err.message}`);
            continue;
          }
          const tries = (this.attempts.get(app.id) ?? 0) + 1;
          this.attempts.set(app.id, tries);
          console.error(`[AI Scoring Cron] Failed to score application #${app.id} (try ${tries}/${MAX_ATTEMPTS}):`, err.message);
          if (tries >= MAX_ATTEMPTS) {
            await this.setAside(app.id, `AI scoring failed ${tries} times (${err.message}). Re-score it later.`);
          }
          // Otherwise left unscored, so the next run tries again.
        }
      }
    } catch (err) {
      console.error('[AI Scoring Cron] General Error:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  /** Mark scored with no score, so it leaves the queue and shows the reason instead of a "% Match". */
  private async setAside(id: number, reason: string) {
    this.attempts.delete(id);
    await this.prisma.jobApplication.update({
      where: { id },
      data: { isAiScored: true, aiScore: null, aiSummary: this.notScored(reason) },
    });
  }

  /** Same JSON shape the candidate screen reads for a real score, with `score: null`. */
  private notScored(reason: string): string {
    return JSON.stringify({ score: null, recommendation: null, strengths: reason, matchingSkills: [], missingSkills: [] });
  }
}
