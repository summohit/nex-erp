import { ProfileReminderComponent } from '../../shared/components/profile-reminder/profile-reminder';
import { ProfileModalComponent } from '../../shared/profile-modal/profile-modal';
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { SidebarComponent } from '../sidebar/sidebar';
import { HeaderComponent } from '../header/header';
import { DialogHostComponent } from '../../shared/components/dialog-host/dialog-host.component';
import { NoticePopupComponent } from '../../shared/components/notice-popup/notice-popup';
import { ChatMessagePopupComponent } from '../../shared/components/chat-message-popup/chat-message-popup';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [CommonModule, RouterModule, SidebarComponent, HeaderComponent, DialogHostComponent, NoticePopupComponent, ProfileReminderComponent, ProfileModalComponent, ChatMessagePopupComponent],
  templateUrl: './main-layout.html',
  styleUrls: ['./main-layout.css']
})
export class MainLayoutComponent {}
