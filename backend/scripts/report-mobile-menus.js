/**
 * READ-ONLY. Which sidebar menus each role gets, and whether the mobile app can
 * open them.
 *
 *   node scripts/report-mobile-menus.js
 *
 * Mirrors menus.service.ts getMenus() (active Menu rows, SUPERADMIN sees all,
 * other roles filtered by RolePermission VIEW plus the always-granted modules)
 * and mobile AppDrawer.tsx (a route opens a mobile screen only if it is in
 * ROUTE_TO_NAV; a parent with no mobile-openable child is hidden on mobile).
 * Writes nothing.
 */
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL })),
});

// The routes the mobile drawer can open, read from the app itself.
const drawer = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'src', 'components', 'AppDrawer.tsx'), 'utf8');
const navBlock = drawer.slice(drawer.indexOf('const ROUTE_TO_NAV'), drawer.indexOf('};', drawer.indexOf('const ROUTE_TO_NAV')));
const MOBILE = new Map([...navBlock.matchAll(/'([^']+)':\s*\{\s*screen:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));

const ROLES = ['SUPERADMIN', 'ADMIN', 'HR', 'FINANCE', 'SALES', 'EMPLOYEE'];
const id = (r, title) => (r ? r.replace('/', '') : title.toLowerCase().replace(/ /g, '-'));

(async () => {
  const company = await prisma.company.findFirst({ orderBy: { id: 'asc' }, select: { id: true, name: true } });
  const companyId = company.id;
  const menus = await prisma.menu.findMany({
    where: { isActive: true, OR: [{ companyId: null }, { companyId }] },
    orderBy: { displayOrder: 'asc' },
    select: { id: true, parentId: true, title: true, route: true },
  });
  const usersByRole = await prisma.user.groupBy({ by: ['role'], where: { companyId }, _count: true }).catch(() => []);
  const roleCounts = Object.fromEntries(usersByRole.map((r) => [r.role, r._count]));

  const sections = menus.filter((m) => m.parentId === null);
  const childrenOf = (pid) => menus.filter((m) => m.parentId === pid && m.route !== '/attendance/all');

  console.log(`READ-ONLY — ${company.name} (#${companyId})`);
  console.log(`Mobile can open ${MOBILE.size} routes.\n`);

  for (const role of ROLES) {
    let allowed = null;
    if (role !== 'SUPERADMIN') {
      const perms = await prisma.rolePermission.findMany({ where: { companyId, role, action: 'VIEW' }, select: { module: true } });
      allowed = new Set(perms.map((p) => p.module));
      ['overview', 'employees/me/profile', 'dashboard', 'crm/tickets', 'field-visits/my', 'settings/security'].forEach((m) => allowed.add(m));
      if (role === 'HR') allowed.add('notices');
      if (allowed.has('projects')) ['field-visits', 'field-visits/requests', 'tasks', 'timesheets'].forEach((m) => allowed.add(m));
      if (allowed.has('attendance')) allowed.add('attendance/leave-quota');
      if (perms.length === 0) {
        (['ADMIN', 'HR', 'FINANCE'].includes(role)
          ? ['assets', 'assets/inventory', 'assets/assignments', 'assets/requests', 'clients', 'careers']
          : ['assets', 'assets/requests', 'careers']).forEach((m) => allowed.add(m));
      }
    }
    const can = (m) => !allowed || allowed.has(m);

    console.log('='.repeat(70));
    console.log(`${role}  (${roleCounts[role] ?? 0} users)`);
    console.log('='.repeat(70));
    let onWeb = 0, onMobile = 0;
    for (const sec of sections) {
      const lines = [];
      for (const item of childrenOf(sec.id)) {
        const kids = childrenOf(item.id);
        if (kids.length) {
          const visible = kids.filter((k) => can(id(k.route, k.title)));
          if (!visible.length) continue;
          lines.push(`  ${item.title}`);
          for (const k of visible) {
            onWeb++;
            const m = MOBILE.get(k.route);
            if (m) onMobile++;
            lines.push(`     ${m ? '✓' : '✗'} ${k.title.padEnd(28)} ${String(k.route).padEnd(30)} ${m ? `→ ${m}` : 'web only'}`);
          }
        } else {
          if (!can(id(item.route, item.title)) && id(item.route, item.title) !== 'overview') continue;
          onWeb++;
          const m = MOBILE.get(item.route);
          if (m) onMobile++;
          lines.push(`  ${m ? '✓' : '✗'} ${item.title.padEnd(31)} ${String(item.route).padEnd(30)} ${m ? `→ ${m}` : 'web only'}`);
        }
      }
      if (lines.length) { console.log(`\n[${sec.title}]`); lines.forEach((l) => console.log(l)); }
    }
    console.log(`\n  ${onMobile} of ${onWeb} web menu items open on mobile\n`);
  }
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
