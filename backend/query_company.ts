import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    const company = await prisma.company.findFirst({ where: { name: { contains: 'CES Tech', mode: 'insensitive' } } });
    console.log("Found company:", company?.id, company?.name);
    process.exit(0);
}
main().catch(console.error);
