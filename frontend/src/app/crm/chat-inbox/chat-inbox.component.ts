import { Component, OnDestroy, OnInit, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml, Title } from '@angular/platform-browser';
import { HotToastService } from '@ngneat/hot-toast';
import { environment } from '../../../environments/environment';
import { PermissionsService } from '../../services/permissions.service';
import {
  LucideMessageCircle, LucideSearch, LucidePlus, LucideTrash2, LucideSave, LucideCopy,
  LucideEdit2, LucideFileText, LucideChevronLeft, LucideExternalLink,
  LucideSparkles, LucideGlobe, LucideCode, LucideCheck, LucideUpload, LucideCamera,
  LucideFolder, LucideFolderPlus, LucideBookOpen, LucideEye, LucideEyeOff,
  LucideThumbsUp, LucideThumbsDown, LucideTag, LucideBold, LucideItalic,
  LucideList, LucideLink, LucideX, LucideLayers, LucideCheckCircle2, LucideClock,
  LucideSend, LucideUser, LucideMail, LucidePhone, LucideBriefcase, LucideRotateCcw,
  LucideZap, LucideCheckCheck, LucideBot, LucideRefreshCw, LucideFilter, LucideVolume2, LucideVolumeX, LucidePaperclip,
  LucidePalette, LucidePipette
} from '@lucide/angular';

type Tab = 'inbox' | 'kb' | 'widgets';

