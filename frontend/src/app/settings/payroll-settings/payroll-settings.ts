import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { HotToastService } from '@ngneat/hot-toast';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-payroll-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './payroll-settings.html',
  styleUrls: ['./payroll-settings.css']
})
export class PayrollSettingsComponent implements OnInit {
  private http = inject(HttpClient);
  private toast = inject(HotToastService);

  isLoading = true;
  isSaving = false;

  settings = {
    basicPercent: 50.0,
    hraPercent: 20.0,
    pfPercent: 12.0,
    gratuityPercent: 4.81
  };

  ngOnInit() {
    this.loadSettings();
  }

  loadSettings() {
    this.isLoading = true;
    this.http.get<any>(`${environment.apiUrl}/payroll-settings`).subscribe({
      next: (res) => {
        if (res) {
          this.settings.basicPercent = res.basicPercent;
          this.settings.hraPercent = res.hraPercent;
          this.settings.pfPercent = res.pfPercent;
          this.settings.gratuityPercent = res.gratuityPercent;
        }
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Failed to load payroll settings', err);
        this.toast.error('Failed to load payroll settings');
        this.isLoading = false;
      }
    });
  }

  saveSettings() {
    this.isSaving = true;
    this.http.put(`${environment.apiUrl}/payroll-settings`, this.settings).subscribe({
      next: () => {
        this.toast.success('Payroll settings updated successfully');
        this.isSaving = false;
      },
      error: (err) => {
        console.error('Failed to update payroll settings', err);
        this.toast.error('Failed to update payroll settings');
        this.isSaving = false;
      }
    });
  }
}
