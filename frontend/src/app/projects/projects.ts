import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { 
  LucidePlus, LucideKanban, 
  LucideX, LucideUser, LucideChevronLeft, LucideCheck, LucideMoreHorizontal, 
  LucideStar, LucideSearch, LucideClock, LucideEdit2, LucideArchive, LucideRotateCcw
} from '@lucide/angular';
import { ProjectsService } from '../services/projects';
import { ClientsService } from '../services/clients';
import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LucidePlus, LucideKanban, 
    LucideX, LucideUser, LucideChevronLeft, 
    LucideCheck, LucideStar, LucideSearch, LucideClock, LucideEdit2, LucideArchive, LucideRotateCcw
  ],
  templateUrl: './projects.html',
  styleUrls: ['./projects.css']
})
export class ProjectsComponent implements OnInit {
  private projectsService = inject(ProjectsService);
  private clientsService = inject(ClientsService);
  private router = inject(Router);
  private authService = inject(AuthService);

  showArchiveWarningModal = false;
  pendingArchiveProjectId: number | null = null;
  archiveWarningMessage = '';

  currentUser = this.authService.currentUser;

  projects = signal<any[]>([]);
  archivedProjects = signal<any[]>([]);
  clients = signal<any[]>([]);
  searchQuery = signal<string>('');
  activeTab = signal<'all' | 'starred' | 'recent' | 'archived'>('all');
  
  // Local persistence for Starred & Recently Viewed
  starredBoardIds = signal<number[]>([]);
  recentlyViewedIds = signal<number[]>([]);

  isCreateModalOpen = signal(false);
  isSubmitted = signal(false);
  editingProjectId = signal<number | null>(null);

  // Background Options (Images & Color gradients matching Trello style)
  imageBackgrounds = [
    'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=600&q=80', // Night City (matches screenshot)
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&q=80', // Mountains
    'https://images.unsplash.com/photo-1477959858617-67f30ac4ce78?w=600&q=80', // Golden Hour City
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&q=80'  // Red glow
  ];

  colorBackgrounds = [
    'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    'linear-gradient(135deg, #ef4444 0%, #f43f5e 100%)',
    'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
  ];

  selectedBg = signal<string>(this.colorBackgrounds[1]);

  projectForm = {
    name: '',
    visibility: 'Workspace',
    description: '',
    startDate: '',
    endDate: '',
    billingType: 'NON_BILLABLE',
    budgetAmount: null as number | null,
    hourlyRate: null as number | null,
    clientId: null as number | null
  };

  gradients = [
    'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    'linear-gradient(135deg, #ef4444 0%, #f43f5e 100%)',
    'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
  ];

  get isAdmin(): boolean {
    const user = this.currentUser();
    return user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';
  }

  myProjects = computed(() => {
    return this.projects().filter(p => p.members && p.members.length > 0);
  });

  // Filtered lists
  filteredProjects = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    
    if (this.activeTab() === 'archived') {
      return this.archivedProjects();
    }
    
    let list = this.myProjects();

    if (this.activeTab() === 'starred') {
      list = list.filter(p => p.members && p.members.length > 0 && p.members[0].isStarred);
    } else if (this.activeTab() === 'recent') {
      list = list.filter(p => this.recentlyViewedIds().includes(p.id));
    }

    if (!q) return list;
    return list.filter(p => p.name.toLowerCase().includes(q) || p.key?.toLowerCase().includes(q));
  });

  starredProjects = computed(() => {
    return this.myProjects().filter(p => p.members && p.members.length > 0 && p.members[0].isStarred);
  });

  recentlyViewedProjects = computed(() => {
    return this.myProjects().filter(p => this.recentlyViewedIds().includes(p.id));
  });

  ngOnInit() {
    this.loadStarredAndRecent();
    this.loadProjects();
    this.loadArchivedProjects();
    this.loadClients();
  }

  loadClients() {
    this.clientsService.getClients().subscribe({
      next: (res) => this.clients.set(res || []),
      error: (err) => console.error('Error loading clients', err)
    });
  }

  setActiveTab(tab: 'all' | 'starred' | 'recent' | 'archived') {
    this.activeTab.set(tab);
    if (tab === 'archived') {
      this.loadArchivedProjects();
    }
  }

  loadStarredAndRecent() {
    try {
      const recent = localStorage.getItem('recently_viewed_board_ids');
      if (recent) this.recentlyViewedIds.set(JSON.parse(recent));
    } catch (e) {}
  }

  isLoading = signal<boolean>(true);

  loadProjects() {
    this.isLoading.set(true);
    this.projectsService.getProjects().subscribe({
      next: (res) => {
        this.projects.set(res);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading projects', err);
        this.isLoading.set(false);
      }
    });
  }

  toggleStar(projectId: number, event?: Event) {
    if (event) event.stopPropagation();
    
    // Call the backend service
    this.projectsService.toggleProjectStar(projectId).subscribe({
      next: () => {
        // Optimistically update local project state or reload projects
        this.projects.update(list => list.map(p => {
          if (p.id === projectId) {
            const isCurrentlyStarred = p.members && p.members.length > 0 && p.members[0].isStarred;
            const updatedMembers = p.members && p.members.length > 0 
              ? [{ ...p.members[0], isStarred: !isCurrentlyStarred }]
              : [{ isStarred: true }];
            return { ...p, members: updatedMembers };
          }
          return p;
        }));
      },
      error: (err) => console.error('Failed to toggle star', err)
    });
  }

