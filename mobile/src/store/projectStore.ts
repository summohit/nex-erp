import { create } from 'zustand';
import { projectService, ProjectSummary } from '../api/projectService';

interface ProjectStoreState {
  projects: any[];
  archivedProjects: any[];
  currentProject: any | null;
  currentSummary: ProjectSummary | null;
  currentBoard: any | null;
  currentIssues: any[];
  isLoading: boolean;
  accessDenied: boolean;

  fetchProjects: () => Promise<void>;
  fetchProjectDetails: (id: number) => Promise<void>;
  toggleStar: (id: number) => Promise<void>;
  archiveProject: (id: number, force?: boolean) => Promise<void>;
  unarchiveProject: (id: number) => Promise<void>;
  createIssue: (projectId: number, data: any) => Promise<void>;
  updateIssue: (projectId: number, issueId: number, data: any) => Promise<void>;
  updateIssueStatus: (projectId: number, issueId: number, status: string) => Promise<void>;
  updateIssueColumn: (projectId: number, issueId: number, columnId: number) => Promise<void>;
  updateIssuePriority: (projectId: number, issueId: number, priority: string) => Promise<void>;
  toggleIssueArchive: (projectId: number, issueId: number) => Promise<void>;
  reviewIssue: (projectId: number, issueId: number, action: 'APPROVE' | 'REJECT', reason?: string) => Promise<void>;
  addProjectMember: (projectId: number, employeeId: number, role?: string) => Promise<void>;
  removeProjectMember: (projectId: number, employeeId: number) => Promise<void>;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  archivedProjects: [],
  currentProject: null,
  currentSummary: null,
  currentBoard: null,
  currentIssues: [],
  isLoading: false,
  accessDenied: false,

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      const [projects, archivedProjects] = await Promise.all([
        projectService.getProjects(),
        projectService.getArchivedProjects(),
      ]);
      set({ projects, archivedProjects, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch projects', error);
      set({ isLoading: false });
    }
  },

  toggleStar: async (id: number) => {
    try {
      await projectService.toggleProjectStar(id);
      // Optimistic update would be better, but refetching is safer for now
      await get().fetchProjects();
    } catch (error) {
      console.error('Failed to toggle star', error);
      throw error;
    }
  },

  archiveProject: async (id: number, force?: boolean) => {
    try {
      await projectService.archiveProject(id, force);
      await get().fetchProjects();
    } catch (error) {
      console.error('Failed to archive project', error);
      throw error;
    }
  },

  unarchiveProject: async (id: number) => {
    try {
      await projectService.unarchiveProject(id);
      await get().fetchProjects();
    } catch (error) {
      console.error('Failed to unarchive project', error);
      throw error;
    }
  },

  fetchProjectDetails: async (id: number) => {
    set({ isLoading: true, accessDenied: false });
    try {
      const results = await Promise.allSettled([
        projectService.getProject(id),
        projectService.getProjectSummary(id),
        projectService.getBoard(id),
        projectService.getIssues(id)
      ]);

      const projectResult = results[0];
      if (projectResult.status === 'rejected' && (projectResult.reason as any)?.response?.status === 403) {
        set({
          isLoading: false,
          accessDenied: true,
          currentProject: null,
          currentSummary: null,
          currentBoard: null,
          currentIssues: [],
        });
        return;
      }

      const project = projectResult.status === 'fulfilled' ? projectResult.value : null;
      const summary = results[1].status === 'fulfilled' ? results[1].value : null;
      const board = results[2].status === 'fulfilled' ? results[2].value : null;
      const issues = results[3].status === 'fulfilled' ? results[3].value : [];

      set({
        currentProject: project,
        currentSummary: summary,
        currentBoard: board,
        currentIssues: issues,
        isLoading: false
      });
    } catch (error) {
      console.error('Failed to fetch project details', error);
      set({ isLoading: false });
    }
  },

