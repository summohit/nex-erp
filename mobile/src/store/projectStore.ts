import { create } from 'zustand';
import { projectService, ProjectSummary } from '../api/projectService';

interface ProjectStoreState {
  projects: any[];
  currentProject: any | null;
  currentSummary: ProjectSummary | null;
  currentBoard: any | null;
  currentIssues: any[];
  isLoading: boolean;
  
  fetchProjects: () => Promise<void>;
  fetchProjectDetails: (id: number) => Promise<void>;
}

export const useProjectStore = create<ProjectStoreState>((set) => ({
  projects: [],
  currentProject: null,
  currentSummary: null,
  currentBoard: null,
  currentIssues: [],
  isLoading: false,

  fetchProjects: async () => {
    set({ isLoading: true });
    try {
      const projects = await projectService.getProjects();
      set({ projects, isLoading: false });
    } catch (error) {
      console.error('Failed to fetch projects', error);
      set({ isLoading: false });
    }
  },

  fetchProjectDetails: async (id: number) => {
    set({ isLoading: true });
    try {
      const [project, summary, board, issues] = await Promise.all([
        projectService.getProject(id),
        projectService.getProjectSummary(id),
        projectService.getBoard(id),
        projectService.getIssues(id)
      ]);
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
  }
}));
