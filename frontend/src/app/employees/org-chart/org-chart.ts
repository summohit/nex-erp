import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import {
  LucideUser,
  LucideUsers,
  LucideChevronDown,
  LucideChevronUp,
  LucideChevronRight,
  LucideZoomIn,
  LucideZoomOut,
  LucideMaximize,
  LucideRotateCcw,
  LucideSearch,
  LucideBuilding,
  LucideBriefcase,
  LucideMail,
  LucidePhone,
  LucideMapPin,
  LucideCrown,
  LucideX,
  LucideExternalLink,
  LucideNetwork,
  LucideLayers,
  LucideSlidersHorizontal,
  LucideSparkles,
  LucideCompass
} from '@lucide/angular';
import { NgxGraphModule, Node, Edge, Layout } from '@swimlane/ngx-graph';
import { Subject } from 'rxjs';

export interface OrgNodeData {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  employeeCode?: string;
  phone?: string;
  workLocation?: string;
  designation?: { id?: number; name: string };
  department?: { id?: number; name: string };
  user?: { email?: string; role?: string; status?: string };
  managerId?: number;
  manager?: OrgNodeData;
  children: OrgNodeData[];
  isExpanded: boolean;
  level: number;
  totalSubordinates: number;
}

export interface DepartmentTheme {
  bg: string;
  text: string;
  border: string;
  accent: string;
  bar: string;
}

@Component({
  selector: 'app-org-chart',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    NgxGraphModule,
    LucideUser,
    LucideUsers,
    LucideChevronDown,
    LucideChevronUp,
    LucideChevronRight,
    LucideZoomIn,
    LucideZoomOut,
    LucideMaximize,
    LucideRotateCcw,
    LucideSearch,
    LucideBuilding,
    LucideBriefcase,
    LucideMail,
    LucidePhone,
    LucideMapPin,
    LucideCrown,
    LucideX,
    LucideExternalLink,
    LucideNetwork,
    LucideLayers,
    LucideSlidersHorizontal,
    LucideSparkles,
    LucideCompass
  ],
  templateUrl: './org-chart.html',
  styleUrls: ['./org-chart.css']
})
export class OrgChart implements OnInit {
  private http = inject(HttpClient);
  readonly Math = Math;

  isLoading = true;
  allEmployees: OrgNodeData[] = [];
  rootNodes: OrgNodeData[] = [];
  employeeMap = new Map<number, OrgNodeData>();

  // Graph Data
  nodes: Node[] = [];
  links: Edge[] = [];
  layout: string | Layout = 'dagre';
  orientation: 'LR' | 'TB' = 'TB';

  layoutSettings = {
    orientation: 'TB',
    rankPadding: 90,
    nodePadding: 45,
    edgePadding: 60
  };

  // Canvas zoom & pan
  zoomLevel: number = 1.0;
  zoomToFit$ = new Subject<any>();
  center$ = new Subject<boolean>();
  panToNode$ = new Subject<string>();

  // Search & Navigation
  searchQuery: string = '';
  searchResults: OrgNodeData[] = [];
  highlightedNodeId: string | null = null;
  selectedDepartment: string | null = null;

  // Employee Detail Drawer
  selectedEmployee: OrgNodeData | null = null;
  isDrawerOpen: boolean = false;

  // Metrics
  totalEmployees: number = 0;
  totalDepartments: number = 0;
  maxDepth: number = 0;
  rootCount: number = 0;
  uniqueDepartments: string[] = [];

  ngOnInit() {
    this.fetchOrgChart();
  }

  fetchOrgChart() {
    this.isLoading = true;
    this.http.get<any[]>(`${environment.apiUrl}/employees/org-chart`).subscribe({
      next: (data) => {
        this.buildTree(data || []);
        this.computeStats();
        this.updateGraph();
        this.isLoading = false;

        // Auto center on root node
        setTimeout(() => {
          this.centerRoot();
        }, 150);
      },
      error: (err) => {
        console.error('Failed to load org chart', err);
        this.isLoading = false;
      }
    });
  }

