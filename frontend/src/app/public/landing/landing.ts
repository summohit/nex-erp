import { Component, signal, AfterViewInit, OnDestroy, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { environment } from '../../../environments/environment';
import {
  LucideUsers,
  LucideCalendarClock,
  LucideBanknote,
  LucideBriefcase,
  LucideTrendingUp,
  LucideLayers,
  LucideLaptop,
  LucideAward,
  LucideSmartphone,
  LucideDownload,
  LucideCheck,
  LucideArrowRight,
  LucideShieldCheck,
  LucideMenu,
  LucideX,
  LucideMapPin,
  LucideBell,
  LucideFileText,
  LucideSparkles,
  LucideZap,
  LucideStar,
  LucideBuilding2,
  LucideCheckCircle2,
  LucideClock,
  LucideChevronDown,
  LucideChevronUp,
  LucideArrowUpRight,
  LucideBarChart3,
  LucidePieChart,
  LucideDollarSign,
  LucideHelpCircle,
  LucideFolderKanban,
  LucideEye,
  LucideUserPlus
} from '@lucide/angular';

interface FeatureCard {
  icon: string;
  badge?: string;
  title: string;
  description: string;
  points: string[];
  colorTheme: string;
}

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
  avatarBg: string;
  rating: number;
  highlight: string;
}

interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    LucideUsers,
    LucideCalendarClock,
    LucideBanknote,
    LucideBriefcase,
    LucideTrendingUp,
    LucideLayers,
    LucideLaptop,
    LucideAward,
    LucideSmartphone,
    LucideDownload,
    LucideCheck,
    LucideArrowRight,
    LucideShieldCheck,
    LucideMenu,
    LucideX,
    LucideMapPin,
    LucideBell,
    LucideFileText,
    LucideSparkles,
    LucideZap,
    LucideStar,
    LucideBuilding2,
    LucideCheckCircle2,
    LucideClock,
    LucideChevronDown,
    LucideChevronUp,
    LucideArrowUpRight,
    LucideBarChart3,
    LucidePieChart,
    LucideDollarSign,
    LucideHelpCircle,
    LucideFolderKanban,
    LucideEye,
    LucideUserPlus
  ],
  templateUrl: './landing.html',
  styleUrls: ['./landing.css']
})
export class LandingComponent implements AfterViewInit, OnDestroy {
  mobileNavOpen = signal(false);
  heroSelectedModule = signal<'crm' | 'attendance' | 'payroll' | 'recruitment' | 'projects'>('crm');
  activeModuleTab = signal<'crm' | 'attendance' | 'payroll' | 'recruitment' | 'projects'>('crm');
  activeFaq = signal<number | null>(0);
  billingCycle = signal<'monthly' | 'yearly'>('yearly');
  currentYear = new Date().getFullYear();

  // Android APK download link
  androidApkUrl = environment.androidApkUrl;

  // Populated from the backend's /app-download/android/info probe. Until that
  // resolves (or if no build has been published) the CTA stays in its
  // "Coming Soon" state, so the button can never point at a 404.
  androidBuild = signal<{ version: string | null; sizeBytes: number } | null>(null);

  private scrollObserver: IntersectionObserver | null = null;

  get hasAndroidBuild(): boolean {
    return this.androidBuild() !== null;
  }

  /** e.g. "v2.4.0 · 79 MB", or just the size when the sidecar has no version. */
  get androidBuildLabel(): string {
    const build = this.androidBuild();
    if (!build) return '';
    const mb = `${Math.round(build.sizeBytes / (1024 * 1024))} MB`;
    return build.version ? `v${build.version} · ${mb}` : mb;
  }

  constructor(private router: Router, private el: ElementRef) {}

  ngAfterViewInit() {
    this.initScrollAnimations();
    this.probeAndroidBuild();
  }

  ngOnDestroy() {
    if (this.scrollObserver) {
      this.scrollObserver.disconnect();
    }
  }

  /**
   * Ask the backend whether a signed build is actually on disk. A failure here
   * is not worth surfacing — the CTA simply stays in its "Coming Soon" state.
   */
  private async probeAndroidBuild() {
    if (!this.androidApkUrl || typeof fetch === 'undefined') return;
    try {
      const res = await fetch(`${this.androidApkUrl}/info`);
      if (!res.ok) return;
      const info = await res.json();
      if (info?.available) {
        this.androidBuild.set({
          version: info.version ?? null,
          sizeBytes: info.sizeBytes ?? 0,
        });
      }
    } catch {
      // Offline or backend down — leave the button in its placeholder state.
    }
  }

