import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucideUser, LucideChevronDown, LucideChevronUp, LucideZoomIn, LucideZoomOut, LucideMaximize } from '@lucide/angular';
import { NgxGraphModule, Node, Edge, Layout } from '@swimlane/ngx-graph';
import { Subject } from 'rxjs';

interface OrgNodeData {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  designation?: { name: string };
  department?: { name: string };
  managerId?: number;
  children: OrgNodeData[];
  isExpanded: boolean;
}

@Component({
  selector: 'app-org-chart',
  standalone: true,
  imports: [CommonModule, NgxGraphModule, LucideUser, LucideChevronDown, LucideChevronUp, LucideZoomIn, LucideZoomOut, LucideMaximize],
  templateUrl: './org-chart.html',
  styleUrls: ['./org-chart.css']
})
export class OrgChart implements OnInit {
  private http = inject(HttpClient);
  
  readonly UserIcon = LucideUser;
  readonly ChevronDownIcon = LucideChevronDown;
  readonly ChevronUpIcon = LucideChevronUp;

  isLoading = true;
  rootNodes: OrgNodeData[] = [];

  // ngx-graph data
  nodes: Node[] = [];
  links: Edge[] = [];
  layout: string | Layout = 'dagre';
  
  // DAG configuration
  layoutSettings = {
    orientation: 'TB',
    rankPadding: 100,
    nodePadding: 40,
    edgePadding: 100
  };

  // Zoom and Pan Controls
  zoomLevel: number = 1.0;
  zoomToFit$ = new Subject<any>();
  center$ = new Subject<boolean>();
  panToNode$ = new Subject<string>();

  zoomIn() {
    this.zoomLevel = Math.min(2.0, this.zoomLevel + 0.2);
  }

  zoomOut() {
    this.zoomLevel = Math.max(0.1, this.zoomLevel - 0.2);
  }

  centerGraph() {
    if (this.rootNodes.length > 0) {
      this.panToNode$.next(this.rootNodes[0].id.toString());
    } else {
      this.zoomToFit$.next({});
      this.center$.next(true);
    }
  }

  onZoomChange(level: number) {
    this.zoomLevel = level;
  }

  ngOnInit() {
    this.fetchOrgChart();
  }

  fetchOrgChart() {
    this.isLoading = true;
    this.http.get<any[]>(`${environment.apiUrl}/employees/org-chart`).subscribe({
      next: (data) => {
        this.rootNodes = this.buildTree(data);
        this.updateGraph();
        this.isLoading = false;
        
        // Pan to CEO on load
        setTimeout(() => {
          if (this.rootNodes.length > 0) {
            this.panToNode$.next(this.rootNodes[0].id.toString());
          }
        }, 100);
      },
      error: (err) => {
        console.error('Failed to load org chart', err);
        this.isLoading = false;
      }
    });
  }

  buildTree(employees: any[]): OrgNodeData[] {
    const map = new Map<number, OrgNodeData>();
    const roots: OrgNodeData[] = [];

    employees.forEach(emp => {
      map.set(emp.id, {
        ...emp,
        children: [],
        isExpanded: true // Start fully expanded by default
      });
    });

    employees.forEach(emp => {
      const node = map.get(emp.id);
      if (emp.managerId && map.has(emp.managerId)) {
        map.get(emp.managerId)!.children.push(node!);
      } else {
        roots.push(node!);
      }
    });

    return roots;
  }

  updateGraph() {
    const newNodes: Node[] = [];
    const newLinks: Edge[] = [];

    // Recursively walk tree and populate active nodes and links
    const traverse = (node: OrgNodeData) => {
      newNodes.push({
        id: node.id.toString(),
        label: `${node.firstName} ${node.lastName}`,
        data: node // Keep full employee data
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

    this.nodes = newNodes;
    this.links = newLinks;
  }

  toggleExpand(nodeData: OrgNodeData, event: Event) {
    if (event) {
      event.stopPropagation();
    }
    nodeData.isExpanded = !nodeData.isExpanded;
    
    // Re-calculate visible nodes and links to trigger graph update
    // We clone the arrays so ngx-graph detects change via reference check
    this.updateGraph();
    this.nodes = [...this.nodes];
    this.links = [...this.links];
  }
}
