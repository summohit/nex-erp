/**
 * Seeds realistic field-visit history using real Indian road routes.
 *
 * Route points are generated the way a real GPS tracker would record them:
 * densified along the road path with ~15 m of noise while travelling, then
 * clustered around the destination for the on-site portion of the visit.
 *
 *   npx ts-node prisma/seed_field_visits.ts             # seed history
 *   npx ts-node prisma/seed_field_visits.ts --reset     # wipe seeded rows first
 *   npx ts-node prisma/seed_field_visits.ts --active    # also leave one IN_PROGRESS
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://mohitsingh@localhost:5432/erp_db?host=/tmp',
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Marker so re-runs can find and clean up only seeded rows. */
const SEED_TAG = '[seed:field-visit]';

type LatLng = { lat: number; lng: number; label?: string };

interface RouteDef {
  city: string;
  purpose: string;
  notes: string;
  startAddress: string;
  endAddress: string;
  /** Real waypoints along the actual road route. */
  waypoints: LatLng[];
  /** Minutes spent travelling vs. on site. */
  travelMins: number;
  siteMins: number;
  /** Days back from today the visit happened. */
  daysAgo: number;
  /** Local start hour, 24h. */
  startHour: number;
  startMinute: number;
  status: 'COMPLETED' | 'CANCELLED';
  photos?: { caption: string; offsetMins: number }[];
}

/* ────────────────────────────────────────────────────────────
   Real routes across Indian cities
   ──────────────────────────────────────────────────────────── */
