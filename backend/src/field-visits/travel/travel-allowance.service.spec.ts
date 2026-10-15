import { TravelAllowanceService, TRAVEL_ZONE, straightKm } from './travel-allowance.service';

const OFFICE = { latitude: 28.4964, longitude: 77.4022 }; // Noida HO
const CP = { lat: 28.623, lng: 77.212 }; // Connaught Place
const CONFIG = { ncrRadiusKm: 60, rates: [{ vehicle: 'Bike', ratePerKm: 4 }, { vehicle: 'Car', ratePerKm: 9 }] };

function make(over: any = {}) {
  const created: any[] = [];
  const prisma: any = {
    systemSetting: { findUnique: jest.fn(async () => ({ travelAllowanceConfig: CONFIG })) },
    employee: { findUnique: jest.fn(async () => ({ branch: OFFICE })) },
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
  journeyStartLat: null, journeyStartLng: null, journeyEndLat: null, journeyEndLng: null, ...over,
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
    expect(d).toMatchObject({ from: 'Office (no Start journey)', returnTo: 'Same as going', goingKm: oneWay, returnKm: oneWay, ratePerKm: 9 });
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
    expect(d.ratePerKm).toBe(4);
    expect(created[0].amount).toBeCloseTo(d.km * 4, 1);
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
});