  private initScrollAnimations() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      return;
    }

    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
          }
        });
      },
      {
        threshold: 0.08,
        rootMargin: '0px 0px -40px 0px'
      }
    );

    const animatedElements = this.el.nativeElement.querySelectorAll(
      '.lp-section-head, .lp-stat-card, .lp-tour-container, .lp-module-card, .lp-why-card, .lp-faq-item, .lp-mobile-copy, .lp-phone, .lp-cta-inner'
    );

    animatedElements.forEach((el: HTMLElement) => {
      this.scrollObserver?.observe(el);
    });
  }

  selectHeroModule(mod: 'crm' | 'attendance' | 'payroll' | 'recruitment' | 'projects') {
    this.heroSelectedModule.set(mod);
  }

  toggleMobileNav() {
    this.mobileNavOpen.update(v => !v);
  }

  closeMobileNav() {
    this.mobileNavOpen.set(false);
  }

  goToLogin() {
    this.closeMobileNav();
    this.router.navigate(['/login']);
  }

  goToSignup() {
    this.closeMobileNav();
    this.router.navigate(['/signup']);
  }

  scrollTo(sectionId: string) {
    this.closeMobileNav();
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  setModuleTab(tab: 'crm' | 'attendance' | 'payroll' | 'recruitment' | 'projects') {
    this.activeModuleTab.set(tab);
  }

  toggleFaq(index: number) {
    if (this.activeFaq() === index) {
      this.activeFaq.set(null);
    } else {
      this.activeFaq.set(index);
    }
  }

  toggleBilling(cycle: 'monthly' | 'yearly') {
    this.billingCycle.set(cycle);
  }

  // Key platform stats
  stats = [
    { value: '12+', label: 'Integrated ERP Modules', desc: 'No more switching tabs' },
    { value: '₹45Cr+', label: 'Pipeline & Payroll Managed', desc: 'Processed securely' },
    { value: '99.98%', label: 'System Uptime & Live Sync', desc: 'Enterprise SLA backed' },
    { value: '15,000+', label: 'Active Daily Users', desc: 'Across fast-scaling orgs' }
  ];

  // Comprehensive Product Modules
  modules: FeatureCard[] = [
    {
      icon: 'crm',
      badge: 'Revenue Engine',
      colorTheme: 'orange',
      title: 'CRM & Sales Pipeline',
      description: 'Accelerate deal cycles with visual Kanban pipelines, automated follow-ups & custom quotation builders.',
      points: [
        'Interactive Drag-and-Drop Deal Board',
        'Auto Follow-up Reminders & Alerts',
        'One-Click PDF Quotation Generator',
        'Sales Rep Quotas & Win-Rate Analytics'
      ]
    },
    {
      icon: 'calendar',
      badge: 'Smart Tracking',
      colorTheme: 'purple',
      title: 'Biometric Attendance & Leave',
      description: 'Geofence mobile punches, kiosk camera check-ins, multi-shift rosters, and automated leave approvals.',
      points: [
        'Geofenced Mobile & Web Clock-In',
        'Tablet Kiosk Mode with Selfie Punch',
        'Dynamic Shift Rotations & Rosters',
        'Real-time Absenteeism & Overtime Sync'
      ]
    },
    {
      icon: 'payroll',
      badge: '100% Compliant',
      colorTheme: 'emerald',
      title: 'Automated Payroll & Expenses',
      description: 'Disburse salaries with 1 click. Zero spreadsheet formulas, zero calculation errors, instant payslips.',
      points: [
        'Auto LOP (Loss of Pay) Attendance Sync',
        'PF, ESI, TDS & Tax Deduction Engine',
        'One-Click Bulk Payslip Emailer',
        'Employee Expense Claims & Receipts'
      ]
    },
    {
      icon: 'recruitment',
      badge: 'Hire Faster',
      colorTheme: 'amber',
      title: 'Recruitment & ATS',
      description: 'End-to-end recruitment funnel from custom career portals to structured interviews and offer letters.',
      points: [
        'Custom Branded Public Careers Page',
        'Visual Candidate Stage Pipeline',
        'Interview Scorecards & Feedback',
        'Digital Offer Letter Dispatch'
      ]
    },
    {
      icon: 'users',
      badge: 'Core HRMS',
      colorTheme: 'blue',
      title: 'People & Employee Hub',
      description: 'Unified employee repository with digital documentation vault, org hierarchy, and seamless onboarding.',
      points: [
        '360° Employee Profiles & History',
        'Interactive Company Org Chart',
        'Digital Self-Service Onboarding',
        'Secure Cloud Document Storage'
      ]
    },
    {
      icon: 'projects',
      badge: 'Agile Delivery',
      colorTheme: 'indigo',
      title: 'Projects & Issue Tracking',
      description: 'Deliver projects on time with milestone tracking, standardized project codes, and client portals.',
      points: [
        'Sprint Task Boards & Milestones',
        'CES Standard Sequential Issue IDs',
        'Client Profiles & Billing Association',
        'Team Timesheets & Workload Balancing'
      ]
    },
    {
      icon: 'assets',
      badge: 'Inventory Control',
      colorTheme: 'teal',
      title: 'Assets & IT Inventory',
      description: 'Know who has what hardware, manage maintenance schedules, and monitor stock ledger in real time.',
      points: [
        'Hardware & Laptop Custody Tracking',
        'Maintenance & Repair Logs',
        'Vendor Warranties & Depreciations',
        'Instant Return & Handover Protocols'
      ]
    },
    {
      icon: 'performance',
      badge: 'People Growth',
      colorTheme: 'pink',
      title: 'Performance & Culture',
      description: 'Nurture high performers with transparent KPI reviews, peer appreciation badges, and award feeds.',
      points: [
        'Quarterly 360° Performance Reviews',
        'Public Appreciation & Kudos Feed',
        'Company Awards (Star, Trophy, Ribbon)',
        'Goal & KPI Target Measurement'
      ]
    }
  ];

  // Mobile App Highlights
  mobileFeatures = [
    { icon: 'calendar', label: 'Geofenced site clock in & out' },
    { icon: 'payroll', label: 'Instant encrypted payslip downloads' },
    { icon: 'mappin', label: 'GPS-tagged field client visits' },
    { icon: 'crm', label: 'Realtime CRM pipeline deal updates' },
    { icon: 'bell', label: 'Push alerts for approvals & announcements' },
    { icon: 'doc', label: '1-tap leave requests & expense claims' }
  ];

  // Testimonials
  testimonials: Testimonial[] = [
    {
      quote: 'Switching to NEX ERP eliminated 4 separate SaaS subscriptions and saved our HR team 18 hours per pay cycle. The attendance-to-payroll automation is flawless.',
      name: 'Rohan Deshmukh',
      role: 'Head of People Operations',
      company: 'Apex Logistics & Freight (450+ Staff)',
      avatarBg: '#ff5500',
      rating: 5,
      highlight: 'Saved 18 hrs/cycle on Payroll'
    },
    {
      quote: 'Our sales team actually uses the CRM because it is fast and simple. Our pipeline conversion rate grew by 32% within 3 months of adopting the follow-up reminder engine.',
      name: 'Ananya Sharma',
      role: 'VP of Global Sales',
      company: 'Zenith Tech Solutions',
      avatarBg: '#4f46e5',
      rating: 5,
      highlight: '+32% Deal Conversion Rate'
    },
    {
      quote: 'The mobile app is a game changer for our field engineers. They log site visits with GPS verification, and their attendance syncs straight into project cost sheets.',
      name: 'Vikramjit Singh',
      role: 'Chief Technology Officer',
      company: 'CES Engineering Infra',
      avatarBg: '#059669',
      rating: 5,
      highlight: '100% Realtime Field Visibility'
    }
  ];

  // FAQs
  faqs: FaqItem[] = [
    {
      question: 'How fast can our company migrate to NEX ERP?',
      answer: 'Most organizations are fully operational in under 48 hours. We provide bulk CSV import tools for employees, historical attendance, active CRM leads, and past payroll structures, plus guided onboarding.',
      category: 'Onboarding'
    },
    {
      question: 'How does the Biometric & Mobile Attendance integrate with Payroll?',
      answer: 'Attendance data (punches, shift calculations, approved leaves, and unauthorized absences) automatically computes Loss of Pay (LOP) and overtime multipliers directly into the salary calculation engine with zero manual export required.',
      category: 'Payroll & HR'
    },
    {
      question: 'Can we configure custom role-based permissions for different staff?',
      answer: 'Yes! NEX ERP features a granular role matrix. You can set permissions by role (Admin, HR Manager, Sales Rep, Team Lead, Employee) or per-module (View Only, Edit, Create, Delete, View All vs View Own).',
      category: 'Security & Access'
    },
    {
      question: 'Is our company, employee, and customer data secure?',
      answer: 'All data is stored in enterprise-grade cloud databases with 256-bit encryption in transit and at rest, automated daily backups, role-isolated tenant partitions, and complete audit logging.',
      category: 'Security'
    },
    {
      question: 'Does NEX ERP support multiple branches or project codes?',
      answer: 'Yes, NEX ERP supports multi-branch setups, multi-department rosters, and standardized sequential project issue codes (e.g. CES/0826/01) for precise cross-department tracking.',
      category: 'Architecture'
    }
  ];
}
