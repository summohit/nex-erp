import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = global as unknown as { pgPool: Pool };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pgPool: Pool;
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    if (!globalForPrisma.pgPool) {
      globalForPrisma.pgPool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp',
        max: 4, // Supabase allows 15 in session mode — keep low for clustered instances
        min: 1, // Keep 1 idle connections warm to reduce cold-start latency
        idleTimeoutMillis: 30000, // Drop idle connections after 30s
        connectionTimeoutMillis: 15000, // 15s timeout for acquiring a connection
        allowExitOnIdle: false, // Keep pool alive
      });

      // Log pool errors instead of crashing
      globalForPrisma.pgPool.on('error', (err) => {
        console.error('[PG Pool] Unexpected idle client error:', err.message);
      });
    }

    const adapter = new PrismaPg(globalForPrisma.pgPool);
    super({ adapter });
    this.pgPool = globalForPrisma.pgPool;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(`PG Pool initialized (max: 10, min: 2)`);
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (process.env.NODE_ENV === 'production') {
      await this.pgPool.end();
    }
  }

  /**
   * Execute a Prisma operation with automatic retry on connection timeout.
   * Usage: await prismaService.withRetry(() => prisma.user.findMany());
   */
  async withRetry<T>(operation: () => Promise<T>, maxRetries = 2): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        const isTimeout = error.message?.includes('timeout exceeded');
        if (isTimeout && attempt < maxRetries) {
          this.logger.warn(`DB timeout, retrying (attempt ${attempt + 1}/${maxRetries})...`);
          await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // backoff: 500ms, 1000ms
          continue;
        }
        throw error;
      }
    }
    throw new Error('withRetry: unreachable');
  }
}

