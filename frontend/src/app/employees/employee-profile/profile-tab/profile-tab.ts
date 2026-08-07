import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideEye, LucideEyeOff, LucideShuffle } from '@lucide/angular';
import { EmployeeService } from '../../../services/employee.service';
import { HotToastService } from '@ngneat/hot-toast';
import { Country, State, City } from 'country-state-city';

@Component({
  selector: 'app-profile-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideEye, LucideEyeOff, LucideShuffle],
  templateUrl: './profile-tab.html',
  styleUrls: ['./profile-tab.css']
})
export class ProfileTabComponent implements OnInit {
  @Input() employeeData: any;
  @Input() isOwner: boolean = false;
  @Output() refreshProfile = new EventEmitter<void>();

  formData: any = {};
  showPassword = false;

  countries = Country.getAllCountries();
  states: any[] = [];
  cities: any[] = [];

  constructor(private employeeService: EmployeeService, private toast: HotToastService, private router: Router) {}

  ngOnInit() {
    this.initForm();
  }

  initForm() {
    if (this.employeeData) {
      this.formData = {
        salutation: this.employeeData.salutation || 'Mr',
        firstName: this.employeeData.firstName,
        lastName: this.employeeData.lastName,
        email: this.employeeData.user?.email,
        password: '',
        country: this.employeeData.country || '',
        state: this.employeeData.state || '',
        city: this.employeeData.city || '',
        phone: this.employeeData.phone || '',
        language: this.employeeData.language || 'English',
        gender: this.employeeData.gender || 'Male',
        dateOfBirth: this.employeeData.dateOfBirth ? new Date(this.employeeData.dateOfBirth).toISOString().split('T')[0] : '',
        slackId: this.employeeData.slackId || '',
        maritalStatus: this.employeeData.maritalStatus || 'Single',
        address: this.employeeData.address || '',
        about: this.employeeData.about || '',
        avatarUrl: this.employeeData.avatarUrl || ''
      };
      
      this.onCountryChange(false);
      this.onStateChange(false);
    }
  }

  onCountryChange(resetChildren: boolean = true) {
    if (this.formData.country) {
      this.states = State.getStatesOfCountry(this.formData.country);
      if (resetChildren) {
        this.formData.state = '';
        this.cities = [];
        this.formData.city = '';
      } else {
        if (!this.states.find(s => s.isoCode === this.formData.state)) {
          this.formData.state = '';
        }
      }
    } else {
      this.states = [];
      this.formData.state = '';
      this.cities = [];
      this.formData.city = '';
    }
  }

  onStateChange(resetChildren: boolean = true) {
    if (this.formData.country && this.formData.state) {
      this.cities = City.getCitiesOfState(this.formData.country, this.formData.state);
      if (resetChildren) {
        this.formData.city = '';
      } else {
        if (!this.cities.find(c => c.name === this.formData.city)) {
          this.formData.city = '';
        }
      }
    } else {
      this.cities = [];
      this.formData.city = '';
    }
  }

  togglePassword() {
    this.showPassword = !this.showPassword;
  }

  generatePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()';
    let pass = '';
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    this.formData.password = pass;
  }

  handleAvatarUpload(event: any) {
    if (!this.isOwner) return;
    const file = event.target.files[0];
    if (file) {
      // In a real app we would upload the file to a server here.
      // For demo, we use a local URL or base64.
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.formData.avatarUrl = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  saveProfile() {
    if (!this.isOwner) return;
    
    // Validate phone number
    if (this.formData.phone) {
      const phoneRegex = /^\+?[0-9]{10,15}$/;
      if (!phoneRegex.test(this.formData.phone)) {
        this.toast.error('Invalid Mobile number. Must be 10-15 digits.');
        return;
      }
    }

    // Construct payload
    const payload = {
      ...this.formData
    };

    if (!payload.password) {
      delete payload.password;
    }
    
    // Email is tied to User, typically we don't update it from profile or we need backend support.
    // We'll skip sending email to avoid backend errors unless backend supports it.

    this.employeeService.updateProfile(this.employeeData.id, payload).subscribe({
      next: () => {
        this.toast.success('Profile updated successfully');
        this.refreshProfile.emit();
      },
      error: (err: any) => {
        this.toast.error('Failed to update profile');
        console.error(err);
      }
    });
  }

  goBack() {
    const token = localStorage.getItem('access_token');
    let role = '';
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        role = payload.role;
      } catch (e) {}
    }
    
    if (role === 'ADMIN' || role === 'HR') {
      this.router.navigate(['/employees']);
    } else {
      this.router.navigate(['/dashboard']);
    }
  }
}