  isStarred(projectId: number): boolean {
    const p = this.projects().find(proj => proj.id === projectId);
    if (p && p.members && p.members.length > 0) {
      return !!p.members[0].isStarred;
    }
    return false;
  }

  getGradient(color: string, index: number): string {
    if (color) {
      if (color.startsWith('linear-gradient')) return color;
      if (color.startsWith('http') || color.startsWith('url')) return `url(${color})`;
    }
    return this.gradients[index % this.gradients.length];
  }

  selectBg(bg: string) {
    this.selectedBg.set(bg);
  }

  openCreateModal() {
    this.editingProjectId.set(null);
    this.projectForm = { 
      name: '', 
      visibility: 'Workspace', 
      description: '',
      startDate: '',
      endDate: '',
      billingType: 'NON_BILLABLE',
      budgetAmount: null as number | null,
      hourlyRate: null as number | null,
      clientId: null as number | null
    };
    this.selectedBg.set(this.colorBackgrounds[1]);
    this.isSubmitted.set(false);
    this.isCreateModalOpen.set(true);
  }

  openEditModal(project: any, event: Event) {
    if (event) event.stopPropagation();
    this.editingProjectId.set(project.id);
    this.projectForm = { 
      name: project.name, 
      visibility: 'Workspace', 
      description: project.description || '',
      startDate: project.startDate ? project.startDate.split('T')[0] : '',
      endDate: project.endDate ? project.endDate.split('T')[0] : '',
      billingType: project.billingType || 'NON_BILLABLE',
      budgetAmount: project.budgetAmount,
      hourlyRate: project.hourlyRate,
      clientId: project.clientId
    };
    
    // Set the selected background (match it or use gradient as fallback)
    let color = project.color;
    if (color && color.startsWith('url(')) {
      color = color.substring(4, color.length - 1); // remove url()
    }
    this.selectedBg.set(color || this.colorBackgrounds[1]);
    
    this.isSubmitted.set(false);
    this.isCreateModalOpen.set(true);
  }

  closeCreateModal() {
    this.isCreateModalOpen.set(false);
  }

  saveProject() {
    this.isSubmitted.set(true);
    if (!this.projectForm.name.trim()) return;

    const bgValue = this.selectedBg().startsWith('http') 
      ? `url(${this.selectedBg()})` 
      : this.selectedBg();

    const payload = {
      name: this.projectForm.name.trim(),
      description: this.projectForm.description,
      color: bgValue,
      startDate: this.projectForm.startDate || null,
      endDate: this.projectForm.endDate || null,
      billingType: this.projectForm.billingType,
      budgetAmount: this.projectForm.budgetAmount || null,
      hourlyRate: this.projectForm.hourlyRate || null,
      clientId: this.projectForm.clientId || null
    };

    if (this.editingProjectId()) {
      this.projectsService.updateProject(this.editingProjectId()!, payload).subscribe({
        next: (res) => {
          this.loadProjects();
          this.closeCreateModal();
        },
        error: (err) => console.error('Error updating project', err)
      });
    } else {
      this.projectsService.createProject(payload).subscribe({
        next: (res) => {
          this.loadProjects();
          this.closeCreateModal();
          this.goToProject(res.id);
        },
        error: (err) => console.error('Error creating project', err)
      });
    }
  }

  archiveBoard(project: any, force: boolean, event: Event) {
    event.stopPropagation();
    this.projectsService.archiveProject(project.id, force).subscribe({
      next: () => {
        this.loadProjects();
        this.loadArchivedProjects();
        this.closeArchiveModal();
      },
      error: (err) => {
        if (err.status === 409) {
          this.pendingArchiveProjectId = project.id;
          this.archiveWarningMessage = err.error?.message || 'There are active tasks remaining in this board.';
          this.showArchiveWarningModal = true;
        } else {
          console.error('Failed to archive board', err);
        }
      }
    });
  }

  loadArchivedProjects() {
    this.projectsService.getArchivedProjects().subscribe({
      next: (res) => {
        this.archivedProjects.set(res);
      },
      error: () => console.error('Failed to load archived projects')
    });
  }

  unarchiveBoard(project: any, event: Event) {
    event.stopPropagation();
    this.projectsService.unarchiveProject(project.id).subscribe({
      next: () => {
        this.loadProjects();
        this.loadArchivedProjects();
      },
      error: () => console.error('Failed to unarchive board')
    });
  }

  closeArchiveModal() {
    this.showArchiveWarningModal = false;
    this.pendingArchiveProjectId = null;
    this.archiveWarningMessage = '';
  }

  confirmArchiveBoard() {
    if (this.pendingArchiveProjectId) {
      this.archiveBoard({ id: this.pendingArchiveProjectId }, true, new Event('click'));
    }
  }

  goToProject(id: number) {
    // Record in recently viewed
    let recent = [id, ...this.recentlyViewedIds().filter(i => i !== id)].slice(0, 6);
    this.recentlyViewedIds.set(recent);
    localStorage.setItem('recently_viewed_board_ids', JSON.stringify(recent));

    this.router.navigate(['/projects', id]);
  }
}
