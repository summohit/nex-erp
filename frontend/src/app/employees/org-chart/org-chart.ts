import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { LucideUser, LucideMoreHorizontal, LucideChevronDown, LucideChevronUp } from '@lucide/angular';

interface OrgNode {
  id: number;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  designation?: { name: string };
  department?: { name: string };
  managerId?: number;
  children: OrgNode[];
  isExpanded: boolean;
}

@Component({
  selector: 'app-org-chart',
  standalone: true,
  imports: [CommonModule, LucideUser, LucideMoreHorizontal, LucideChevronDown, LucideChevronUp],
  templateUrl: './org-chart.html',
  styleUrls: ['./org-chart.css']
})
export class OrgChart implements OnInit {
  private http = inject(HttpClient);
  
  readonly UserIcon = LucideUser;
  readonly MoreIcon = LucideMoreHorizontal;
  readonly ChevronDownIcon = LucideChevronDown;
  readonly ChevronUpIcon = LucideChevronUp;

  isLoading = true;
  rootNodes: OrgNode[] = [];

  ngOnInit() {
    this.fetchOrgChart();
  }

  fetchOrgChart() {
    this.isLoading = true;
    this.http.get<any[]>(`${environment.apiUrl}/employees/org-chart`).subscribe({
      next: (data) => {
        this.rootNodes = this.buildTree(data);
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Failed to load org chart', err);
        this.isLoading = false;
      }
    });
  }

  buildTree(employees: any[]): OrgNode[] {
    const map = new Map<number, OrgNode>();
    const roots: OrgNode[] = [];

    employees.forEach(emp => {
      map.set(emp.id, {
        ...emp,
        children: [],
        isExpanded: true
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

  toggleExpand(node: OrgNode, event: Event) {
    event.stopPropagation();
    node.isExpanded = !node.isExpanded;
  }
}
