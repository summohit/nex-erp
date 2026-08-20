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
  
  fetchProjects: () => Promise<void>;
  fetchProjectDetails: (id: number) => Promise<void>;
  toggleStar: (id: number) => Promise<void>;
  archiveProject: (id: number, force?: boolean) => Promise<void>;
  unarchiveProject: (id: number) => Promise<void>;
  createIssue: (projectId: number, data: any) => Promise<void>;
  updateIssueStatus: (projectId: number, issueId: number, status: string) => Promise<void>;
  updateIssueColumn: (projectId: number, issueId: number, columnId: number) => Promise<void>;
  updateIssuePriority: (projectId: number, issueId: number, priority: string) => Promise<void>;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: [],
  archivedProjects: [],
  currentProject: null,
  currentSummary: null,
  currentBoard: null,
  currentIssues: [],
  isLoading: false,

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
    set({ isLoading: true });
    try {
      const results = await Promise.allSettled([
        projectService.getProject(id),
        projectService.getProjectSummary(id),
        projectService.getBoard(id),
        projectService.getIssues(id)
      ]);
      
      const project = results[0].status === 'fulfilled' ? results[0].value : null;
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
      await projectService.updateIssue(projectId, issueId, { status });
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
      await projectService.updateIssue(projectId, issueId, { columnId });
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
      // Create issue on backend
      const newIssue = await projectService.createIssue(projectId, data);
      // Optimistic update of list
      set((state) => ({
        currentIssues: [...state.currentIssues, newIssue]
      }));
    } catch (error) {
      console.error('Failed to create issue', error);
      throw error;
    }
  }
}));