const ROUTES: RouteDef[] = [
  {
    city: 'Delhi NCR',
    purpose: 'DR site readiness assessment — Gurugram facility',
    notes:
      'Assessed the Gurugram DR facility for Insight 2.0 cutover. Cooling capacity adequate for phase 1 racks. Flagged insufficient clearance in the rear hot aisle of Row C — layout revision required before install.',
    startAddress: 'Connaught Place, New Delhi, Delhi 110001',
    endAddress: 'DLF Cyber City, Gurugram, Haryana 122002',
    waypoints: [
      { lat: 28.6315, lng: 77.2167, label: 'Connaught Place' },
      { lat: 28.5921, lng: 77.161, label: 'Dhaula Kuan' },
      { lat: 28.568, lng: 77.15, label: 'Rao Tula Ram Marg' },
      { lat: 28.545, lng: 77.13, label: 'Mahipalpur / NH-48' },
      { lat: 28.518, lng: 77.108, label: 'Rajokri Border' },
      { lat: 28.495, lng: 77.088, label: 'DLF Cyber City' },
    ],
    travelMins: 58,
    siteMins: 140,
    daysAgo: 1,
    startHour: 9,
    startMinute: 30,
    status: 'COMPLETED',
    photos: [
      { caption: 'Row C hot aisle — clearance issue', offsetMins: 72 },
      { caption: 'CRAC unit nameplate and capacity', offsetMins: 96 },
      { caption: 'DR hall — phase 1 rack positions', offsetMins: 141 },
    ],
  },
  {
    city: 'Delhi NCR',
    purpose: 'Data centre rack layout survey — Greater Noida',
    notes:
      'Completed rack elevation survey for the primary DC hall. Captured floor loading measurements and confirmed cable tray routing against the IFC drawings. Two minor deviations logged.',
    startAddress: 'Sector 62, Noida, Uttar Pradesh 201309',
    endAddress: 'Knowledge Park III, Greater Noida, Uttar Pradesh 201310',
    waypoints: [
      { lat: 28.627, lng: 77.365, label: 'Sector 62, Noida' },
      { lat: 28.5952, lng: 77.3421, label: 'Sector 18 Atta Market' },
      { lat: 28.5432, lng: 77.3712, label: 'Noida–Greater Noida Expressway' },
      { lat: 28.4986, lng: 77.4321, label: 'Sector 148 Interchange' },
      { lat: 28.464, lng: 77.502, label: 'Pari Chowk, Greater Noida' },
    ],
    travelMins: 47,
    siteMins: 118,
    daysAgo: 3,
    startHour: 10,
    startMinute: 0,
    status: 'COMPLETED',
    photos: [
      { caption: 'Rack elevation — Hall 1 Row A', offsetMins: 58 },
      { caption: 'Cable tray routing vs IFC drawing', offsetMins: 89 },
      { caption: 'Raised floor loading measurement', offsetMins: 132 },
    ],
  },
  {
    city: 'Delhi NCR',
    purpose: 'Power redundancy audit — UPS and DG backup',
    notes:
      'Witnessed the UPS load-bank test and DG auto-changeover. Changeover completed in 9.2 s, within the 10 s SLA. Battery bank health report collected from the vendor.',
    startAddress: 'Dwarka Sector 21, New Delhi, Delhi 110075',
    endAddress: 'Aerocity, Indira Gandhi International Airport, New Delhi 110037',
    waypoints: [
      { lat: 28.552, lng: 77.058, label: 'Dwarka Sector 21' },
      { lat: 28.5501, lng: 77.0872, label: 'Dwarka Link Road' },
      { lat: 28.5462, lng: 77.1123, label: 'Shiv Murti / NH-48' },
      { lat: 28.549, lng: 77.12, label: 'Aerocity' },
    ],
    travelMins: 29,
    siteMins: 96,
    daysAgo: 11,
    startHour: 15,
    startMinute: 10,
    status: 'COMPLETED',
    photos: [
      { caption: 'UPS load bank test in progress', offsetMins: 41 },
      { caption: 'DG auto-changeover timing log', offsetMins: 73 },
    ],
  },
  {
    city: 'Bengaluru',
    purpose: 'Client site inspection — structural survey',
    notes:
      'Completed structural survey of Block A. Client raised concerns about the east-facing facade alignment. Follow-up measurements scheduled for next week.',
    startAddress: 'Koramangala 5th Block, Bengaluru, Karnataka 560095',
    endAddress: 'Electronic City Phase 1, Bengaluru, Karnataka 560100',
    waypoints: [
      { lat: 12.9352, lng: 77.6245, label: 'Koramangala 5th Block' },
      { lat: 12.9279, lng: 77.6271, label: 'Koramangala 80ft Road' },
      { lat: 12.9172, lng: 77.6228, label: 'Central Silk Board Junction' },
      { lat: 12.9004, lng: 77.6203, label: 'Bommanahalli' },
      { lat: 12.8845, lng: 77.6392, label: 'Hosa Road Junction' },
      { lat: 12.856, lng: 77.66, label: 'Neeladri Road' },
      { lat: 12.8452, lng: 77.6602, label: 'Electronic City Phase 1' },
    ],
    travelMins: 52,
    siteMins: 95,
    daysAgo: 2,
    startHour: 9,
    startMinute: 15,
    status: 'COMPLETED',
    photos: [
      { caption: 'Block A east facade — alignment check', offsetMins: 62 },
      { caption: 'Foundation reinforcement detail', offsetMins: 84 },
      { caption: 'Site progress — level 3 slab', offsetMins: 118 },
    ],
  },
  {
    city: 'Bengaluru',
    purpose: 'Vendor coordination meeting at ITPL',
    notes:
      'Met with the MEP vendor to finalise HVAC ducting layout. Revised drawings to be shared by Friday. Material delivery confirmed for the 28th.',
    startAddress: 'Indiranagar 100ft Road, Bengaluru, Karnataka 560038',
    endAddress: 'ITPL Main Road, Whitefield, Bengaluru, Karnataka 560066',
    waypoints: [
      { lat: 12.9784, lng: 77.6408, label: 'Indiranagar 100ft Road' },
      { lat: 12.9698, lng: 77.65, label: 'Domlur Flyover' },
      { lat: 12.9606, lng: 77.665, label: 'Old Airport Road' },
      { lat: 12.9591, lng: 77.6974, label: 'Marathahalli Bridge' },
      { lat: 12.965, lng: 77.72, label: 'Kundalahalli Gate' },
      { lat: 12.9698, lng: 77.75, label: 'ITPL Whitefield' },
    ],
    travelMins: 48,
    siteMins: 75,
    daysAgo: 5,
    startHour: 10,
    startMinute: 30,
    status: 'COMPLETED',
    photos: [
      { caption: 'HVAC ducting layout review', offsetMins: 55 },
      { caption: 'Vendor sample — insulated duct section', offsetMins: 78 },
    ],
  },
  {
    city: 'Bengaluru',
    purpose: 'Quarterly safety audit',
    notes:
      'Safety audit closed with two minor non-conformances: missing edge protection on level 5 and expired fire extinguisher tags. Both to be rectified within 48 hours.',
    startAddress: 'MG Road, Bengaluru, Karnataka 560001',
    endAddress: 'Hebbal Flyover, Bengaluru, Karnataka 560024',
    waypoints: [
      { lat: 12.9756, lng: 77.6068, label: 'MG Road' },
      { lat: 12.985, lng: 77.595, label: 'Cunningham Road' },
      { lat: 13.005, lng: 77.585, label: 'Mekhri Circle' },
      { lat: 13.0358, lng: 77.597, label: 'Hebbal Flyover' },
    ],
    travelMins: 34,
    siteMins: 110,
    daysAgo: 9,
    startHour: 8,
    startMinute: 45,
    status: 'COMPLETED',
    photos: [
      { caption: 'Level 5 edge protection gap', offsetMins: 45 },
      { caption: 'Fire extinguisher tag — expired', offsetMins: 61 },
      { caption: 'Scaffolding inspection', offsetMins: 92 },
      { caption: 'Safety signage compliance', offsetMins: 128 },
    ],
  },
  {
    city: 'Bengaluru',
    purpose: 'Material sampling — Sarjapur site',
    notes:
      'Collected concrete core samples from three locations for lab testing. Samples logged and dispatched to the materials lab.',
    startAddress: 'HSR Layout Sector 1, Bengaluru, Karnataka 560102',
    endAddress: 'Sarjapur Town, Bengaluru, Karnataka 562125',
    waypoints: [
      { lat: 12.9116, lng: 77.6389, label: 'HSR Layout Sector 1' },
      { lat: 12.901, lng: 77.665, label: 'Kaikondrahalli' },
      { lat: 12.879, lng: 77.69, label: 'Dommasandra' },
      { lat: 12.858, lng: 77.712, label: 'Sarjapur Town' },
    ],
    travelMins: 41,
    siteMins: 68,
    daysAgo: 13,
    startHour: 11,
    startMinute: 0,
    status: 'COMPLETED',
    photos: [{ caption: 'Concrete core sample — location C3', offsetMins: 58 }],
  },
  {
    city: 'Pune',
    purpose: 'Site handover walkthrough',
    notes:
      'Joint walkthrough with the client PM. Snag list of 14 items prepared; 9 closed on the spot. Handover certificate pending final electrical clearance.',
    startAddress: 'Hinjewadi Phase 2, Pune, Maharashtra 411057',
    endAddress: 'EON Free Zone, Kharadi, Pune, Maharashtra 411014',
    waypoints: [
      { lat: 18.5913, lng: 73.7389, label: 'Hinjewadi Phase 2' },
      { lat: 18.5679, lng: 73.7699, label: 'Wakad Bridge' },
      { lat: 18.5593, lng: 73.7997, label: 'Baner Road' },
      { lat: 18.5482, lng: 73.8567, label: 'Shivajinagar' },
      { lat: 18.5432, lng: 73.8918, label: 'Yerawada' },
      { lat: 18.5515, lng: 73.9385, label: 'EON Free Zone, Kharadi' },
    ],
    travelMins: 63,
    siteMins: 130,
    daysAgo: 17,
    startHour: 9,
    startMinute: 0,
    status: 'COMPLETED',
    photos: [
      { caption: 'Snag — lobby false ceiling finish', offsetMins: 74 },
      { caption: 'Electrical panel room', offsetMins: 108 },
      { caption: 'Handover walkthrough with client PM', offsetMins: 165 },
    ],
  },
  {
    city: 'Mumbai',
    purpose: 'Client presentation — design revision',
    notes:
      'Presented revised design options to the client. Option B approved with minor changes to the parking layout. Updated drawings due next Wednesday.',
    startAddress: 'Andheri East, Mumbai, Maharashtra 400069',
    endAddress: 'Bandra Kurla Complex, Mumbai, Maharashtra 400051',
    waypoints: [
      { lat: 19.1136, lng: 72.8697, label: 'Andheri East' },
      { lat: 19.0968, lng: 72.8517, label: 'Vile Parle' },
      { lat: 19.0759, lng: 72.8489, label: 'Santacruz East' },
      { lat: 19.0654, lng: 72.8645, label: 'Kalina' },
      { lat: 19.0607, lng: 72.8676, label: 'Bandra Kurla Complex' },
    ],
    travelMins: 44,
    siteMins: 85,
    daysAgo: 21,
    startHour: 14,
    startMinute: 20,
    status: 'COMPLETED',
    photos: [{ caption: 'Design option B — approved layout', offsetMins: 66 }],
  },
  {
    city: 'Bengaluru',
    purpose: 'Emergency site call — water ingress',
    notes:
      'Trip cancelled en route: site team resolved the issue before arrival. Recorded for travel-log completeness.',
    startAddress: 'Jayanagar 4th Block, Bengaluru, Karnataka 560011',
    endAddress: 'Banashankari 2nd Stage, Bengaluru, Karnataka 560070',
    waypoints: [
      { lat: 12.925, lng: 77.5838, label: 'Jayanagar 4th Block' },
      { lat: 12.9219, lng: 77.5731, label: 'South End Circle' },
      { lat: 12.92, lng: 77.56, label: 'Banashankari 2nd Stage' },
    ],
    travelMins: 16,
    siteMins: 0,
    daysAgo: 7,
    startHour: 16,
    startMinute: 40,
    status: 'CANCELLED',
  },
];

