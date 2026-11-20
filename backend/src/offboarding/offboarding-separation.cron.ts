import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { istDateKey, istHour } from '../common/timezone.util';
import { OffboardingService } from './offboarding.service';

/**
 * Offboarding part 3 (20 Nov 2026): at the end of each IST day, separate
 * everyone whose approved last working day has ended — login off, status
 * SEPARATED, reportees moved. Same once-a-day pattern as the other crons.
 */
const SWEEP_HOUR = 23;

@Injectable()
export class OffboardingSeparationCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OffboardingSeparationCron.name);
  private timer: NodeJS.Timeout;
  private lastRunDateKey: string | null = null;

  constructor(private offboarding: OffboardingService) {}

  onModuleInit() { this.timer = setInterval(() => this.tick(), 60 * 1000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private tick() {
    const now = new Date();
    if (istHour(now) < SWEEP_HOUR) return;
    const key = istDateKey(now).toISOString();
    if (this.lastRunDateKey === key) return;
    this.lastRunDateKey = key;
    this.offboarding.separateDue(now)
      .then((n) => n && this.logger.log(`Separated ${n} employee(s) after their last working day`))
      .catch((e) => { this.lastRunDateKey = null; this.logger.error(`Separation sweep failed: ${e.message}`); });
  }
}
