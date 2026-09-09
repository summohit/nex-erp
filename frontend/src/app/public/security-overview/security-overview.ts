import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-security-overview',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './security-overview.html',
  styleUrls: ['./security-overview.css']
})
export class SecurityOverviewComponent {
  currentDate = new Date();
}