/* ────────────────────────────────────────────────────────────
   Geo helpers
   ──────────────────────────────────────────────────────────── */
const R = 6371; // km

function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** ~15 m of GPS noise, so the trace does not look machine-straight. */
function jitter(): number {
  return (Math.random() - 0.5) * 0.0003;
}

/**
 * Builds a [[lat, lng, unixMs], ...] trace.
 *
 * Travel leg: densified along the waypoints at a ~30 s sample rate.
 * On-site leg: points clustered within ~40 m of the destination, which is what
 * a real tracker records while someone walks around a site.
 */
function buildRoutePoints(
  waypoints: LatLng[],
  startMs: number,
  travelMins: number,
  siteMins: number,
): number[][] {
  const points: number[][] = [];
  const SAMPLE_MS = 30_000;
  const travelMs = travelMins * 60_000;
  const travelSamples = Math.max(2, Math.round(travelMs / SAMPLE_MS));

  // Cumulative distance so samples are spaced by distance, not by waypoint index
  const legs: number[] = [];
  let total = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = haversineKm(waypoints[i], waypoints[i + 1]);
    legs.push(d);
    total += d;
  }

  for (let s = 0; s <= travelSamples; s++) {
    const frac = s / travelSamples;
    let target = frac * total;
    let idx = 0;
    while (idx < legs.length - 1 && target > legs[idx]) {
      target -= legs[idx];
      idx++;
    }
    const legFrac = legs[idx] === 0 ? 0 : target / legs[idx];
    const a = waypoints[idx];
    const b = waypoints[idx + 1];
    const lat = a.lat + (b.lat - a.lat) * legFrac + jitter();
    const lng = a.lng + (b.lng - a.lng) * legFrac + jitter();
    points.push([
      Number(lat.toFixed(6)),
      Number(lng.toFixed(6)),
      startMs + Math.round(frac * travelMs),
    ]);
  }

  // On-site drift around the destination
  const dest = waypoints[waypoints.length - 1];
  const siteSamples = Math.round((siteMins * 60_000) / SAMPLE_MS);
  for (let s = 1; s <= siteSamples; s++) {
    points.push([
      Number((dest.lat + jitter() * 1.4).toFixed(6)),
      Number((dest.lng + jitter() * 1.4).toFixed(6)),
      startMs + travelMs + s * SAMPLE_MS,
    ]);
  }

  return points;
}

