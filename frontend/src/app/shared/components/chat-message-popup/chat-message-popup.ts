import { Component, DestroyRef, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HotToastService } from '@ngneat/hot-toast';
import { LucideMessageCircle, LucideSend, LucideX, LucideExternalLink } from '@lucide/angular';
import { environment } from '../../../../environments/environment';
import { NotificationsService } from '../../../services/notifications.service';
import { PermissionsService } from '../../../services/permissions.service';

interface ChatCard { id: number; visitorName: string; text: string; at: string; source: string; reply: string; sending: boolean }

/** Show at most this many cards; the rest collapse into "+N more". */
const MAX_CARDS = 3;
/** A conversation seen for the first time only pops up for a message this fresh. */
const FRESH_MS = 2 * 60 * 1000;

/**
 * Website Chat new-message popup (22 Oct 2026), on every page for people with
 * Website Chat Inbox access. Each visitor message brings up a card for its
 * conversation, where the agent can reply on the spot or open the chat in the
 * Inbox. Not shown on the Website Chat screens themselves.
 */
@Component({
  selector: 'app-chat-message-popup',
  standalone: true,
  imports: [CommonModule, FormsModule, LucideMessageCircle, LucideSend, LucideX, LucideExternalLink],
  templateUrl: './chat-message-popup.html',
  styleUrls: ['./chat-message-popup.css'],
})
export class ChatMessagePopupComponent {
  private http = inject(HttpClient);
  private router = inject(Router);
  private toast = inject(HotToastService);
  private notifications = inject(NotificationsService);
  private destroyRef = inject(DestroyRef);
  private api = `${environment.apiUrl}/chat`;
  /** Newest visitor message id already shown, per conversation. */
  private seen = new Map<number, number>();

  cards = signal<ChatCard[]>([]);
  readonly max = MAX_CARDS;

  constructor() {
    // Opening Website Chat clears the cards: the Inbox shows these chats itself.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this.onChatScreen()) this.cards.set([]);
    });
    inject(PermissionsService).getWebsiteChatTabs().subscribe((tabs) => {
      if (!tabs.includes('website-chat/inbox')) return;
      this.notifications.websiteChat.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((e) => {
        if (e.kind === 'message') this.check(e.conversationId);
      });
    });
  }

  /** On a Website Chat screen, where the Inbox already shows new messages. */
  private onChatScreen(): boolean {
    return this.router.url.startsWith('/website-chat');
  }

  private check(id: number) {
    if (this.onChatScreen()) return;
    this.http.get<any>(`${this.api}/inbox/${id}/latest`).subscribe({
      next: (r) => {
        const m = r?.message;
        if (!m) return;
        const prev = this.seen.get(id);
        if (prev !== undefined ? m.id <= prev : Date.now() - new Date(m.createdAt).getTime() > FRESH_MS) {
          this.seen.set(id, Math.max(prev ?? 0, m.id));
          return;
        }
        this.seen.set(id, m.id);
        const old = this.cards().find((c) => c.id === id);
        const card: ChatCard = {
          id, visitorName: r.visitorName || 'Visitor', text: m.message, at: m.createdAt,
          source: r.source === 'CAREERS' ? 'Careers' : 'Website', reply: old?.reply ?? '', sending: false,
        };
        this.cards.set([card, ...this.cards().filter((c) => c.id !== id)]);
      },
      error: () => {},
    });
  }

  dismiss(id: number) { this.cards.set(this.cards().filter((c) => c.id !== id)); }

  open(id: number) {
    this.dismiss(id);
    this.router.navigate(['/website-chat/inbox'], { queryParams: { c: id } });
  }

  openInbox() {
    this.cards.set([]);
    this.router.navigate(['/website-chat/inbox']);
  }

  send(card: ChatCard) {
    const message = card.reply.trim();
    if (!message || card.sending) return;
    card.sending = true;
    this.http.post(`${this.api}/inbox/${card.id}/reply`, { message }).subscribe({
      next: () => { this.toast.success(`Replied to ${card.visitorName}`); this.dismiss(card.id); },
      error: (e) => { card.sending = false; this.toast.error(e.error?.message || 'Could not send the reply'); },
    });
  }
}
