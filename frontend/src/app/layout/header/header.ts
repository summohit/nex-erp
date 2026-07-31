import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.html',
  styleUrls: ['./header.css']
})
export class HeaderComponent implements OnInit {
  private router = inject(Router);
  pageTitle = signal<string>('Dashboard');

  ngOnInit() {
    this.updateTitle(this.router.url);
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe((event: any) => {
      this.updateTitle(event.urlAfterRedirects);
    });
  }

  private updateTitle(url: string) {
    if (url.includes('/payroll')) {
      this.pageTitle.set('Payroll & Compensation');
    } else if (url.includes('/employees/directory')) {
      this.pageTitle.set('Employee Directory');
    } else if (url.includes('/employees/onboarding')) {
      this.pageTitle.set('Onboarding');
    } else if (url.includes('/employees/') && url.includes('/profile')) {
      this.pageTitle.set('Employee Profile');
    } else if (url.includes('/attendance')) {
      this.pageTitle.set('Attendance & Leave Management');
    } else if (url.includes('/settings/master-data')) {
      this.pageTitle.set('Master Data Management');
    } else if (url.includes('/settings/company')) {
      this.pageTitle.set('Company Profile');
    } else if (url.includes('/appreciation')) {
      this.pageTitle.set('Appreciation & Awards');
    } else if (url.includes('/settings/permissions')) {
      this.pageTitle.set('Roles & Permissions');
    } else {
      this.pageTitle.set('Dashboard');
    }
  }
}
