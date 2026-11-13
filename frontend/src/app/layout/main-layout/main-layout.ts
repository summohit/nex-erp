import { ProfileReminderComponent } from '../../shared/components/profile-reminder/profile-reminder';
import { ProfileModalComponent } from '../../shared/profile-modal/profile-modal';
import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { SelfOnboardingGateComponent } from '../../shared/components/self-onboarding-gate/self-onboarding-gate';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar';
import { SidebarComponentV2 } from '../sidebar/sidebar-v2';
import { HeaderComponent } from '../header/header';
import { HeaderComponentV2 } from '../header/header-v2';
import { isUiV2 } from '../../core/ui-version';
import { DialogHostComponent } from '../../shared/components/dialog-host/dialog-host.component';
import { NoticePopupComponent } from '../../shared/components/notice-popup/notice-popup';
import { ChatMessagePopupComponent } from '../../shared/components/chat-message-popup/chat-message-popup';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, SidebarComponentV2, HeaderComponent, HeaderComponentV2, DialogHostComponent, NoticePopupComponent, ProfileReminderComponent, ProfileModalComponent, ChatMessagePopupComponent, SelfOnboardingGateComponent],
  templateUrl: './main-layout.html',
  styleUrls: ['./main-layout.css']
})
export class MainLayoutComponent {
  /** New sidebar and header while UI v2 is switched on (?ui=v2). */
  readonly v2 = isUiV2();

  private auth = inject(AuthService);

  /**
   * A new joiner sees only the self-service onboarding screens until HR
   * approves their profile (13 Nov 2026). Everyone hired before has no status.
   */
  readonly onboardingGate = computed(() => {
    const u = this.auth.currentUser();
    if (!u) return false;
    return !!u.mustChangePassword
      || ['PENDING', 'SUBMITTED', 'CHANGES_REQUESTED'].includes(u.employee?.selfOnboardingStatus);
  });

  constructor() {
    if (!this.auth.currentUser()) this.auth.getMe().subscribe({ error: () => {} });
  }
}
