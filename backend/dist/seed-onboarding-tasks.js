"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    host: '/tmp',
    port: 5432,
    user: 'mohitsingh',
    database: 'erp_db'
});
const adapter = new adapter_pg_1.PrismaPg(pool);
const prisma = new client_1.PrismaClient({ adapter });
async function main() {
    const company = await prisma.company.findFirst();
    if (!company) {
        console.error('No company found to seed tasks for.');
        return;
    }
    const tasks = [
        {
            title: 'Set up company email and Slack',
            description: 'Login to your new accounts and set up your profiles.',
        },
        {
            title: 'Complete IT Security Training',
            description: 'Watch the required security videos and pass the short quiz.',
        },
        {
            title: 'Sign Employee Handbook',
            description: 'Review the latest employee handbook and sign the acknowledgment form.',
        },
        {
            title: 'Schedule 1:1 with direct manager',
            description: 'Set up a 30-minute introductory meeting with your manager this week.',
        },
        {
            title: 'Enroll in Benefits',
            description: 'Complete your health, dental, and 401k enrollment via the HR portal.',
        }
    ];
    for (const task of tasks) {
        const existing = await prisma.onboardingTemplate.findFirst({
            where: { title: task.title, companyId: company.id }
        });
        if (!existing) {
            await prisma.onboardingTemplate.create({
                data: {
                    title: task.title,
                    description: task.description,
                    companyId: company.id
                }
            });
            console.log(`Added task: ${task.title}`);
        }
        else {
            console.log(`Task already exists: ${task.title}`);
        }
    }
    console.log('Finished seeding onboarding tasks.');
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed-onboarding-tasks.js.map