/**
 * Projects whose logged hours are not turning into budget used (19 Oct 2026).
 * Read-only.
 *
 *   node scripts/projects-unpriced-hours.js
 *
 * Budget used = hours x the logger's hourlyCostRate + approved expenses. Hours
 * logged by someone with no rate are priced at 0. For every project with
 * logged hours this prints: hours, priced cost, unpriced hours, and who logged
 * the unpriced hours.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const h = (min) => Math.round((Number(min || 0) / 60) * 10) / 10;
const rs = (n) => '₹' + Math.round(Number(n || 0)).toLocaleString('en-IN');

(async () => {
  // Same rule as the app (19 Oct 2026): own hourly rate, else monthly salary / 234 h.
  const rows = await prisma.$queryRaw`
    WITH salary AS (
      SELECT ss."employeeId", SUM(ss.amount) AS monthly FROM "SalaryStructure" ss
        JOIN "SalaryComponent" sc ON sc.id = ss."componentId" WHERE sc.type = 'EARNING' GROUP BY ss."employeeId"
    )
    SELECT p.id, p.name, p.key, p."budgetAmount" AS budget,
           e.id AS "employeeId", e."firstName", e."lastName", e."employeeCode",
           COALESCE(e."hourlyCostRate", CASE WHEN s.monthly > 0 THEN s.monthly / 234.0 END) AS rate,
           SUM(COALESCE(t."durationMin", 0)) AS minutes
      FROM "IssueTimeLog" t
      JOIN "Issue" i    ON i.id = t."issueId"
      JOIN "Project" p  ON p.id = i."projectId"
      JOIN "Employee" e ON e.id = t."employeeId"
      LEFT JOIN salary s ON s."employeeId" = e.id
     GROUP BY p.id, p.name, p.key, p."budgetAmount", e.id, e."firstName", e."lastName", e."employeeCode", e."hourlyCostRate", s.monthly`;

  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.id)) byProject.set(r.id, { name: r.name, key: r.key, budget: r.budget, min: 0, cost: 0, unratedMin: 0, unrated: [] });
    const p = byProject.get(r.id);
    const min = Number(r.minutes || 0);
    p.min += min;
    if (r.rate == null) {
      p.unratedMin += min;
      p.unrated.push(`${r.firstName} ${r.lastName ?? ''}`.trim() + (r.employeeCode ? ` #${r.employeeCode}` : '') + ` (${h(min)} h)`);
    } else {
      p.cost += (min / 60) * Number(r.rate);
    }
  }

  const list = [...byProject.values()].filter((p) => p.min > 0).sort((a, b) => b.unratedMin - a.unratedMin);
  const zero = list.filter((p) => p.cost === 0);
  console.log(`\nProjects with logged hours: ${list.length}. Showing ₹0 cost from hours: ${zero.length}.\n`);
  for (const p of list) {
    const flag = p.cost === 0 ? '  ← ₹0' : '';
    console.log(`${p.name}${p.key ? ` (${p.key})` : ''}${flag}`);
    console.log(`   ${h(p.min)} h logged · ${rs(p.cost)} priced · ${h(p.unratedMin)} h with no cost rate${p.budget != null ? ` · budget ${rs(p.budget)}` : ''}`);
    if (p.unrated.length) console.log(`   No rate: ${p.unrated.join(', ')}`);
  }

  const people = await prisma.employee.count({ where: { hourlyCostRate: null, user: { status: { not: 'SUSPENDED' } } } });
  const all = await prisma.employee.count({ where: { user: { status: { not: 'SUSPENDED' } } } });
  console.log(`\nActive employees with no hourly cost rate set by hand: ${people} of ${all} (their salary is used instead when they have one).\n`);
  await prisma.$disconnect();
})().catch(async (e) => { console.error(e.message); await prisma.$disconnect(); process.exit(1); });
