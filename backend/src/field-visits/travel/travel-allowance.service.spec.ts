import { TravelAllowanceService, TRAVEL_ZONE, straightKm } from './travel-allowance.service';

const OFFICE = { latitude: 28.4964, longitude: 77.4022 }; // Noida HO
const CP = { lat: 28.623, lng: 77.212 }; // Connaught Place
const CONFIG = {
  ncrRadiusKm: 60, maxFarePerDay: 500, defaultRatePerKm: 5,
  rates: [
    { vehicle: 'Bike', kind: 'PER_KM' as const, ratePerKm: 0 },
    { vehicle: 'Car', kind: 'PER_KM' as const, ratePerKm: 0 },
    { vehicle: 'Metro', kind: 'ACTUAL_FARE' as const, ratePerKm: 0, receiptRequired: false },
  ],
};

function make(over: any = {}) {
  const created: any[] = [];
  const prisma: any = {
    systemSetting: { findUnique: jest.fn(async () => ({ travelAllowanceConfig: 'config' in over ? over.config : CONFIG })) },
    employee: { findUnique: jest.fn(async () => ({
      branch: OFFICE, payType: 'EMPLOYEE', employmentType: over.employmentType ?? 'Full Time', designation: { name: 'Engineer' },
      salaryStructures: [{ amount: over.gross ?? 40000, component: { type: 'EARNING' } }],
    })) },
    salaryGrade: { findMany: jest.fn(async () => over.grades ?? []) },
    salaryTemplate: { findUnique: jest.fn(async () => ({ ungradedKmRate: over.ungradedKmRate ?? null })) },
    branch: { findFirst: jest.fn(async () => OFFICE) },
    expenseClaim: {
      findMany: jest.fn(async () => over.existing ?? []),
      create: jest.fn(async (a: any) => { created.push(a.data); return a.data; }),
    },
    fieldVisitRequest: { findMany: jest.fn(async () => over.requests ?? []) },
  };
  delete process.env.ROUTING_URL;
  return { service: new TravelAllowanceService(prisma), created, prisma };
}

const visit = (attendances: any[]) => ({
  id: 9, requestNumber: 'FVR-0009', companyId: 1, projectId: 3, location: 'PNB CP',
  latitude: CP.lat, longitude: CP.lng, endDate: new Date('2026-10-14T00:00:00Z'), attendances,
});
const day = (over: any = {}) => ({
  employeeId: 60, visitDate: new Date('2026-10-14T00:00:00Z'), journeyVehicle: 'Car',
  journeyStartLat: null, journeyStartLng: null, journeyEndLat: null, journeyEndLng: null,
  journeyFare: null, journeyFareReceiptUrl: null, journeyTrackedKm: null, ...over,
});

