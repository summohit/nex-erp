import { Component, inject, signal, computed, HostListener, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EmployeeService } from '../../../services/employee.service';
import { ProjectsService } from '../../../services/projects';
import { 
  LucideSearch, LucideUser, LucideBriefcase, LucideLayers, LucideCalendar, 
  LucideDollarSign, LucideSettings, LucideAward, LucideShieldCheck, LucideCommand, LucideX,
  LucideArrowRight, LucideBuilding, LucideFileText
} from '@lucide/angular';

export interface SearchResultItem {
  id: string;
  category: 'Navigation' | 'Employees' | 'Projects' | 'Settings';
  title: string;
  subtitle?: string;
  icon: any;
  action: () => void;
}

@Component({
  selector: 'app-spotlight-search',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    LucideSearch, LucideUser, LucideBriefcase, LucideLayers, LucideCalendar, 
    LucideDollarSign, LucideSettings, LucideAward, LucideShieldCheck, LucideCommand, LucideX,
    LucideArrowRight, LucideBuilding, LucideFileText
  ],
  templateUrl: './spotlight-search.component.html',
  styleUrls: ['./spotlight-search.component.css']
})
export class SpotlightSearchComponent {
  private router = inject(Router);
  private employeeService = inject(EmployeeService);
  private projectsService = inject(ProjectsService);

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  isOpen = signal<boolean>(false);
  query = signal<string>('');
  selectedIndex = signal<number>(0);

  employeesList = signal<any[]>([]);
  projectsList = signal<any[]>([]);

  // Navigation Items
  private navItems: SearchResultItem[] = [
    { id: 'nav-dash', category: 'Navigation', title: 'Dashboard', subtitle: 'Executive overview & quick stats', icon: LucideLayers, action: () => this.navigate('/dashboard') },
    { id: 'nav-emp', category: 'Navigation', title: 'Employee Directory', subtitle: 'View all staff and team profiles', icon: LucideUser, action: () => this.navigate('/employees/directory') },
    { id: 'nav-org', category: 'Navigation', title: 'Organization Chart', subtitle: 'Interactive visual org hierarchy', icon: LucideBuilding, action: () => this.navigate('/employees/org-chart') },
    { id: 'nav-docs', category: 'Navigation', title: 'Employee Documents Center', subtitle: 'Company policies & verification files', icon: LucideFileText, action: () => this.navigate('/employees/documents') },
    { id: 'nav-att', category: 'Navigation', title: 'Attendance & Leave Management', subtitle: 'Clock-in logs & leave requests', icon: LucideCalendar, action: () => this.navigate('/attendance') },
    { id: 'nav-prj', category: 'Navigation', title: 'Projects & Kanban Board', subtitle: 'Jira-style task management', icon: LucideBriefcase, action: () => this.navigate('/projects') },
    { id: 'nav-pay', category: 'Navigation', title: 'Payroll & Compensation', subtitle: 'Salary slips & salary structures', icon: LucideDollarSign, action: () => this.navigate('/payroll') },
    { id: 'nav-ast', category: 'Navigation', title: 'Asset Management', subtitle: 'Company hardware & laptops', icon: LucideBriefcase, action: () => this.navigate('/assets') },
    { id: 'nav-awa', category: 'Navigation', title: 'Appreciation & Awards', subtitle: 'Employee recognition badges', icon: LucideAward, action: () => this.navigate('/appreciation') },
    { id: 'nav-master', category: 'Settings', title: 'Master Data Settings', subtitle: 'Manage Branches, Departments & Designations', icon: LucideSettings, action: () => this.navigate('/settings/master-data') },
    { id: 'nav-perm', category: 'Settings', title: 'Roles & Permissions', subtitle: 'RBAC module access matrix', icon: LucideShieldCheck, action: () => this.navigate('/settings/permissions') },
  ];

  constructor() {
    this.loadData();
  }

  private loadData() {
    this.employeeService.getEmployees().subscribe({
      next: (res: any) => this.employeesList.set(res.data || res || [])
    });

    this.projectsService.getProjects().subscribe({
      next: (res: any) => this.projectsList.set(res.data || res || [])
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.toggleOpen();
    } else if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      this.close();
    } else if (this.isOpen()) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.selectedIndex.update(i => (i + 1) % Math.max(1, this.filteredResults().length));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.selectedIndex.update(i => (i - 1 + this.filteredResults().length) % Math.max(1, this.filteredResults().length));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const results = this.filteredResults();
        if (results.length > 0 && results[this.selectedIndex()]) {
          results[this.selectedIndex()].action();
        }
      }
    }
  }

  open() {
    this.isOpen.set(true);
    this.query.set('');
    this.selectedIndex.set(0);
    setTimeout(() => {
      if (this.searchInput) {
        this.searchInput.nativeElement.focus();
      }
    }, 50);
  }

  close() {
    this.isOpen.set(false);
  }

  toggleOpen() {
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  }

  filteredResults = computed<SearchResultItem[]>(() => {
    const q = this.query().toLowerCase().trim();
    
    let list: SearchResultItem[] = [...this.navItems];

    // Dynamic Employee Search Results
    const empMatches: SearchResultItem[] = this.employeesList()
      .filter(e => 
        (e.firstName + ' ' + e.lastName).toLowerCase().includes(q) ||
        (e.email || '').toLowerCase().includes(q) ||
        (e.designation?.name || '').toLowerCase().includes(q)
      )
      .slice(0, 5)
      .map(e => ({
        id: `emp-${e.id}`,
        category: 'Employees' as const,
        title: `${e.firstName} ${e.lastName}`,
        subtitle: `${e.designation?.name || 'Staff'} • ${e.department?.name || 'General'}`,
        icon: LucideUser,
        action: () => this.navigate(`/employees/${e.id}/profile`)
      }));

    // Dynamic Project Search Results
    const prjMatches: SearchResultItem[] = this.projectsList()
      .filter(p => p.name.toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q))
      .slice(0, 5)
      .map(p => ({
        id: `prj-${p.id}`,
        category: 'Projects' as const,
        title: p.name,
        subtitle: `Project Code: ${p.code || 'PRJ'} • Status: ${p.status}`,
        icon: LucideBriefcase,
        action: () => this.navigate(`/projects/${p.id}`)
      }));

    const combined = [...list, ...empMatches, ...prjMatches];

    if (!q) return combined;

    return combined.filter(item => 
      item.title.toLowerCase().includes(q) || 
      (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
      item.category.toLowerCase().includes(q)
    );
  });

  private navigate(path: string) {
    this.close();
    this.router.navigate([path]);
  }
}