  buildTree(employees: any[]) {
    this.employeeMap.clear();
    const roots: OrgNodeData[] = [];

    // Step 1: Initialize all node objects
    employees.forEach((emp) => {
      const node: OrgNodeData = {
        ...emp,
        children: [],
        isExpanded: true,
        level: 0,
        totalSubordinates: 0
      };
      this.employeeMap.set(emp.id, node);
    });

    // Step 2: Establish parent-child and manager relationships
    employees.forEach((emp) => {
      const node = this.employeeMap.get(emp.id)!;
      if (emp.managerId && this.employeeMap.has(emp.managerId)) {
        const parent = this.employeeMap.get(emp.managerId)!;
        node.manager = parent;
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    });

    // Step 3: Compute levels and total subordinates recursively
    const assignHierarchyMeta = (node: OrgNodeData, currentLevel: number): number => {
      node.level = currentLevel;
      let count = 0;
      for (const child of node.children) {
        count += 1 + assignHierarchyMeta(child, currentLevel + 1);
      }
      node.totalSubordinates = count;
      return count;
    };

    roots.forEach((root) => assignHierarchyMeta(root, 0));

    this.rootNodes = roots;
    this.allEmployees = Array.from(this.employeeMap.values());
  }

  computeStats() {
    this.totalEmployees = this.allEmployees.length;
    this.rootCount = this.rootNodes.length;

    let maxLvl = 0;
    const depts = new Set<string>();

    this.allEmployees.forEach((emp) => {
      if (emp.level > maxLvl) maxLvl = emp.level;
      if (emp.department?.name) {
        depts.add(emp.department.name);
      }
    });

    this.maxDepth = this.totalEmployees > 0 ? maxLvl + 1 : 0;
    this.totalDepartments = depts.size;
    this.uniqueDepartments = Array.from(depts).sort();
  }

  updateGraph() {
    const newNodes: Node[] = [];
    const newLinks: Edge[] = [];

    const traverse = (node: OrgNodeData) => {
      newNodes.push({
        id: node.id.toString(),
        label: `${node.firstName} ${node.lastName}`,
        data: node
      });

      if (node.isExpanded && node.children.length > 0) {
        for (const child of node.children) {
          newLinks.push({
            id: `link-${node.id}-${child.id}`,
            source: node.id.toString(),
            target: child.id.toString()
          });
          traverse(child);
        }
      }
    };

    for (const root of this.rootNodes) {
      traverse(root);
    }

    this.nodes = [...newNodes];
    this.links = [...newLinks];
  }

  // Layout & Orientation Controls
  setOrientation(newOrientation: 'LR' | 'TB') {
    if (this.orientation === newOrientation) return;
    this.orientation = newOrientation;
    this.layoutSettings = {
      ...this.layoutSettings,
      orientation: newOrientation,
      rankPadding: newOrientation === 'TB' ? 90 : 80,
      nodePadding: newOrientation === 'TB' ? 45 : 35
    };
    this.updateGraph();
    setTimeout(() => {
      this.centerRoot();
    }, 100);
  }

  // Tree Expansion Controls
  toggleExpand(nodeData: OrgNodeData, event: Event) {
    if (event) {
      event.stopPropagation();
    }
    nodeData.isExpanded = !nodeData.isExpanded;
    this.updateGraph();
  }

  expandAll() {
    const expand = (node: OrgNodeData) => {
      node.isExpanded = true;
      node.children.forEach(expand);
    };
    this.rootNodes.forEach(expand);
    this.updateGraph();
  }

  collapseAll() {
    const collapse = (node: OrgNodeData) => {
      node.isExpanded = false;
      node.children.forEach(collapse);
    };
    this.rootNodes.forEach((root) => {
      root.isExpanded = false;
      root.children.forEach(collapse);
    });
    this.updateGraph();
  }

  // Search and Navigation
  onSearchInput(query: string) {
    this.searchQuery = query;
    const clean = query.trim().toLowerCase();
    if (!clean) {
      this.searchResults = [];
      return;
    }

    this.searchResults = this.allEmployees.filter((emp) => {
      const fullName = `${emp.firstName} ${emp.lastName}`.toLowerCase();
      const designation = emp.designation?.name?.toLowerCase() || '';
      const department = emp.department?.name?.toLowerCase() || '';
      const code = emp.employeeCode?.toLowerCase() || '';
      const email = emp.user?.email?.toLowerCase() || '';

      return (
        fullName.includes(clean) ||
        designation.includes(clean) ||
        department.includes(clean) ||
        code.includes(clean) ||
        email.includes(clean)
      );
    }).slice(0, 8);
  }

  selectAndFocusEmployee(employee: OrgNodeData) {
    // Expand all ancestors to make the target node visible in graph
    let current = employee.manager;
    let modified = false;
    while (current) {
      if (!current.isExpanded) {
        current.isExpanded = true;
        modified = true;
      }
      current = current.manager;
    }

    if (modified) {
      this.updateGraph();
    }

    // Clear search dropdown
    this.searchQuery = '';
    this.searchResults = [];

    // Trigger visual pulse highlight
    this.highlightedNodeId = employee.id.toString();

    // Smoothly pan camera to node
    setTimeout(() => {
      this.panToNode$.next(employee.id.toString());
    }, 60);

    // Open detail drawer
    this.openDrawer(employee);

    // Auto clear highlight after 4 seconds
    setTimeout(() => {
      if (this.highlightedNodeId === employee.id.toString()) {
        this.highlightedNodeId = null;
      }
    }, 4000);
  }

  // Filter department highlight
  toggleDepartmentFilter(deptName: string | null) {
    if (this.selectedDepartment === deptName) {
      this.selectedDepartment = null;
    } else {
      this.selectedDepartment = deptName;
    }
  }

  isNodeFiltered(nodeData: OrgNodeData): boolean {
    if (!this.selectedDepartment) return false;
    return nodeData.department?.name !== this.selectedDepartment;
  }

  // Drawer Controls
  openDrawer(employee: OrgNodeData, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    this.selectedEmployee = employee;
    this.isDrawerOpen = true;
  }

  closeDrawer() {
    this.isDrawerOpen = false;
  }

  jumpToEmployeeFromDrawer(targetEmployee: OrgNodeData) {
    this.selectAndFocusEmployee(targetEmployee);
  }

  // Zoom and Pan Controls
  zoomIn() {
    this.zoomLevel = Math.min(2.0, parseFloat((this.zoomLevel + 0.15).toFixed(2)));
  }

  zoomOut() {
    this.zoomLevel = Math.max(0.2, parseFloat((this.zoomLevel - 0.15).toFixed(2)));
  }

  resetZoom() {
    this.zoomLevel = 1.0;
    this.centerRoot();
  }

  fitToScreen() {
    this.zoomToFit$.next({});
  }

  centerRoot() {
    if (this.rootNodes.length > 0) {
      this.panToNode$.next(this.rootNodes[0].id.toString());
    } else {
      this.zoomToFit$.next({});
      this.center$.next(true);
    }
  }

  onZoomChange(level: number) {
    this.zoomLevel = parseFloat(level.toFixed(2));
  }

  // Department Theming
  getDepartmentTheme(deptName?: string): DepartmentTheme {
    if (!deptName) {
      return {
        bg: '#f8fafc',
        text: '#475569',
        border: '#e2e8f0',
        accent: '#64748b',
        bar: '#94a3b8'
      };
    }
    const lower = deptName.toLowerCase();
    if (lower.includes('tech') || lower.includes('eng') || lower.includes('dev') || lower.includes('soft') || lower.includes('it')) {
      return { bg: '#eef2ff', text: '#4338ca', border: '#c7d2fe', accent: '#6366f1', bar: '#4f46e5' };
    } else if (lower.includes('sales') || lower.includes('biz') || lower.includes('rev')) {
      return { bg: '#fff7ed', text: '#c2410c', border: '#ffedd5', accent: '#f97316', bar: '#ea580c' };
    } else if (lower.includes('hr') || lower.includes('peop') || lower.includes('talent') || lower.includes('rec')) {
      return { bg: '#fdf2f8', text: '#be185d', border: '#fce7f3', accent: '#ec4899', bar: '#db2777' };
    } else if (lower.includes('fin') || lower.includes('acc') || lower.includes('tax') || lower.includes('audit')) {
      return { bg: '#ecfdf5', text: '#047857', border: '#d1fae5', accent: '#10b981', bar: '#059669' };
    } else if (lower.includes('mark') || lower.includes('brand') || lower.includes('growth')) {
      return { bg: '#faf5ff', text: '#7e22ce', border: '#f3e8ff', accent: '#a855f7', bar: '#9333ea' };
    } else if (lower.includes('op') || lower.includes('log') || lower.includes('facil')) {
      return { bg: '#f0f9ff', text: '#0369a1', border: '#e0f2fe', accent: '#0ea5e9', bar: '#0284c7' };
    } else if (lower.includes('exec') || lower.includes('manage') || lower.includes('lead') || lower.includes('board')) {
      return { bg: '#f8fafc', text: '#0f172a', border: '#cbd5e1', accent: '#3b82f6', bar: '#1e3a8a' };
    } else if (lower.includes('legal') || lower.includes('comp')) {
      return { bg: '#fefce8', text: '#a16207', border: '#fef08a', accent: '#eab308', bar: '#ca8a04' };
    }
    return { bg: '#f1f5f9', text: '#334155', border: '#cbd5e1', accent: '#64748b', bar: '#64748b' };
  }

  getInitials(firstName: string, lastName: string): string {
    const f = firstName ? firstName.charAt(0).toUpperCase() : '';
    const l = lastName ? lastName.charAt(0).toUpperCase() : '';
    return f + l || 'NA';
  }
}
