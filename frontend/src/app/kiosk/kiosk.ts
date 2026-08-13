import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { HotToastService } from '@ngneat/hot-toast';

@Component({
  selector: 'app-kiosk',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './kiosk.html',
  styles: `
    :host {
      display: block;
      height: 100vh;
      width: 100vw;
      background: #0f172a;
      color: #fff;
      font-family: 'Inter', sans-serif;
    }
    .kiosk-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 24px;
    }
    .kiosk-header {
      text-align: center;
      margin-bottom: 40px;
    }
    .kiosk-header h1 {
      font-size: 2.5rem;
      font-weight: 700;
      margin: 0 0 8px 0;
      background: linear-gradient(135deg, #38bdf8, #818cf8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .kiosk-header p {
      color: #94a3b8;
      font-size: 1.125rem;
      margin: 0;
    }
    .pin-display {
      display: flex;
      gap: 16px;
      margin-bottom: 40px;
    }
    .pin-dot {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid #334155;
      transition: all 0.2s ease;
    }
    .pin-dot.filled {
      background: #38bdf8;
      border-color: #38bdf8;
      box-shadow: 0 0 12px rgba(56, 189, 248, 0.5);
    }
    .numpad {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 32px;
    }
    .numpad button {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      border: none;
      background: #1e293b;
      color: #f8fafc;
      font-size: 1.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .numpad button:hover {
      background: #334155;
      transform: scale(1.05);
    }
    .numpad button:active {
      background: #475569;
      transform: scale(0.95);
    }
    .numpad button.action {
      font-size: 1rem;
      background: rgba(239, 68, 68, 0.1);
      color: #ef4444;
    }
    .numpad button.action:hover {
      background: rgba(239, 68, 68, 0.2);
    }
    .actions {
      display: flex;
      gap: 16px;
      width: 100%;
      max-width: 320px;
    }
    .btn-clock {
      flex: 1;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 1.125rem;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .btn-clock:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-in {
      background: linear-gradient(135deg, #10b981, #059669);
    }
    .btn-in:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      transform: translateY(-2px);
    }
    .btn-out {
      background: linear-gradient(135deg, #f59e0b, #d97706);
    }
    .btn-out:hover:not(:disabled) {
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
      transform: translateY(-2px);
    }
  `
})
export class Kiosk implements OnInit {
  companyId = signal<number>(0);
  pin = signal<string>('');
  isProcessing = signal(false);

  // Device location (captured on load)
  currentLat = signal<number | null>(null);
  currentLng = signal<number | null>(null);

  // Time display
  currentTime = signal<Date>(new Date());

  constructor(
    private route: ActivatedRoute,
    private http: HttpClient,
    private toast: HotToastService
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      const id = params.get('companyId');
      if (id) {
        this.companyId.set(+id);
      }
    });

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.currentLat.set(position.coords.latitude);
          this.currentLng.set(position.coords.longitude);
        },
        () => {}
      );
    }

    setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);
  }

  appendPin(digit: number) {
    if (this.pin().length < 4) {
      this.pin.set(this.pin() + digit);
    }
  }

  clearPin() {
    this.pin.set('');
  }

  deleteLast() {
    this.pin.set(this.pin().slice(0, -1));
  }

  clockIn() {
    if (this.pin().length !== 4) return;
    this.isProcessing.set(true);
    
    this.http.post(`${environment.apiUrl}/kiosk/clock-in`, {
      pin: this.pin(),
      companyId: this.companyId(),
      lat: this.currentLat(),
      lng: this.currentLng()
    }).subscribe({
      next: (res: any) => {
        this.toast.success(res.message, { duration: 4000 });
        this.clearPin();
        this.isProcessing.set(false);
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to clock in');
        this.clearPin();
        this.isProcessing.set(false);
      }
    });
  }

  clockOut() {
    if (this.pin().length !== 4) return;
    this.isProcessing.set(true);

    this.http.post(`${environment.apiUrl}/kiosk/clock-out`, {
      pin: this.pin(),
      companyId: this.companyId(),
      lat: this.currentLat(),
      lng: this.currentLng()
    }).subscribe({
      next: (res: any) => {
        this.toast.success(res.message, { duration: 4000 });
        this.clearPin();
        this.isProcessing.set(false);
      },
      error: (err) => {
        this.toast.error(err.error?.message || 'Failed to clock out');
        this.clearPin();
        this.isProcessing.set(false);
      }
    });
  }
}