function routeDistanceKm(points: number[][]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    sum += haversineKm(
      { lat: points[i - 1][0], lng: points[i - 1][1] },
      { lat: points[i][0], lng: points[i][1] },
    );
  }
  return sum;
}

/* ────────────────────────────────────────────────────────────
   Seed
   ──────────────────────────────────────────────────────────── */
async function main() {
  const reset = process.argv.includes('--reset');
  const withActive = process.argv.includes('--active');

  const company = await prisma.company.findFirst();
  if (!company) throw new Error('No company found — seed a company first.');

  // Target a specific login with SEED_EMPLOYEE_EMAIL so the visits show up for
  // the account you actually sign in with; otherwise use the first employee.
  const email = process.env.SEED_EMPLOYEE_EMAIL;
  const employee = await prisma.employee.findFirst({
    where: {
      companyId: company.id,
      ...(email ? { user: { email } } : {}),
    },
    orderBy: { id: 'asc' },
  });
  if (!employee) {
    throw new Error(
      email
        ? `No employee found for ${email} in company #${company.id}.`
        : 'No employee found — seed an employee first.',
    );
  }

  const project = await prisma.project.findFirst({
    where: { companyId: company.id },
    orderBy: { id: 'asc' },
  });
  if (!project) throw new Error('No project found — seed a project first.');

  console.log(
    `Company #${company.id} · Employee #${employee.id} (${employee.firstName} ${employee.lastName}) · Project #${project.id} (${project.name})`,
  );

  if (reset) {
    const { count } = await prisma.fieldVisit.deleteMany({
      where: { employeeId: employee.id, notes: { contains: SEED_TAG } },
    });
    console.log(`Removed ${count} previously seeded visit(s).`);
  }

  for (const route of ROUTES) {
    const start = new Date();
    start.setDate(start.getDate() - route.daysAgo);
    start.setHours(route.startHour, route.startMinute, 0, 0);
    const startMs = start.getTime();

    const cancelled = route.status === 'CANCELLED';
    // A cancelled trip stops partway, so only part of the route was driven.
    const effectiveWaypoints = cancelled
      ? route.waypoints.slice(0, Math.max(2, route.waypoints.length - 1))
      : route.waypoints;

    const points = buildRoutePoints(
      effectiveWaypoints,
      startMs,
      route.travelMins,
      cancelled ? 0 : route.siteMins,
    );

    const distanceKm = Number(routeDistanceKm(points).toFixed(2));
    const durationMins = route.travelMins + route.siteMins;
    const endMs = startMs + durationMins * 60_000;
    const last = points[points.length - 1];

    const visit = await prisma.fieldVisit.create({
      data: {
        employeeId: employee.id,
        projectId: project.id,
        companyId: company.id,
        startTime: start,
        startLat: route.waypoints[0].lat,
        startLng: route.waypoints[0].lng,
        startAddress: route.startAddress,
        endTime: new Date(endMs),
        endLat: last[0],
        endLng: last[1],
        endAddress: cancelled
          ? `${route.startAddress} (trip cancelled en route)`
          : route.endAddress,
        distanceKm,
        durationMins,
        routePoints: points,
        status: route.status,
        purpose: route.purpose,
        notes: `${route.notes} ${SEED_TAG}`,
      },
    });

    if (route.photos?.length) {
      await prisma.fieldVisitPhoto.createMany({
        data: route.photos.map((p, i) => ({
          fieldVisitId: visit.id,
          url: `https://picsum.photos/seed/fv${visit.id}x${i}/900/675`,
          takenAt: new Date(startMs + p.offsetMins * 60_000),
          caption: p.caption,
        })),
      });
    }

    console.log(
      `  ✓ ${route.city.padEnd(10)} ${String(distanceKm).padStart(6)} km · ${String(durationMins).padStart(3)} min · ${points.length} pts · ${route.status}`,
    );
  }

  if (withActive) {
    const startMs = Date.now() - 26 * 60_000; // started 26 minutes ago
    const wp: LatLng[] = [
      { lat: 12.9716, lng: 77.5946, label: 'Bengaluru City Centre' },
      { lat: 12.9784, lng: 77.6408, label: 'Indiranagar' },
      { lat: 12.9591, lng: 77.6974, label: 'Marathahalli' },
    ];
    const points = buildRoutePoints(wp, startMs, 26, 0);
    const active = await prisma.fieldVisit.create({
      data: {
        employeeId: employee.id,
        projectId: project.id,
        companyId: company.id,
        startTime: new Date(startMs),
        startLat: wp[0].lat,
        startLng: wp[0].lng,
        startAddress: 'Bengaluru City Centre, Karnataka 560001',
        routePoints: points,
        status: 'IN_PROGRESS',
        purpose: 'Site progress review — Marathahalli',
        notes: SEED_TAG,
      },
    });
    console.log(`  ✓ Active visit #${active.id} in progress (started 26 min ago)`);
  }

  const total = await prisma.fieldVisit.count({ where: { employeeId: employee.id } });
  console.log(`\nDone. Employee #${employee.id} now has ${total} field visit(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