describe('travel allowance', () => {
  it('suggests Delhi NCR inside the radius and Outstation beyond it', async () => {
    const { service } = make();
    expect((await service.suggestZone(1, CP.lat, CP.lng)).zone).toBe(TRAVEL_ZONE.NCR);
    expect((await service.suggestZone(1, 19.62, 74.66)).zone).toBe(TRAVEL_ZONE.OUTSTATION); // Mumbai
  });

  it('measures from the office when nobody tapped Start journey, and returns the same way', async () => {
    const { service, created } = make({ requests: [visit([day()])] });
    await service.sweep();
    const d = created[0].travelDetail.days[0];
    const oneWay = Math.round(straightKm(OFFICE.latitude, OFFICE.longitude, CP.lat, CP.lng) * 1.3 * 10) / 10;
    expect(d).toMatchObject({ from: 'Office (no Start journey)', returnTo: 'Same as going', goingKm: oneWay, returnKm: oneWay, ratePerKm: 5 });
    expect(created[0]).toMatchObject({ category: 'TRAVEL', status: 'PENDING', fieldVisitRequestId: 9, employeeId: 60 });
  });

  it('measures from where they tapped Start journey, and back to End journey when tapped', async () => {
    const home = { journeyStartLat: 28.57, journeyStartLng: 77.32 };
    const { service, created } = make({ requests: [visit([day({ ...home, journeyEndLat: 28.6, journeyEndLng: 77.3, journeyVehicle: 'Bike' })])] });
    await service.sweep();
    const d = created[0].travelDetail.days[0];
    expect(d.from).toBe('Start journey');
    expect(d.returnTo).toBe('End journey');
    expect(d.goingKm).not.toBe(d.returnKm);
    expect(d.ratePerKm).toBe(5);
    expect(created[0].amount).toBeCloseTo(d.km * 5, 1);
  });

  it('does not create a second claim for someone who already has one', async () => {
    const { service, created } = make({ requests: [visit([day()])], existing: [{ employeeId: 60 }] });
    expect((await service.sweep()).created).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('only lets the super admin change rates', async () => {
    const { service } = make();
    await expect(service.setConfig(1, 'ADMIN', CONFIG)).rejects.toThrow(/super admin/);
  });

  it('pays a metro day the fare entered, not by km', async () => {
    const { service, created } = make({ requests: [visit([day({ journeyVehicle: 'Metro', journeyFare: 64, journeyStartLat: 28.57, journeyStartLng: 77.32 })])] });
    await service.sweep();
    const d = created[0].travelDetail.days[0];
    expect(d).toMatchObject({ kind: 'ACTUAL_FARE', fare: 64, ratePerKm: null, amount: 64 });
    expect(created[0].amount).toBe(64);
  });

  it('pays public transport by salary grade per-km when no separate fare is entered', async () => {
    const { service, created } = make({
      requests: [visit([day({ journeyVehicle: 'Metro' })])],
      grades: [{ name: 'G3', minGross: 30001, maxGross: 60000, kmRate: 7 }],
      gross: 40000,
    });
    await service.sweep();
    const d = created[0].travelDetail.days[0];
    expect(d).toMatchObject({ kind: 'PER_KM', vehicle: 'Metro', grade: 'G3', ratePerKm: 7 });
    expect(created[0].amount).toBeCloseTo(d.km * 7, 1);
  });

  it('starts a company with no saved settings on the default vehicles (all per-km by grade)', async () => {
    const { service } = make({ config: null });
    const c = await service.getConfig(1);
    expect(c.isDefault).toBe(true);
    expect(c.maxFarePerDay).toBe(500);
    expect(c.rates.map((r) => r.vehicle)).toEqual(['Bike / Scooter', 'Car', 'Metro', 'Bus', 'Auto / Cab']);
    expect(c.rates.every((r) => r.kind === 'PER_KM')).toBe(true);
  });

  it('measures a recorded route and ignores GPS jumps', () => {
    const t0 = 1_700_000_000_000;
    // ~1.1 km north each minute (66 km/h), then a 50 km jump in 30 s.
    const pts = [[28.50, 77.40, t0], [28.51, 77.40, t0 + 60_000], [28.52, 77.40, t0 + 120_000], [28.97, 77.40, t0 + 150_000]];
    expect(TravelAllowanceService.trackedKm(pts)).toBeCloseTo(2.2, 1);
  });

  it('flags a day whose tracked route is far longer than the estimate', async () => {
    const { service, created } = make({ requests: [visit([day({ journeyTrackedKm: 120 })])] });
    await service.sweep();
    expect(created[0].travelDetail.days[0].note).toMatch(/Tracked route 120 km/);
  });

  const GRADES = [
    { name: 'G2', minGross: 15001, maxGross: 30000, kmRate: 4 },
    { name: 'G3', minGross: 30001, maxGross: 60000, kmRate: 7 },
  ];

  it('pays an own-vehicle trip at the grade rate, whatever the vehicle', async () => {
    const { service, created } = make({ requests: [visit([day({ journeyVehicle: 'Car' })])], grades: GRADES, gross: 40000 });
    await service.sweep();
    expect(created[0].travelDetail.days[0]).toMatchObject({ grade: 'G3', ratePerKm: 7 });
  });

  it('falls back to the default rate when the grade has none', async () => {
    const { service, created } = make({
      requests: [visit([day({ journeyVehicle: 'Car' })])], gross: 40000,
      grades: [{ name: 'G3', minGross: 30001, maxGross: 60000, kmRate: null }],
    });
    await service.sweep();
    expect(created[0].travelDetail.days[0]).toMatchObject({ grade: 'G3 · default rate', ratePerKm: 5 });
  });

  it('pays an intern the ungraded rate', async () => {
    const { service, created } = make({
      requests: [visit([day({ journeyVehicle: 'Bike' })])], grades: GRADES, gross: 20000,
      employmentType: 'Internship', ungradedKmRate: 2.5,
    });
    await service.sweep();
    expect(created[0].travelDetail.days[0]).toMatchObject({ grade: 'Intern', ratePerKm: 2.5 });
  });

  it('keeps metro at the fare when an explicit fare is recorded', async () => {
    const { service, created } = make({ requests: [visit([day({ journeyVehicle: 'Metro', journeyFare: 50 })])], grades: GRADES });
    await service.sweep();
    expect(created[0].travelDetail.days[0]).toMatchObject({ amount: 50, grade: null });
  });

  it('returns the employee grade and per-km rate in getSettingsForUser', async () => {
    const { service, prisma } = make({ grades: GRADES, gross: 40000 });
    prisma.employee.findFirst = jest.fn(async () => ({ id: 60 }));
    const s = await service.getSettingsForUser(1, 100);
    expect(s.myGrade).toBe('G3');
    expect(s.myRatePerKm).toBe(7);
  });
});
