import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const globalForPrisma = global as unknown as { pgPool: Pool };

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pgPool: Pool;

  constructor() {
    if (!globalForPrisma.pgPool) {
      globalForPrisma.pgPool = new Pool({
        connectionString: process.env.DATABASE_URL || 'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp',
        max: 3, // Very strict limit to prevent Supabase 15-conn limit crashes
        idleTimeoutMillis: 10000, // Drop idle connections faster
        connectionTimeoutMillis: 2000,
      });
    }

    const adapter = new PrismaPg(globalForPrisma.pgPool);
    super({ adapter });
    this.pgPool = globalForPrisma.pgPool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    if (process.env.NODE_ENV === 'production') {
      await this.pgPool.end();
    }
  }
}
