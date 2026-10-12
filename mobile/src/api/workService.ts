import { apiClient } from './apiClient';

// ── Tasks ──────────────────────────────────────────────────────────────────

export type TaskScope = 'mine' | 'created' | 'all';
export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELLED';

export interface TaskPerson { id: number; firstName?: string; lastName?: string | null; avatarUrl?: string | null }

/** One row of /tasks/my — project, general and pre-sales tasks in one shape. */
export interface MyTask {
  source: 'PROJECT' | 'GENERAL' | 'PRE_SALES';
  id: number;
  refKey: string;
  title: string;
  status: TaskStatus;
  rawStatus: string;
  priority: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  createdAt: string | null;
  approvalState?: string | null;
  projectId: number | null;
  projectCode?: string | null;
  assignees: TaskPerson[];
  parent: { kind: 'PROJECT' | 'GENERAL' | 'LEAD'; id: number; name: string } | null;
  isOverdue: boolean;
}

export interface TaskCapabilities { isAdmin: boolean; canCreateTask: boolean }

// ── Approvals ──────────────────────────────────────────────────────────────

export interface PersonLite {
  id: number;
  firstName: string;
  lastName?: string | null;
  avatarUrl?: string | null;
  employeeCode?: string | null;
  designation?: { name: string } | null;
  department?: { name: string } | null;
}

export interface Regularization {
  id: number;
  date: string;
  proposedClockIn?: string | null;
  proposedClockOut?: string | null;
  reason: string;
  employee: PersonLite;
}

/** A late / forgotten clock-out (§Att5) or an out-of-office clock (B3). */
export interface AttendanceApproval {
  id: number;
  date: string;
  clockIn?: string | null;
  clockOut?: string | null;
  clockOutReason?: string | null;
  clockOutProofUrl?: string | null;
  clockInOutside?: boolean;
  clockOutOutside?: boolean;
  clockInDistanceKm?: number | null;
  clockOutDistanceKm?: number | null;
  clockInOutsideReason?: string | null;
  clockOutOutsideReason?: string | null;
  employee: PersonLite;
}

export const workService = {
  async getCapabilities(): Promise<TaskCapabilities> {
    const { data } = await apiClient.get('/tasks/capabilities');
    return { isAdmin: !!data?.isAdmin, canCreateTask: !!data?.canCreateTask };
  },

  /**
   * `scope: 'all'` is the administrator's company-wide view; the server echoes
   * the scope it actually used. `assigneeId` narrows "all" to one person on
   * the server, before its 200-per-source cap.
   */
  async getTasks(opts: { scope: TaskScope; includeDone?: boolean; assigneeId?: number }) {
    const params: Record<string, string> = {};
    if (opts.scope !== 'mine') params.scope = opts.scope;
    if (opts.includeDone) params.includeDone = 'true';
    if (opts.assigneeId) params.assigneeId = String(opts.assigneeId);
    const { data } = await apiClient.get('/tasks/my', { params });
    return { items: (data?.items || []) as MyTask[], truncated: !!data?.truncated, scope: (data?.scope || opts.scope) as TaskScope };
  },

  /** Ask for more hours on a task; goes to the task's approver. */
  async requestHours(issueId: number, requestedHours: number, reason: string) {
    const { data } = await apiClient.post(`/issues/${issueId}/hours-requests`, { requestedHours, reason });
    return data;
  },

  async getEmployees(): Promise<PersonLite[]> {
    const { data } = await apiClient.get('/employees/basic-list');
    return data || [];
  },

  // Regularizations: HR / admins for the company, managers for their team.
  async getPendingRegularizations(): Promise<Regularization[]> {
    const { data } = await apiClient.get('/attendance/regularization/pending');
    return data || [];
  },
  async decideRegularization(id: number, status: 'APPROVED' | 'REJECTED', rejectionReason?: string) {
    await apiClient.post(`/attendance/regularization/${id}/resolve`, { status, rejectionReason });
  },

  async canApproveClockOuts(): Promise<boolean> {
    const { data } = await apiClient.get('/attendance/clock-out/can-approve');
    return !!data?.canApprove;
  },
  async getPendingClockOuts(): Promise<AttendanceApproval[]> {
    const { data } = await apiClient.get('/attendance/clock-out/pending');
    return data || [];
  },
  async decideClockOut(id: number, action: 'APPROVE' | 'REJECT', note?: string) {
    await apiClient.post(`/attendance/clock-out/${id}/review`, { action, note });
  },

  async canApproveOutOfOffice(): Promise<boolean> {
    const { data } = await apiClient.get('/attendance/geofence/can-approve');
    return !!data?.canApprove;
  },
  async getPendingOutOfOffice(): Promise<AttendanceApproval[]> {
    const { data } = await apiClient.get('/attendance/geofence/pending');
    return data || [];
  },
  async decideOutOfOffice(id: number, action: 'APPROVE' | 'REJECT', note?: string) {
    await apiClient.post(`/attendance/geofence/${id}/review`, { action, note });
  },
};