@Component({
  selector: 'app-chat-inbox',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    LucideMessageCircle, LucideSearch, LucidePlus, LucideTrash2, LucideSave, LucideCopy,
    LucideEdit2, LucideFileText, LucideChevronLeft, LucideExternalLink,
    LucideSparkles, LucideGlobe, LucideCode, LucideCheck, LucideUpload, LucideCamera,
    LucideFolder, LucideFolderPlus, LucideBookOpen, LucideEye, LucideEyeOff,
    LucideThumbsUp, LucideThumbsDown, LucideTag, LucideBold, LucideItalic,
    LucideList, LucideLink, LucideX, LucideLayers, LucideCheckCircle2, LucideClock,
    LucideSend, LucideUser, LucideMail, LucidePhone, LucideBriefcase, LucideRotateCcw,
    LucideZap, LucideCheckCheck, LucideBot, LucideRefreshCw, LucideFilter, LucideVolume2, LucideVolumeX, LucidePaperclip,
  LucidePalette, LucidePipette
  ],
  templateUrl: './chat-inbox.html',
  styleUrls: ['./chat-inbox.css'],
})
export class ChatInboxComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toast = inject(HotToastService);
  private permissions = inject(PermissionsService);
  private sanitizer = inject(DomSanitizer);
  private titleService = inject(Title);
  private baseTitle = '';
  private api = `${environment.apiUrl}/chat`;

  @ViewChild('thread') threadEl?: ElementRef<HTMLDivElement>;

  tab: Tab = 'inbox';
  /** Tabs this user was granted; the others are hidden. */
  allowedTabs = new Set<Tab>();

  // ─── Inbox ───
  statusFilter = 'ACTIVE';
  activeQuickFilter: 'ALL' | 'ACTIVE' | 'OPEN' | 'BOT' | 'RESOLVED' = 'ACTIVE';
  mineOnly = false;
  searchTerm = '';
  conversations: any[] = [];
  inboxLoading = false;
  selectedId: number | null = null;
  selected: any = null;
  messages: any[] = [];
  reply = '';
  sending = false;
  typewriterEnabled = true;
  typewriterActiveMessageId: number | null = null;
  typewriterRenderedText: { [id: number]: string } = {};
  private typewriterTimer: any = null;
  private pollTimer: any = null;
  soundEnabled = true;
  private audioCtx: AudioContext | null = null;
  /** Newest visitor message time seen — null until the first inbox load seeds it. */
  private latestVisitorAt: number | null = null;
  /** Rows that just got a visitor message — briefly highlighted. */
  flashIds = new Set<number>();
  private rowLastAt = new Map<number, number>();
  threadLoading = false;
  readonly skeletonRows = [1, 2, 3, 4, 5];
  private readonly reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  cannedReplies = [
    'Thanks for reaching out! Let me check that for you.',
    'Could you share your email or phone number so we can follow up?',
    'You can apply directly to any open role on our careers page.',
    'Our team will get back to you within one business day.',
  ];

  // ─── Knowledge base ───
  categories: any[] = [];
  articles: any[] = [];
  kbCategoryFilter: number | null = null;
  kbSearch = '';
  editingArticle: any = null;
  editingCategory: any = null;
  kbSaving = false;

  // ─── Widgets ───
  widgets: any[] = [];
  editingWidget: any = null;
  widgetSaving = false;

  ngOnInit() {
    // Each tab is its own route (sidebar: Website Chat → Inbox / Knowledge
    // Base / Widgets), so switching tabs creates a fresh component.
    const routeTab = this.route.snapshot.data['tab'];
    this.tab = routeTab === 'knowledge-base' ? 'kb' : routeTab === 'widgets' ? 'widgets' : 'inbox';
    const c = Number(this.route.snapshot.queryParamMap.get('c'));
    if (c) {
      this.statusFilter = '';
      this.open(c);
    }
    this.permissions.getWebsiteChatTabs().subscribe(tabs => {
      this.allowedTabs = new Set(tabs.map(t => (t === 'website-chat/knowledge-base' ? 'kb' : t.replace('website-chat/', '')) as Tab));
    });
    try { this.soundEnabled = localStorage.getItem('chatInboxSound') !== 'off'; } catch { /* storage blocked */ }
    this.load(this.tab);
    this.schedulePoll();
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    try { localStorage.setItem('chatInboxSound', this.soundEnabled ? 'on' : 'off'); } catch { /* storage blocked */ }
    if (this.soundEnabled) this.playChime();
  }

  /** Two-note chime from Web Audio — no asset to ship. Browsers allow it after the first click on the page. */
  private playChime() {
    if (!this.soundEnabled) return;
    try {
      this.audioCtx ??= new AudioContext();
      const ctx = this.audioCtx;
      if (ctx.state === 'suspended') ctx.resume();
      [880, 1320].forEach((freq, i) => {
        const t = ctx.currentTime + i * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.26);
      });
    } catch { /* no audio support */ }
  }

  /** Chime when a visitor message is newer than anything seen so far (filter switches don't re-chime old chats). */
  private checkNewVisitorMessages(rows: any[]) {
    let latest = 0;
    for (const c of rows) {
      if (c.lastMessage?.senderType !== 'VISITOR') continue;
      latest = Math.max(latest, new Date(c.lastMessage.createdAt).getTime());
    }
    if (this.latestVisitorAt !== null && latest > this.latestVisitorAt) this.playChime();
    this.latestVisitorAt = Math.max(this.latestVisitorAt ?? 0, latest);
    this.flashUpdatedRows(rows);
  }

  /** Highlight rows whose newest message is a visitor's and newer than the last poll showed. */
  private flashUpdatedRows(rows: any[]) {
    const firstLoad = this.rowLastAt.size === 0;
    for (const c of rows) {
      const at = c.lastMessage ? new Date(c.lastMessage.createdAt).getTime() : 0;
      const before = this.rowLastAt.get(c.id);
      this.rowLastAt.set(c.id, at);
      if (firstLoad || c.lastMessage?.senderType !== 'VISITOR' || (before !== undefined && at <= before)) continue;
      if (before === undefined && at < Date.now() - 60_000) continue; // an old chat just entering the filter
      this.flashIds.add(c.id);
      setTimeout(() => this.flashIds.delete(c.id), 2600);
    }
  }

  trackById(_: number, c: any) {
    return c.id;
  }

  /** Resolved/closed chats can't be replied to — the visitor's widget has stopped listening. */
  get chatEnded(): boolean {
    return !!this.selected && (this.selected.status === 'RESOLVED' || this.selected.status === 'CLOSED');
  }

  /** The visitor pressed End Chat (and hasn't written since) — only they can restart it. */
  get visitorEnded(): boolean {
    if (!this.chatEnded) return false;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.senderType === 'VISITOR') return false;
      if (m.senderType === 'SYSTEM') return m.message === 'The visitor ended the conversation.';
    }
    return false;
  }

  ngOnDestroy() {
    clearTimeout(this.pollTimer);
    if (this.baseTitle) this.titleService.setTitle(this.baseTitle);
  }

  /** "(3) New chat · MIRA" while visitor messages wait unread, so a background tab still shows them. */
  private updateTabTitle() {
    if (!this.baseTitle) this.baseTitle = this.titleService.getTitle();
    const unread = this.conversations.reduce((n, c) => n + (c.unread || 0), 0);
    this.titleService.setTitle(unread ? `(${unread}) New chat · ${this.baseTitle}` : this.baseTitle);
  }

  setTab(t: Tab) {
    if (t === this.tab) return;
    this.router.navigate(['/website-chat', t === 'kb' ? 'knowledge-base' : t]);
  }

  private load(t: Tab) {
    if (t === 'inbox') this.loadInbox();
    if (t === 'kb') { this.loadCategories(); this.loadArticles(); }
    if (t === 'widgets') this.loadWidgets();
  }

  // ═══ Inbox ═══

  get filteredConversations(): any[] {
    const q = this.searchTerm.trim().toLowerCase();
    if (!q) return this.conversations;
    return this.conversations.filter(c =>
      (c.visitorName && c.visitorName.toLowerCase().includes(q)) ||
      (c.visitorEmail && c.visitorEmail.toLowerCase().includes(q)) ||
      (c.visitorPhone && c.visitorPhone.includes(q)) ||
      (c.lastMessage?.message && c.lastMessage.message.toLowerCase().includes(q)) ||
      (c.source && c.source.toLowerCase().includes(q)) ||
      (c.widgetConfig?.name && c.widgetConfig.name.toLowerCase().includes(q))
    );
  }

  get activeCount(): number {
    return this.conversations.filter(c => c.status === 'BOT' || c.status === 'OPEN').length;
  }

  get waitingCount(): number {
    return this.conversations.filter(c => c.status === 'OPEN').length;
  }

  get botCount(): number {
    return this.conversations.filter(c => c.status === 'BOT').length;
  }

  get resolvedCount(): number {
    return this.conversations.filter(c => c.status === 'RESOLVED' || c.status === 'CLOSED').length;
  }

  setQuickFilter(f: 'ALL' | 'ACTIVE' | 'OPEN' | 'BOT' | 'RESOLVED') {
    this.activeQuickFilter = f;
    this.statusFilter = f === 'ALL' ? '' : f;
    this.loadInbox();
  }

  toggleMineOnly() {
    this.mineOnly = !this.mineOnly;
    this.loadInbox();
  }

  loadInbox(silent = false) {
    if (!silent) this.inboxLoading = true;
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.mineOnly) params.mine = '1';
    this.http.get<any[]>(`${this.api}/inbox`, { params }).subscribe({
      next: (rows) => {
        this.conversations = rows;
        this.inboxLoading = false;
        this.checkNewVisitorMessages(rows);
        this.updateTabTitle();
        // Auto-select first conversation on initial load on desktop screens
        if (!this.selectedId && rows.length && window.innerWidth > 860) {
          this.open(rows[0].id);
        }
      },
      error: () => { this.inboxLoading = false; if (!silent) this.toast.error('Failed to load chats.'); },
    });
  }

  openFirstConversation() {
    if (this.filteredConversations.length) {
      this.open(this.filteredConversations[0].id);
    } else if (this.conversations.length) {
      this.open(this.conversations[0].id);
    }
  }

  open(id: number) {
    if (id !== this.selected?.id) {
      // Skeleton instead of the previous chat's messages while this one loads.
      this.threadLoading = true;
      this.messages = [];
    }
    this.selectedId = id;
    this.http.get<any>(`${this.api}/inbox/${id}`).subscribe({
      next: (r) => this.applyConversation(r),
      error: () => { this.threadLoading = false; this.toast.error('Failed to open conversation.'); },
    });
  }

  private applyConversation(r: any, scroll = true) {
    const grew = r.messages.length !== this.messages.length || r.conversation.id !== this.selected?.id;
    const isNew = this.messages.length > 0 && r.messages.length > this.messages.length;
    this.selected = r.conversation;
    this.threadLoading = false;

    // Animate only a fresh bot reply in the thread already open — visitor messages
    // must be readable the moment the poll brings them in.
    if (isNew && this.typewriterEnabled && !this.reducedMotion && r.conversation.id === this.selectedId) {
      const latest = r.messages[r.messages.length - 1];
      if (latest && latest.senderType === 'BOT') {
        this.runTypewriter(latest.id, latest.message);
      }
    }

    this.messages = r.messages;
    const row = this.conversations.find((c) => c.id === r.conversation.id);
    if (row) { row.unread = 0; row.status = r.conversation.status; row.assignedTo = r.conversation.assignedTo; }
    this.updateTabTitle();
    if (scroll && grew) setTimeout(() => this.scrollThreadToBottom(), 30);
  }

  /** "Today" / "Yesterday" / "12 Oct" above the first message of each day; null when the day hasn't changed. */
  dayLabel(i: number): string | null {
    const at = new Date(this.messages[i]?.createdAt);
    if (isNaN(at.getTime())) return null;
    const day = at.toDateString();
    if (i > 0 && new Date(this.messages[i - 1].createdAt).toDateString() === day) return null;
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (day === today.toDateString()) return 'Today';
    if (day === yesterday.toDateString()) return 'Yesterday';
    return at.toLocaleDateString([], { day: 'numeric', month: 'short', ...(at.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
  }

  scrollThreadToBottom() {
    if (this.threadEl?.nativeElement) {
      this.threadEl.nativeElement.scrollTo({ top: this.threadEl.nativeElement.scrollHeight, behavior: this.reducedMotion ? 'auto' : 'smooth' });
    }
  }

  /**
   * Typewriter streaming effect for message bubbles.
   */
  runTypewriter(messageId: number, fullText: string, speedMs = 18) {
    if (this.typewriterTimer) clearInterval(this.typewriterTimer);
    this.typewriterActiveMessageId = messageId;
    this.typewriterRenderedText[messageId] = '';
    // Long replies type in bigger steps so none takes more than about a second.
    const step = Math.max(1, Math.ceil(fullText.length / (1000 / speedMs)));
    let i = 0;
    this.typewriterTimer = setInterval(() => {
      if (i < fullText.length && this.typewriterActiveMessageId === messageId) {
        i = Math.min(fullText.length, i + step);
        this.typewriterRenderedText[messageId] = fullText.slice(0, i);
        this.scrollThreadToBottom();
      } else {
        clearInterval(this.typewriterTimer);
        this.typewriterTimer = null;
        this.typewriterActiveMessageId = null;
        this.typewriterRenderedText[messageId] = fullText;
      }
    }, speedMs);
  }

  getMessageDisplayText(m: any): string {
    if (this.typewriterActiveMessageId === m.id) {
      return this.typewriterRenderedText[m.id] !== undefined ? this.typewriterRenderedText[m.id] : m.message;
    }
    return m.message;
  }

  /** Agents get fresh visitor messages without a socket — a short poll is plenty for chat volume. */
  private schedulePoll() {
    clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => {
      if (this.tab === 'inbox' && document.visibilityState !== 'hidden') {
        this.loadInbox(true);
        if (this.selectedId && !this.sending) {
          this.http.get<any>(`${this.api}/inbox/${this.selectedId}`).subscribe({ next: (r) => this.applyConversation(r) });
        }
      }
      this.schedulePoll();
    }, 5000);
  }

  sendReply() {
    const message = this.reply.trim();
    if (!message || !this.selectedId || this.sending || this.chatEnded) return;
    this.sending = true;
    this.http.post<any>(`${this.api}/inbox/${this.selectedId}/reply`, { message }).subscribe({
      next: (r) => { this.reply = ''; this.sending = false; this.applyConversation(r); this.loadInbox(true); },
      error: (e) => { this.sending = false; this.toast.error(e?.error?.message || 'Failed to send.'); },
    });
  }

  readonly attachAccept = '.jpg,.jpeg,.png,.gif,.webp,.heic,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';

  sendAttachment(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.selectedId || this.sending || this.chatEnded) return;
    if (file.size > 10 * 1024 * 1024) {
      this.toast.error('That file is over 10 MB.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    const caption = this.reply.trim();
    if (caption) form.append('message', caption);
    this.sending = true;
    this.http.post<any>(`${this.api}/inbox/${this.selectedId}/attachments`, form).subscribe({
      next: (r) => { this.reply = ''; this.sending = false; this.applyConversation(r); this.loadInbox(true); },
      error: (e) => { this.sending = false; this.toast.error(e?.error?.message || 'Failed to send the file.'); },
    });
  }

  /** A file message whose text is just the file name — the preview says it all. */
  isAttachmentOnly(m: any): boolean {
    const a = m.metadata?.attachment;
    return !!a && (!m.message || m.message === a.name);
  }

  /** Only http(s) links are rendered as file links or images. */
  safeUrl(url: string): string | null {
    return /^https?:\/\//.test(url || '') ? url : null;
  }

  fileSize(n: number): string {
    return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`;
  }

  onReplyKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendReply(); }
  }

  /**
   * Canned reply with high-speed typewriter effect into textarea.
   */
  useCanned(text: string, typeIt = true) {
    if (!typeIt) {
      this.reply = this.reply ? `${this.reply} ${text}` : text;
      return;
    }
    let i = 0;
    const startText = this.reply ? `${this.reply} ` : '';
    this.reply = startText;
    const timer = setInterval(() => {
      if (i < text.length) {
        this.reply += text[i];
        i++;
      } else {
        clearInterval(timer);
      }
    }, 12);
  }

  formatMessage(text: string): SafeHtml {
    if (!text) return '';
    let s = String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    s = s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code class="ci-inline-code">$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    return this.sanitizer.bypassSecurityTrustHtml(s);
  }

  getAvatarGradient(name?: string): string {
    const palettes = [
      'linear-gradient(135deg, #3b82f6, #1d4ed8)',
      'linear-gradient(135deg, #8b5cf6, #6d28d9)',
      'linear-gradient(135deg, #059669, #047857)',
      'linear-gradient(135deg, #ec4899, #be185d)',
      'linear-gradient(135deg, #d97706, #b45309)',
      'linear-gradient(135deg, #0891b2, #0e7490)',
      'linear-gradient(135deg, #4f46e5, #3730a3)',
    ];
    if (!name) return palettes[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return palettes[Math.abs(hash) % palettes.length];
  }

  getInitials(name?: string): string {
    if (!name) return 'V';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  formatPageUrl(url?: string): { display: string; fullUrl: string } {
    if (!url) return { display: 'Website', fullUrl: '' };
    try {
      const u = new URL(url);
      if (u.pathname.includes('/careers')) {
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length > 1) {
          try {
            const decoded = decodeURIComponent(parts[1]);
            const atobVal = atob(decoded);
            return { display: `Careers: Job #${atobVal}`, fullUrl: url };
          } catch {
            return { display: 'Careers Portal', fullUrl: url };
          }
        }
        return { display: 'Careers Portal', fullUrl: url };
      }
      return { display: `${u.hostname}${u.pathname !== '/' ? u.pathname : ''}`, fullUrl: url };
    } catch {
      return { display: url.length > 32 ? url.slice(0, 32) + '…' : url, fullUrl: url };
    }
  }

  copyContact(text: string, label: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    this.toast.success(`Copied ${label} to clipboard!`);
  }

  setStatus(status: string) {
    this.patch({ status }, status === 'RESOLVED' ? 'Marked resolved.' : 'Status updated.');
  }

  assignToMe() {
    this.patch({ assignedToId: 'me' }, 'Assigned to you.');
  }

  private patch(body: any, ok: string) {
    if (!this.selectedId) return;
    this.http.patch<any>(`${this.api}/inbox/${this.selectedId}`, body).subscribe({
      next: (r) => { this.applyConversation(r); this.loadInbox(true); this.toast.success(ok); },
      error: (e) => this.toast.error(e?.error?.message || 'Update failed.'),
    });
  }

  convertToLead() {
    if (!this.selectedId) return;
    this.http.post<any>(`${this.api}/inbox/${this.selectedId}/convert-lead`, {}).subscribe({
      next: (r) => {
        this.toast.success(r.existing ? 'Already saved as a lead contact.' : 'Saved to Lead Contacts.');
        this.open(this.selectedId!);
      },
      error: (e) => this.toast.error(e?.error?.message || 'Could not create lead.'),
    });
  }

  convertToTicket() {
    if (!this.selectedId) return;
    const title = prompt('Ticket title', `Website chat: ${this.selected?.visitorName || 'visitor'}`);
    if (title === null) return;
    this.http.post<any>(`${this.api}/inbox/${this.selectedId}/convert-ticket`, { title }).subscribe({
      next: (r) => {
        this.toast.success(r.existing ? 'A ticket already exists for this chat.' : `Ticket ${r.ticketNumber} created.`);
        this.open(this.selectedId!);
      },
      error: (e) => this.toast.error(e?.error?.message || 'Could not create ticket.'),
    });
  }

  statusLabel(s: string) {
    return ({ BOT: 'Bot', OPEN: 'Waiting', RESOLVED: 'Resolved', CLOSED: 'Closed' } as any)[s] || s;
  }

  // ═══ Knowledge base ═══

  articleEditorTab: 'write' | 'preview' = 'write';

  get totalArticlesCount(): number {
    if (this.categories.length) {
      return this.categories.reduce((acc, c) => acc + (c._count?.articles || 0), 0);
    }
    return this.articles.length;
  }

  get activeCategoryName(): string {
    if (!this.kbCategoryFilter) return 'All Articles';
    const c = this.categories.find(cat => cat.id === this.kbCategoryFilter);
    return c ? c.name : 'Articles';
  }

  loadCategories() {
    this.http.get<any[]>(`${this.api}/kb/categories`).subscribe({
      next: (r) => (this.categories = r),
      error: () => this.toast.error('Failed to load categories.'),
    });
  }

  loadArticles() {
    const params: any = this.kbCategoryFilter ? { categoryId: this.kbCategoryFilter } : {};
    this.http.get<any[]>(`${this.api}/kb/articles`, { params }).subscribe({
      next: (r) => (this.articles = r),
      error: () => this.toast.error('Failed to load articles.'),
    });
  }

  get filteredArticles() {
    const q = this.kbSearch.trim().toLowerCase();
    return q ? this.articles.filter((a) =>
      a.title?.toLowerCase().includes(q) ||
      a.excerpt?.toLowerCase().includes(q) ||
      a.tags?.some((t: string) => t.toLowerCase().includes(q))
    ) : this.articles;
  }

  clearKbSearch() {
    this.kbSearch = '';
  }

  newCategory() {
    this.editingCategory = { name: '', description: '', sortOrder: 0, isPublic: true };
  }

  saveCategory() {
    const c = this.editingCategory;
    const req = c.id ? this.http.put(`${this.api}/kb/categories/${c.id}`, c) : this.http.post(`${this.api}/kb/categories`, c);
    req.subscribe({
      next: () => { this.editingCategory = null; this.loadCategories(); this.toast.success('Category saved.'); },
      error: (e) => this.toast.error(e?.error?.message || 'Failed to save category.'),
    });
  }

  deleteCategory(c: any) {
    if (!confirm(`Delete "${c.name}" and its ${c._count?.articles || 0} article(s)?`)) return;
    this.http.delete(`${this.api}/kb/categories/${c.id}`).subscribe({
      next: () => {
        if (this.kbCategoryFilter === c.id) this.kbCategoryFilter = null;
        this.loadCategories(); this.loadArticles(); this.toast.success('Category deleted.');
      },
      error: () => this.toast.error('Failed to delete category.'),
    });
  }

  newArticle() {
    if (!this.categories.length) {
      this.toast.info('Please create a category first to organize your articles.');
      this.newCategory();
      return;
    }
    this.articleEditorTab = 'write';
    this.editingArticle = {
      title: '',
      content: '',
      excerpt: '',
      tagsText: '',
      isPublished: true,
      categoryId: this.kbCategoryFilter || this.categories[0].id
    };
  }

  editArticle(a: any) {
    this.articleEditorTab = 'write';
    this.editingArticle = { ...a, tagsText: (a.tags || []).join(', ') };
  }

  getParsedTags(): string[] {
    if (!this.editingArticle?.tagsText) return [];
    return this.editingArticle.tagsText
      .split(',')
      .map((t: string) => t.trim())
      .filter((t: string) => !!t);
  }

  insertMarkdown(prefix: string, suffix: string = '') {
    const el = document.getElementById('kb-article-content-area') as HTMLTextAreaElement | null;
    if (!el || !this.editingArticle) return;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const text = this.editingArticle.content || '';
    const selected = text.substring(start, end);
    const replacement = prefix + (selected || 'text') + suffix;
    this.editingArticle.content = text.substring(0, start) + replacement + text.substring(end);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + (selected ? selected.length : 4));
    }, 10);
  }

  renderMarkdown(md: string): SafeHtml {
    if (!md || !md.trim()) {
      return this.sanitizer.bypassSecurityTrustHtml('<div class="ci-preview-placeholder">Nothing to preview yet. Start typing in the Write tab...</div>');
    }
    let html = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // Headings
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    // Bold & italic
    html = html.replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/gim, '<em>$1</em>');
    // Inline code
    html = html.replace(/`([^`]+)`/gim, '<code>$1</code>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Bullet list items
    html = html.replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
    // Blockquotes
    html = html.replace(/^\>\s+(.*$)/gim, '<blockquote>$1</blockquote>');
    // Paragraphs
    html = html.replace(/\n\n+/g, '</p><p>');
    html = '<p>' + html.replace(/\n/g, '<br>') + '</p>';
    html = html.replace(/<p><\/p>/g, '').replace(/<p><br><\/p>/g, '');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  saveArticle() {
    const a = this.editingArticle;
    const body = { categoryId: a.categoryId, title: a.title, content: a.content, excerpt: a.excerpt, tags: a.tagsText, isPublished: a.isPublished };
    this.kbSaving = true;
    const req = a.id ? this.http.put(`${this.api}/kb/articles/${a.id}`, body) : this.http.post(`${this.api}/kb/articles`, body);
    req.subscribe({
      next: () => { this.kbSaving = false; this.editingArticle = null; this.loadArticles(); this.loadCategories(); this.toast.success('Article saved.'); },
      error: (e) => { this.kbSaving = false; this.toast.error(e?.error?.message || 'Failed to save article.'); },
    });
  }

  deleteArticle(a: any) {
    if (!confirm(`Delete "${a.title}"?`)) return;
    this.http.delete(`${this.api}/kb/articles/${a.id}`).subscribe({
      next: () => { this.loadArticles(); this.loadCategories(); this.toast.success('Article deleted.'); },
      error: () => this.toast.error('Failed to delete article.'),
    });
  }

  // ═══ Widgets ═══

  brandColorPresets = [
    '#0284C7', // Sky Blue (Primary Default)
    '#2563EB', // Royal Blue
    '#4F46E5', // Indigo
    '#7C3AED', // Violet
    '#9333EA', // Purple
    '#DB2777', // Pink
    '#E11D48', // Rose Red
    '#EA580C', // Orange
    '#D97706', // Amber Gold
    '#059669', // Emerald Green
    '#0D9488', // Teal
    '#0F172A', // Midnight Slate
  ];

  hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in (window as any);

  selectColor(color: string) {
    if (!this.editingWidget) return;
    let c = (color || '#0284C7').trim();
    if (!c.startsWith('#')) c = '#' + c;
    this.editingWidget.primaryColor = c.toUpperCase();
  }

  onHexInput(value: string) {
    if (!this.editingWidget) return;
    const clean = (value || '').trim().replace(/[^0-9A-Fa-f]/g, '').slice(0, 6);
    this.editingWidget.primaryColor = '#' + clean.toUpperCase();
  }

  async openEyeDropper() {
    if (typeof window !== 'undefined' && (window as any).EyeDropper) {
      try {
        const eyeDropper = new (window as any).EyeDropper();
        const res = await eyeDropper.open();
        if (res?.sRGBHex) {
          this.selectColor(res.sRGBHex);
        }
      } catch {
        // Dropper cancelled by user
      }
    }
  }

  isDarkColor(hex?: string): boolean {
    if (!hex) return true;
    let c = hex.replace('#', '');
    if (c.length === 3) {
      c = c.split('').map(x => x + x).join('');
    }
    if (c.length < 6) return true;
    const r = parseInt(c.substring(0, 2), 16) || 0;
    const g = parseInt(c.substring(2, 4), 16) || 0;
    const b = parseInt(c.substring(4, 6), 16) || 0;
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq < 150;
  }

  copiedSnippetId: string | null = null;
  copiedKeyId: string | null = null;

  copySnippet(w: any) {
    const s = this.snippet(w);
    navigator.clipboard.writeText(s).then(() => {
      this.copiedSnippetId = w.id || w.widgetKey;
      setTimeout(() => (this.copiedSnippetId = null), 2000);
      this.toast.success('Embed snippet copied to clipboard');
    });
  }

  copyKey(w: any) {
    navigator.clipboard.writeText(w.widgetKey).then(() => {
      this.copiedKeyId = w.id || w.widgetKey;
      setTimeout(() => (this.copiedKeyId = null), 2000);
      this.toast.success('Widget key copied');
    });
  }

  loadWidgets() {
    this.http.get<any[]>(`${this.api}/widgets`).subscribe({
      next: (r) => (this.widgets = r),
      error: () => this.toast.error('Failed to load widgets.'),
    });
  }

  readonly weekDays = [
    { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
    { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
  ];

  editWidget(w: any) {
    this.editingWidget = { ...w, officeHours: this.officeHoursFor(w.officeHours) };
  }

  /** A schedule the editor can bind to: saved one, or Mon–Fri 9:30–18:30 IST switched off. */
  private officeHoursFor(saved: any) {
    const weekday = () => ({ open: '09:30', close: '18:30' });
    const base = {
      enabled: false,
      timezone: 'Asia/Kolkata',
      days: { mon: weekday(), tue: weekday(), wed: weekday(), thu: weekday(), fri: weekday(), sat: null, sun: null } as any,
    };
    if (!saved) return base;
    return { enabled: !!saved.enabled, timezone: saved.timezone || base.timezone, days: { ...base.days, ...(saved.days || {}) } };
  }

  toggleOfficeDay(key: string) {
    const days = this.editingWidget.officeHours.days;
    days[key] = days[key] ? null : { open: '09:30', close: '18:30' };
  }

  newWidget() {
    this.editingWidget = {
      officeHours: this.officeHoursFor(null),
      offlineMessage: '',
      name: 'Website Widget',
      primaryColor: '#0284C7',
      headerTitle: 'CES Support & Careers',
      headerSubtitle: 'We are here to help you!',
      greetingMessage: 'Hi there! How can we help you today?',
      botName: 'CES Assistant',
      botAvatarUrl: '',
      position: 'br',
      enableAi: true,
      isEnabled: true,
      allowedDomains: 'ces-pl.com, *.ces-pl.com',
    };
  }

  saveWidget() {
    const w = this.editingWidget;
    this.widgetSaving = true;
    const req = w.id ? this.http.put(`${this.api}/widgets/${w.id}`, w) : this.http.post(`${this.api}/widgets`, w);
    req.subscribe({
      next: () => { this.widgetSaving = false; this.editingWidget = null; this.loadWidgets(); this.toast.success('Widget saved.'); },
      error: (e) => { this.widgetSaving = false; this.toast.error(e?.error?.message || 'Failed to save widget.'); },
    });
  }

  deletingWidgetId: number | null = null;

  deleteWidget(w: any) {
    const chats = w._count?.conversations || 0;
    const warning = chats
      ? `Delete "${w.name}"? Its ${chats} chat${chats === 1 ? '' : 's'} will be deleted too, and any site using its embed script will stop showing the chat. This cannot be undone.`
      : `Delete "${w.name}"? Any site using its embed script will stop showing the chat. This cannot be undone.`;
    if (!confirm(warning)) return;
    this.deletingWidgetId = w.id;
    this.http.delete(`${this.api}/widgets/${w.id}`).subscribe({
      next: () => { this.deletingWidgetId = null; this.loadWidgets(); this.toast.success('Widget deleted.'); },
      error: (e) => { this.deletingWidgetId = null; this.toast.error(e?.error?.message || 'Failed to delete widget.'); },
    });
  }

  avatarUploading = false;

  /** Upload the bot's photo through the shared /upload endpoint; the returned URL is public, so it works on ces-pl.com too. */
  uploadAvatar(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.editingWidget) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      this.toast.error('Please choose a PNG, JPG or WebP image.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      this.toast.error('Image must be 2 MB or smaller.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    this.avatarUploading = true;
    this.http.post<{ url: string }>(`${environment.apiUrl}/upload`, form).subscribe({
      next: (r) => { this.editingWidget.botAvatarUrl = r.url; this.avatarUploading = false; this.toast.success('Photo uploaded — save the widget to apply it.'); },
      error: (e) => { this.avatarUploading = false; this.toast.error(e?.error?.message || 'Upload failed.'); },
    });
  }

  snippet(w: any) {
    return `<script src="${environment.apiUrl}/public/chat-widget/embed.js" data-widget-key="${w.widgetKey}" data-theme="light" async></script>`;
  }

  copy(text: string) {
    navigator.clipboard.writeText(text).then(() => this.toast.success('Copied.'));
  }
}