  updateIssueStatus: async (projectId: number, issueId: number, status: string) => {
    try {
      // Optimistic update
      set((state) => ({
        currentIssues: state.currentIssues.map(issue =>
          issue.id === issueId ? { ...issue, status } : issue
        )
      }));
      // Merge the server response — the backend may set side effects here
      // (e.g. auto-starting/stopping the work timer based on the new status)
      // that a plain optimistic patch would silently discard.
      const updated = await projectService.updateIssue(projectId, issueId, { status });
      set((state) => ({
        currentIssues: state.currentIssues.map(i => i.id === issueId ? { ...i, ...updated } : i)
      }));
    } catch (error) {
      console.error('Failed to update issue status', error);
      // Revert on fail
      await get().fetchProjectDetails(projectId);
      throw error;
    }
  },

  updateIssueColumn: async (projectId: number, issueId: number, columnId: number) => {
    try {
      // Optimistic update
      set((state) => ({
        currentIssues: state.currentIssues.map(issue =>
          issue.id === issueId ? { ...issue, columnId } : issue
        )
      }));
      // Merge the server response — moving columns can auto-derive a new status
      // server-side (e.g. IN_PROGRESS/IN_REVIEW) and auto start/stop the work
      // timer as a side effect; a plain columnId patch would lose that.
      const updated = await projectService.updateIssue(projectId, issueId, { columnId });
      set((state) => ({
        currentIssues: state.currentIssues.map(i => i.id === issueId ? { ...i, ...updated } : i)
      }));
    } catch (error) {
      console.error('Failed to update issue column', error);
      // Revert on fail
      await get().fetchProjectDetails(projectId);
      throw error;
    }
  },

  updateIssuePriority: async (projectId: number, issueId: number, priority: string) => {
    try {
      // Optimistic update
      set((state) => ({
        currentIssues: state.currentIssues.map(issue => 
          issue.id === issueId ? { ...issue, priority } : issue
        )
      }));
      await projectService.updateIssue(projectId, issueId, { priority });
    } catch (error) {
      console.error('Failed to update issue priority', error);
      // Revert on fail
      await get().fetchProjectDetails(projectId);
      throw error;
    }
  },

  createIssue: async (projectId: number, data: any) => {
    try {
      const newIssue = await projectService.createIssue(projectId, data);
      set((state) => ({
        currentIssues: [...state.currentIssues, newIssue]
      }));
    } catch (error) {
      console.error('Failed to create issue', error);
      throw error;
    }
  },

  updateIssue: async (projectId: number, issueId: number, data: any) => {
    try {
      const updated = await projectService.updateIssue(projectId, issueId, data);
      set((state) => ({
        currentIssues: state.currentIssues.map(i => i.id === issueId ? { ...i, ...updated } : i)
      }));
    } catch (error) {
      console.error('Failed to update issue', error);
      throw error;
    }
  },

  toggleIssueArchive: async (projectId: number, issueId: number) => {
    try {
      await projectService.toggleIssueArchive(projectId, issueId);
      set((state) => ({
        currentIssues: state.currentIssues.map(i =>
          i.id === issueId ? { ...i, isArchived: !i.isArchived } : i
        )
      }));
    } catch (error) {
      console.error('Failed to toggle issue archive', error);
      throw error;
    }
  },

  reviewIssue: async (projectId: number, issueId: number, action: 'APPROVE' | 'REJECT', reason?: string) => {
    try {
      const updated = await projectService.reviewIssue(projectId, issueId, action, reason);
      set((state) => ({
        currentIssues: state.currentIssues.map(i => i.id === issueId ? { ...i, ...updated } : i)
      }));
    } catch (error) {
      console.error('Failed to review issue', error);
      throw error;
    }
  },

  addProjectMember: async (projectId: number, employeeId: number, role: string = 'MEMBER') => {
    try {
      await projectService.addProjectMember(projectId, employeeId, role);
      await get().fetchProjectDetails(projectId);
    } catch (error) {
      console.error('Failed to add project member', error);
      throw error;
    }
  },

  removeProjectMember: async (projectId: number, employeeId: number) => {
    try {
      await projectService.removeProjectMember(projectId, employeeId);
      await get().fetchProjectDetails(projectId);
    } catch (error) {
      console.error('Failed to remove project member', error);
      throw error;
    }
  },
}));
