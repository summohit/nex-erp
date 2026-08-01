import { Component, signal, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { 
  LucidePlus, LucideKanban, 
  LucideX, LucideUser, LucideChevronLeft, LucideCheck, LucideMoreHorizontal, 
  LucideStar, LucideSearch, LucideClock
} from '@lucide/angular';
import { ProjectsService } from '../services/projects';

@Component({
  selector: 'app-projects',
  standalone: true,
  imports: [
    CommonModule, FormsModule, LucidePlus, LucideKanban, 
    LucideX, LucideUser, LucideChevronLeft, 
    LucideCheck, LucideMoreHorizontal, LucideStar, LucideSearch, LucideClock
  ],
  templateUrl: './projects.html',
  styleUrls: ['./projects.css']
})
export class ProjectsComponent implements OnInit {
  private projectsService = inject(ProjectsService);
  private router = inject(Router);

  projects = signal<any[]>([]);
  searchQuery = signal<string>('');
  activeTab = signal<'all' | 'starred' | 'recent'>('all');
  
  // Local persistence for Starred & Recently Viewed
  starredBoardIds = signal<number[]>([]);
  recentlyViewedIds = signal<number[]>([]);

  isCreateModalOpen = signal(false);
  isSubmitted = signal(false);

  // Background Options (Images & Color gradients matching Trello style)
  imageBackgrounds = [
    'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=600&q=80', // Night City (matches screenshot)
    'https://images.unsplash.com/photo-1506744038136-46273834b3fb?w=600&q=80', // Mountains
    'https://images.unsplash.com/photo-1477959858617-67f30ac4ce78?w=600&q=80', // Golden Hour City
    'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=600&q=80'  // Red glow
  ];

  colorBackgrounds = [
    'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
    'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
    'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
    'linear-gradient(135deg, #4338ca 0%, #312e81 100%)',
    'linear-gradient(135deg, #9333ea 0%, #c026d3 100%)'
  ];

  selectedBg = signal<string>(this.imageBackgrounds[0]);

  projectForm = {
    name: '',
    visibility: 'Workspace',
    description: ''
  };

  gradients = [
    'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
    'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
    'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    'linear-gradient(135deg, #ef4444 0%, #f43f5e 100%)',
    'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
  ];

  // Filtered lists
  filteredProjects = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    let list = this.projects();

    if (this.activeTab() === 'starred') {
      list = list.filter(p => this.starredBoardIds().includes(p.id));
    } else if (this.activeTab() === 'recent') {
      list = list.filter(p => this.recentlyViewedIds().includes(p.id));
    }

    if (!q) return list;
    return list.filter(p => p.name.toLowerCase().includes(q) || p.key?.toLowerCase().includes(q));
  });

  starredProjects = computed(() => {
    return this.projects().filter(p => this.starredBoardIds().includes(p.id));
  });

  recentlyViewedProjects = computed(() => {
    return this.projects().filter(p => this.recentlyViewedIds().includes(p.id));
  });

  ngOnInit() {
    this.loadStarredAndRecent();
    this.loadProjects();
  }

  loadStarredAndRecent() {
    try {
      const starred = localStorage.getItem('starred_board_ids');
      if (starred) this.starredBoardIds.set(JSON.parse(starred));

      const recent = localStorage.getItem('recently_viewed_board_ids');
      if (recent) this.recentlyViewedIds.set(JSON.parse(recent));
    } catch (e) {}
  }

  loadProjects() {
    this.projectsService.getProjects().subscribe({
      next: (res) => this.projects.set(res),
      error: (err) => console.error('Error loading projects', err)
    });
  }

  toggleStar(projectId: number, event?: Event) {
    if (event) event.stopPropagation();
    let current = [...this.starredBoardIds()];
    if (current.includes(projectId)) {
      current = current.filter(id => id !== projectId);
    } else {
      current.push(projectId);
    }
    this.starredBoardIds.set(current);
    localStorage.setItem('starred_board_ids', JSON.stringify(current));
  }

  isStarred(projectId: number): boolean {
    return this.starredBoardIds().includes(projectId);
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
    this.projectForm = { name: '', visibility: 'Workspace', description: '' };
    this.selectedBg.set(this.imageBackgrounds[0]);
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
      color: bgValue
    };

    this.projectsService.createProject(payload).subscribe({
      next: (res) => {
        this.loadProjects();
        this.closeCreateModal();
        this.goToProject(res.id);
      },
      error: (err) => console.error('Error creating project', err)
    });
  }

  goToProject(id: number) {
    // Record in recently viewed
    let recent = [id, ...this.recentlyViewedIds().filter(i => i !== id)].slice(0, 6);
    this.recentlyViewedIds.set(recent);
    localStorage.setItem('recently_viewed_board_ids', JSON.stringify(recent));

    this.router.navigate(['/projects', id]);
  }
}
