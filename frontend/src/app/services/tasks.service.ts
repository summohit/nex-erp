import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type TaskSource = 'PROJECT' | 'GENERAL' | 'PRE_SALES';

export interface TaskPerson {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

/**
 * One row of My Tasks, already normalised by the server.
 *
 * Project work and pre-sales work are different models underneath; the server
 * flattens them so this list renders one table instead of branching on source
 * in every cell. `link` is computed server-side too — the routing rule per
 * source lives in one place rather than being re-derived here.
 */
export interface MyTask {
  source: TaskSource;
  id: number;
  refKey: string;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  /** The source's own word, so a pre-sales task still reads "On Hold". */
  rawStatus: string;
  /** Null for pre-sales, which genuinely has no priority. */
  priority: string | null;
  taskType: string | null;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  assignees: TaskPerson[];
  parent: { kind: 'PROJECT' | 'GENERAL' | 'LEAD'; id: number; name: string } | null;
  blockedBy: { id: number; refKey: string; title: string }[];
  isOverdue: boolean;
  link: { route: string; queryParams: Record<string, string> };
  /**
   * Pre-sales only. A pre-sales task is created and driven from this screen now
   * that the deal page no longer carries the table, so the row arrives with the
   * lead it hangs off, the raw values the edit form reopens with, and what this
   * user is allowed to do. The flags decide which buttons render; the server
   * re-checks every one of them before it writes.
   */
  preSales?: {
    leadId: number;
    assignedToId: number | null;
    assignedById: number | null;
    description: string | null;
    scheduledAt: string | null;
    estimatedMinutes: number | null;
    canChangeStatus: boolean;
    canManage: boolean;
  };
}

/** Whose tasks the list is showing. 'all' is offered to administrators only. */
export type TaskScope = 'mine' | 'all';

/** One active member of a deal's pre-sales team — who a task may be given to. */
export interface PreSalesTeamMember {
  employeeId: number;
  status: string;
  employee?: { firstName?: string; lastName?: string; avatarUrl?: string | null; designation?: { name?: string } };
}

export interface PreSalesInfo {
  members: PreSalesTeamMember[];
  tasks: any[];
  permissions: { canCreateTasks?: boolean; [k: string]: any };
}

export interface PreSalesTaskHistoryEntry {
  id: number;
  previousStatus: string | null;
  newStatus: string;
  remark: string | null;
  createdAt: string;
  changedBy?: { firstName?: string; lastName?: string; avatarUrl?: string | null };
  attachments?: { id: number; fileName: string; fileUrl: string }[];
}

export interface TaskCapabilities {
  canCreateTask: boolean;
  canCreateGeneral: boolean;
  isAdmin: boolean;
}

export interface TaskType {
  id: number;
  name: string;
  isActive: boolean;
  position: number;
}

export interface LeadOption {
  id: number;
  leadCode?: string | null;
  title?: string;
  companyName?: string | null;
  contactName?: string | null;
  flow?: string | null;
  status?: string | null;
  dealCategory?: string | null;
}

@Injectable({ providedIn: 'root' })
export class TasksService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/tasks`;

  /**
   * Whether this user may raise a task — answered by the server rather than
   * re-implemented here, so the department rule has one authority and flipping
   * the flag in Master Data takes effect without a frontend release.
   */
  getCapabilities(): Observable<TaskCapabilities> {
    return this.http.get<TaskCapabilities>(`${this.apiUrl}/capabilities`);
  }

  /**
   * `scope: 'all'` is the administrator's company-wide view. The server decides
   * whether the caller may have it and echoes back what it actually returned,
   * so the screen can label itself honestly rather than trusting the request.
   */
  getMyTasks(opts: { includeReported?: boolean; includeDone?: boolean; scope?: TaskScope } = {}):
    Observable<{ items: MyTask[]; truncated: boolean; scope: TaskScope }> {
    const params: string[] = [];
    if (opts.includeReported) params.push('includeReported=true');
    if (opts.includeDone) params.push('includeDone=true');
    if (opts.scope === 'all') params.push('scope=all');
    return this.http.get<{ items: MyTask[]; truncated: boolean; scope: TaskScope }>(
      `${this.apiUrl}/my${params.length ? '?' + params.join('&') : ''}`,
    );
  }

  createTask(payload: any): Observable<any> {
    return this.http.post(this.apiUrl, payload);
  }

  /**
   * Deals, for the "belongs to a pre-sales deal" picker. Identity fields only —
   * this list must not become a route to commercial figures for someone who is
   * only on a deal's pre-sales team.
   */
  getLeadOptions(): Observable<LeadOption[]> {
    return this.http.get<LeadOption[]>(`${environment.apiUrl}/crm/leads`);
  }

  getTaskTypes(activeOnly = true): Observable<TaskType[]> {
    return this.http.get<TaskType[]>(
      `${environment.apiUrl}/master-data/task-types${activeOnly ? '?activeOnly=true' : ''}`,
    );
  }

  // ── pre-sales tasks ──────────────────────────────────────────────────────
  //
  // A pre-sales task is not an Issue. It has a team it must be assigned within
  // and an hours budget it may not exceed, both enforced by CrmService, so it
  // keeps its own model and its own endpoints — these are the same routes the
  // deal page used before the table moved here.

  private preSalesUrl(leadId: number): string {
    return `${environment.apiUrl}/crm/leads/${leadId}/pre-sales`;
  }

  /** The deal's team and what this user may do on it, for the composer. */
  getPreSalesInfo(leadId: number): Observable<PreSalesInfo> {
    return this.http.get<PreSalesInfo>(this.preSalesUrl(leadId));
  }

  createPreSalesTask(leadId: number, payload: any): Observable<any> {
    return this.http.post(`${this.preSalesUrl(leadId)}/tasks`, payload);
  }

  /** Title, schedule and duration. Never the status — that has its own route. */
  updatePreSalesTask(leadId: number, taskId: number, payload: any): Observable<any> {
    return this.http.put(`${this.preSalesUrl(leadId)}/tasks/${taskId}`, payload);
  }

  changePreSalesTaskStatus(
    leadId: number,
    taskId: number,
    payload: { status: string; remark?: string; attachments?: any[] },
  ): Observable<any> {
    return this.http.post(`${this.preSalesUrl(leadId)}/tasks/${taskId}/status`, payload);
  }

  deletePreSalesTask(leadId: number, taskId: number): Observable<any> {
    return this.http.delete(`${this.preSalesUrl(leadId)}/tasks/${taskId}`);
  }

  getPreSalesTaskHistory(leadId: number, taskId: number): Observable<PreSalesTaskHistoryEntry[]> {
    return this.http.get<PreSalesTaskHistoryEntry[]>(`${this.preSalesUrl(leadId)}/tasks/${taskId}/history`);
  }
}
