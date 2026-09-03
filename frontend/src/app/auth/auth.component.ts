import { Component, inject, ChangeDetectorRef, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { 
  LucideEye, 
  LucideEyeOff, 
  LucideMail, 
  LucideLock, 
  LucideArrowRight, 
  LucideShieldCheck, 
  LucideSparkles,
  LucideUser,
  LucidePhone,
  LucideBriefcase,
  LucideCheckCircle2,
  LucideTrendingUp
} from '@lucide/angular';
import { HotToastService } from '@ngneat/hot-toast';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-auth',
  standalone: true,
  imports: [
    CommonModule, 
    ReactiveFormsModule, 
    RouterLink, 
    LucideEye, 
    LucideEyeOff,
    LucideMail,
    LucideLock,
    LucideArrowRight,
    LucideShieldCheck,
    LucideSparkles,
    LucideUser,
    LucidePhone,
    LucideBriefcase,
    LucideCheckCircle2,
    LucideTrendingUp
  ],
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.css']
})
export class AuthComponent implements OnInit {
  currentView: 'login' | 'register' = 'login';

  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private toast = inject(HotToastService);
  private cdr = inject(ChangeDetectorRef);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  registerForm: FormGroup;
  loginForm: FormGroup;

  isSubmitting = signal(false);
  apiError = '';
  showPassword = false;

  constructor() {
    this.registerForm = this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      email: ['', [Validators.required, Validators.email]],
      companyName: ['', Validators.required],
      phone: [''],
      password: ['', [Validators.required, Validators.minLength(8)]],
      terms: [false, Validators.requiredTrue]
    });

    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      rememberMe: [true]
    });
  }

  ngOnInit() {
    // /login and /signup render this same component; the route decides which view.
    this.route.data.subscribe(data => {
      this.currentView = data['view'] === 'register' ? 'register' : 'login';
      this.apiError = '';
      this.showPassword = false;
      this.registerForm.reset();
      this.loginForm.reset();
    });
  }

  // Navigate rather than flip a flag, so the URL always reflects the visible view
  // (and browser back/forward behaves sensibly). ngOnInit's data subscription
  // handles the actual view swap and form reset.
  toggleView() {
    this.router.navigate([this.currentView === 'login' ? '/signup' : '/login']);
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  goToForgotPassword() {
    this.router.navigate(['/auth/forgot-password']);
  }

  onRegister() {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.apiError = '';

    this.authService.signup(this.registerForm.value).subscribe({
      next: (res) => {
        this.isSubmitting.set(false);
        this.toast.success(res.message || 'Registration successful! Please check your email.');
        sessionStorage.setItem('pendingVerificationEmail', this.registerForm.value.email);
        this.router.navigate(['/auth/check-email']);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.toast.error(err.error?.message || 'Registration failed. Please try again.');
      }
    });
  }

  onLogin() {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.apiError = '';

    const { email, password } = this.loginForm.value;
    this.authService.login({ email, password }).subscribe({
      next: (res) => {
        this.toast.success('Login successful! Loading workspace...');
        
        // Fetch user to check onboarding status
        this.authService.getMe().subscribe({
          next: (user) => {
            this.isSubmitting.set(false);
            if (user.company?.onboardingCompleted) {
              this.router.navigate(['/dashboard']);
            } else {
              this.router.navigate(['/onboarding']);
            }
          },
          error: () => {
            this.isSubmitting.set(false);
            this.router.navigate(['/dashboard']); // Fallback
          }
        });
      },
      error: (err) => {
        this.isSubmitting.set(false);
        const errorMsg = err.error?.message;
        if (errorMsg === 'Please verify your email address before logging in.') {
          sessionStorage.setItem('pendingVerificationEmail', this.loginForm.value.email);
          this.router.navigate(['/auth/check-email']);
          this.toast.error('Please verify your email to continue.');
        } else {
          this.toast.error(errorMsg || 'Invalid credentials.');
        }
      }
    });
  }
}
