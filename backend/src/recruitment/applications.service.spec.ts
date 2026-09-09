import { BadRequestException } from '@nestjs/common';
import { ApplicationsService } from './applications.service';

/**
 * The offer rules are pure functions of the application row, so they are tested
 * against a bare instance rather than a wired-up Nest module — no Prisma, no
 * notifications, no database.
 */
describe('ApplicationsService — job offer rules', () => {
  const service = new ApplicationsService(
    null as any, null as any, null as any, null as any,
  );

  const assertStage = (app: any, target: string) =>
    (service as any).assertStageAllowed(app, target);
  const budgetOf = (app: any) => (service as any).effectiveProfileBudget(app);
  const record = (app: any, stage: string) => (service as any).recordStage(app, stage);

  const candidate = (over: Partial<any> = {}) => ({
    status: 'APPLIED',
    completedStages: ['APPLIED'],
    approvalStatus: 'APPROVED',
    profileBudget: null,
    job: { maxSalary: 1000000 },
    ...over,
  });

  describe('mandatory stages', () => {
    it('blocks OFFERED until phone screening and interview have happened', () => {
      expect(() => assertStage(candidate(), 'OFFERED')).toThrow(BadRequestException);
      expect(() => assertStage(candidate(), 'OFFERED')).toThrow(/Phone Screening, Interview/);
    });

    it('allows OFFERED once every mandatory stage has been visited', () => {
      const app = candidate({
        status: 'INTERVIEW',
        completedStages: ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW'],
      });
      expect(() => assertStage(app, 'OFFERED')).not.toThrow();
    });

    it('treats Negotiation as skippable on the way to an offer', () => {
      const app = candidate({
        status: 'INTERVIEW',
        completedStages: ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW'],
      });
      expect(() => assertStage(app, 'OFFERED')).not.toThrow();
      // …and reachable in its own right from anywhere.
      expect(() => assertStage(candidate(), 'NEGOTIATION')).not.toThrow();
    });

    it('never blocks Hold or Reject', () => {
      expect(() => assertStage(candidate(), 'ON_HOLD')).not.toThrow();
      expect(() => assertStage(candidate(), 'REJECTED')).not.toThrow();
    });

    it('lets a candidate resume from Hold with their history intact', () => {
      const app = candidate({
        status: 'ON_HOLD',
        completedStages: ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW', 'ON_HOLD'],
      });
      expect(() => assertStage(app, 'OFFERED')).not.toThrow();
    });

    it('requires an offer before HIRED', () => {
      const app = candidate({
        status: 'INTERVIEW',
        completedStages: ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW'],
      });
      expect(() => assertStage(app, 'HIRED')).toThrow(/must be Offered first/);
    });

    it('allows HIRED once the candidate has been offered', () => {
      const app = candidate({
        status: 'OFFERED',
        completedStages: ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW', 'OFFERED'],
      });
      expect(() => assertStage(app, 'HIRED')).not.toThrow();
    });

    it('requires HIRED before ONBOARDED', () => {
      const app = candidate({
        status: 'OFFERED',
        completedStages: ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW', 'OFFERED'],
      });
      expect(() => assertStage(app, 'ONBOARDED')).toThrow(/must be Hired first/);
    });

    it('normalises the retired status vocabulary', () => {
      const app = candidate({ status: 'INTERVIEWING', completedStages: ['NEW', 'SHORTLISTED'] });
      expect(() => assertStage(app, 'OFFERED')).not.toThrow();
    });
  });

  describe('approval gate on hiring', () => {
    const assertApproval = (stage: string, approvalStatus: string) =>
      (service as any).assertApprovalClear(stage, approvalStatus);

    it('blocks HIRED while an above-budget offer awaits approval', () => {
      expect(() => assertApproval('HIRED', 'PENDING_APPROVAL')).toThrow(/waiting for approval/);
    });

    it('blocks HIRED when the extra payment was rejected', () => {
      expect(() => assertApproval('HIRED', 'REJECTED')).toThrow(/was rejected/);
    });

    it('leaves OFFERED reachable while approval is pending', () => {
      expect(() => assertApproval('OFFERED', 'PENDING_APPROVAL')).not.toThrow();
    });

    it('allows HIRED once approved', () => {
      expect(() => assertApproval('HIRED', 'APPROVED')).not.toThrow();
    });
  });

  describe('profile budget', () => {
    it('uses the candidate budget when one is set', () => {
      expect(budgetOf(candidate({ profileBudget: 1200000 }))).toBe(1200000);
    });

    it('falls back to the job maximum when none is set', () => {
      expect(budgetOf(candidate())).toBe(1000000);
    });

    it('falls back to the job minimum when the job has no maximum', () => {
      // A posted job with only a floor is common, and treating that as "no
      // budget" silently switched the approval rule off for it.
      expect(budgetOf(candidate({ job: { minSalary: 1600000, maxSalary: null } }))).toBe(1600000);
    });

    it('prefers the maximum over the minimum when both are set', () => {
      expect(budgetOf(candidate({ job: { minSalary: 500000, maxSalary: 900000 } }))).toBe(900000);
    });

    it('honours a zero budget rather than treating it as unset', () => {
      expect(budgetOf(candidate({ profileBudget: 0 }))).toBe(0);
    });

    it('reports no budget when neither the candidate nor the job has one', () => {
      expect(budgetOf(candidate({ job: { minSalary: null, maxSalary: null } }))).toBeNull();
    });
  });

  /**
   * The above-budget path writes to the database, so these drive a stub Prisma
   * and assert on exactly what would be persisted.
   */
  describe('above-budget offer holds the candidate in place', () => {
    const buildService = (row: any) => {
      const update = jest.fn(async ({ data }: any) => ({ ...row, ...data }));
      const prisma = {
        jobApplication: { findFirst: jest.fn(async () => row), update },
      };
      const notifications = { notifyApprovers: jest.fn(async () => 1) };
      const svc = new ApplicationsService(
        prisma as any, null as any, notifications as any, null as any,
      );
      return { svc, update, notifications };
    };

    const interviewed = (over: Partial<any> = {}) => ({
      id: 7,
      companyId: 1,
      fullName: 'mohit singh testing',
      status: 'INTERVIEW',
      completedStages: ['APPLIED', 'PHONE_SCREENING', 'INTERVIEW'],
      approvalStatus: 'APPROVED',
      profileBudget: null,
      offeredSalary: null,
      // A job with only a floor — exactly the shape that used to slip through.
      job: { minSalary: 1600000, maxSalary: null },
      ...over,
    });

    it('does not move the candidate to OFFERED', async () => {
      const { svc, update } = buildService(interviewed());
      await svc.updateStatus(7, 1, 'OFFERED', 1800000, undefined, undefined, undefined, 9, 'Competing offer');

      const written = update.mock.calls[0][0].data;
      expect(written.status).toBe('INTERVIEW');
      expect(written.approvalStatus).toBe('PENDING_APPROVAL');
      expect(written.approvalRequestedStage).toBe('OFFERED');
      expect(written.approvalBudget).toBe(1600000);
      expect(written.approvalReason).toBe('Competing offer');
      // OFFERED must not be credited to the history by a request nobody approved.
      expect(written.completedStages).not.toContain('OFFERED');
    });

    it('refuses an above-budget offer with no reason', async () => {
      const { svc, update } = buildService(interviewed());
      await expect(
        svc.updateStatus(7, 1, 'OFFERED', 1800000, undefined, undefined, undefined, 9, '   '),
      ).rejects.toThrow(/reason for the extra payment/i);
      expect(update).not.toHaveBeenCalled();
    });

    it('notifies the approvers', async () => {
      const { svc, notifications } = buildService(interviewed());
      await svc.updateStatus(7, 1, 'OFFERED', 1800000, undefined, undefined, undefined, 9, 'Competing offer');
      expect(notifications.notifyApprovers).toHaveBeenCalledTimes(1);
    });

    it('lets a within-budget offer through untouched', async () => {
      const { svc, update } = buildService(interviewed());
      await svc.updateStatus(7, 1, 'OFFERED', 1500000, undefined, undefined, undefined, 9);

      const written = update.mock.calls[0][0].data;
      expect(written.status).toBe('OFFERED');
      expect(written.approvalStatus).toBe('APPROVED');
      expect(written.completedStages).toContain('OFFERED');
    });

    it('completes the requested move when the approver signs off', async () => {
      const pending = interviewed({
        approvalStatus: 'PENDING_APPROVAL',
        approvalRequestedStage: 'OFFERED',
        offeredSalary: 1800000,
      });
      const { svc, update } = buildService(pending);
      await svc.approveSalary(7, 1, 42);

      const written = update.mock.calls[0][0].data;
      expect(written.status).toBe('OFFERED');
      expect(written.approvalStatus).toBe('APPROVED');
      expect(written.completedStages).toContain('OFFERED');
      expect(written.approvalDecidedById).toBe(42);
    });

    it('leaves the candidate where they are when the approver rejects', async () => {
      const pending = interviewed({
        approvalStatus: 'PENDING_APPROVAL',
        approvalRequestedStage: 'OFFERED',
        offeredSalary: 1800000,
      });
      const { svc, update } = buildService(pending);
      await svc.rejectSalary(7, 1, 42);

      const written = update.mock.calls[0][0].data;
      expect(written.approvalStatus).toBe('REJECTED');
      expect(written.status).toBeUndefined();
    });
  });

  describe('stage history', () => {
    it('appends the new stage without duplicating what is already there', () => {
      const app = candidate({ status: 'PHONE_SCREENING', completedStages: ['APPLIED', 'PHONE_SCREENING'] });
      expect(record(app, 'INTERVIEW')).toEqual(['APPLIED', 'PHONE_SCREENING', 'INTERVIEW']);
    });

    it('credits APPLIED even for a row that never recorded it', () => {
      expect(record({ status: 'PHONE_SCREENING', completedStages: [] }, 'INTERVIEW'))
        .toEqual(['APPLIED', 'PHONE_SCREENING', 'INTERVIEW']);
    });

    it('does not re-add a stage the candidate returns to', () => {
      const app = candidate({ status: 'ON_HOLD', completedStages: ['APPLIED', 'PHONE_SCREENING', 'ON_HOLD'] });
      expect(record(app, 'PHONE_SCREENING')).toEqual(['APPLIED', 'PHONE_SCREENING', 'ON_HOLD']);
    });
  });
});
