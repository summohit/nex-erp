import { useMemo } from 'react';
import { useAuthStore } from '../store/authStore';

interface UserLike {
  role?: string;
  employeeId?: number;
  isManager?: boolean;
}

const isCompanyAdmin = (user: UserLike | null | undefined): boolean =>
  user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';

const findMember = (project: any, employeeId: number | undefined): any =>
  project?.members?.find((m: any) => m.employeeId === employeeId) || null;

export function isProjectOwner(project: any, user: UserLike | null | undefined): boolean {
  if (isCompanyAdmin(user)) return true;
  if (!project || !user?.employeeId) return false;
  if (project.leadId) return project.leadId === user.employeeId;
  // Fallback only when the project has no leadId set at all
  return project.members?.[0]?.employeeId === user.employeeId;
}

export function canManageMembers(project: any, user: UserLike | null | undefined): boolean {
  if (isProjectOwner(project, user)) return true;
  const myMember = findMember(project, user?.employeeId);
  return myMember?.role === 'ADMIN';
}

export function isCurrentUserPM(project: any, user: UserLike | null | undefined): boolean {
  const myMember = findMember(project, user?.employeeId);
  return myMember?.role === 'PROJECT_MANAGER';
}

export function isAssigneePM(issue: any, project: any): boolean {
  if (!issue?.assigneeId) return false;
  const assigneeMember = findMember(project, issue.assigneeId);
  return assigneeMember?.role === 'PROJECT_MANAGER';
}

export function canCompleteIssue(issue: any, project: any, user: UserLike | null | undefined): boolean {
  if (!issue) return true;
  if (!user?.employeeId) return true;

  if (isCurrentUserPM(project, user)) return true;

  if (issue.assigneeId) {
    return Array.isArray(issue.assigneeApproverIds) && issue.assigneeApproverIds.includes(user.employeeId);
  }

  if (user.isManager === false) return false;
  return true;
}

function getColumnById(columnId: number | string | null | undefined, columns: any[]): any {
  if (columnId == null) return null;
  return columns.find((c: any) => c.id === columnId) || null;
}

export function isReviewColumn(columnId: number | string | null | undefined, columns: any[]): boolean {
  const col = getColumnById(columnId, columns);
  if (!col) return false;
  if (col.type === 'REVIEW') return true;
  return (col.name || '').toLowerCase().includes('review');
}

export function isDoneOrArchiveColumn(columnId: number | string | null | undefined, columns: any[]): boolean {
  const col = getColumnById(columnId, columns);
  if (!col) return false;
  if (col.type === 'DONE') return true;
  const name = (col.name || '').toLowerCase();
  return name.includes('done') || name.includes('complete') || name.includes('archive');
}

export function isAdjacentColumnMove(issue: any, targetColumnId: number | string, columns: any[]): boolean {
  if (!issue || !issue.columnId) return true;
  if (!columns || columns.length < 2) return true;
  const fromIndex = columns.findIndex((c: any) => c.id === issue.columnId);
  const toIndex = columns.findIndex((c: any) => c.id === targetColumnId);
  if (fromIndex === -1 || toIndex === -1) return true;
  return Math.abs(toIndex - fromIndex) === 1;
}

export function canMoveIntoReviewOrDone(
  issue: any,
  columnId: number | string,
  project: any,
  user: UserLike | null | undefined,
  columns: any[]
): boolean {
  const review = isReviewColumn(columnId, columns);
  const done = isDoneOrArchiveColumn(columnId, columns);

  if (isAssigneePM(issue, project) && (review || done)) {
    return isProjectOwner(project, user);
  }
  if (done) {
    return isProjectOwner(project, user) || canCompleteIssue(issue, project, user);
  }
  return true;
}

export function isStatusMoveBlocked(
  issue: any,
  columnId: number | string,
  project: any,
  user: UserLike | null | undefined,
  columns: any[]
): boolean {
  if (!issue) return false;
  const review = isReviewColumn(columnId, columns);
  const done = isDoneOrArchiveColumn(columnId, columns);
  if ((review || done) && !canMoveIntoReviewOrDone(issue, columnId, project, user, columns)) return true;
  if (!isAdjacentColumnMove(issue, columnId, columns)) return true;
  return false;
}

export interface ProjectPermissions {
  isOwner: boolean;
  isPM: boolean;
  canManageMembers: boolean;
  canAddMembers: boolean;
  canCreateIssue: boolean;
  canEditIssueContent: boolean;
  canAssignMembers: boolean;
  canApprove: boolean;
  canReject: boolean;
  canSkipProof: boolean;
  canCompleteIssue: (issue: any) => boolean;
  isAssigneePM: (issue: any) => boolean;
  canMoveIntoReviewOrDone: (issue: any, columnId: number | string) => boolean;
  isReviewColumn: (columnId: number | string | null | undefined) => boolean;
  isDoneOrArchiveColumn: (columnId: number | string | null | undefined) => boolean;
  isStatusMoveBlocked: (issue: any, columnId: number | string) => boolean;
}

export function useProjectPermissions(project: any, columns: any[] = []): ProjectPermissions {
  const user = useAuthStore((state) => state.user);

  return useMemo(() => {
    const owner = isProjectOwner(project, user);
    const pm = isCurrentUserPM(project, user);
    return {
      isOwner: owner,
      isPM: pm,
      canManageMembers: canManageMembers(project, user),
      canAddMembers: owner,
      canCreateIssue: owner,
      canEditIssueContent: owner,
      canAssignMembers: owner,
      canApprove: pm,
      canReject: pm,
      canSkipProof: owner || pm,
      canCompleteIssue: (issue: any) => canCompleteIssue(issue, project, user),
      isAssigneePM: (issue: any) => isAssigneePM(issue, project),
      canMoveIntoReviewOrDone: (issue: any, columnId: number | string) =>
        canMoveIntoReviewOrDone(issue, columnId, project, user, columns),
      isReviewColumn: (columnId: number | string | null | undefined) => isReviewColumn(columnId, columns),
      isDoneOrArchiveColumn: (columnId: number | string | null | undefined) => isDoneOrArchiveColumn(columnId, columns),
      isStatusMoveBlocked: (issue: any, columnId: number | string) =>
        isStatusMoveBlocked(issue, columnId, project, user, columns),
    };
  }, [project, user, columns]);
}
