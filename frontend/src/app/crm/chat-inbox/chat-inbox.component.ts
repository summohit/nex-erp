import { Component, OnDestroy, OnInit, ElementRef, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
  private api = `${environment.apiUrl}/chat`;

  @ViewChild('thread') threadEl?: ElementRef<HTMLDivElement>;

  tab: Tab = 'inbox';
  /** Tabs this user was granted; the others are hidden. */
  allowedTabs = new Set<Tab>();

  // ─── Inbox ───
  statusFilter = 'ACTIVE';
  mineOnly = false;
  conversations: any[] = [];
  inboxLoading = false;
  selectedId: number | null = null;
  selected: any = null;
  messages: any[] = [];
  reply = '';
  sending = false;
  private pollTimer: any = null;

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
    this.load(this.tab);
    this.schedulePoll();
  }

  ngOnDestroy() {
    clearTimeout(this.pollTimer);
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

  loadInbox(silent = false) {
    if (!silent) this.inboxLoading = true;
    const params: any = {};
    if (this.statusFilter) params.status = this.statusFilter;
    if (this.mineOnly) params.mine = '1';
    this.http.get<any[]>(`${this.api}/inbox`, { params }).subscribe({
      next: (rows) => { this.conversations = rows; this.inboxLoading = false; },
      error: () => { this.inboxLoading = false; if (!silent) this.toast.error('Failed to load chats.'); },
    });
  }

  open(id: number) {
    this.selectedId = id;
    this.http.get<any>(`${this.api}/inbox/${id}`).subscribe({
      next: (r) => this.applyConversation(r),
      error: () => this.toast.error('Failed to open conversation.'),
    });
  }

  private applyConversation(r: any, scroll = true) {
    const grew = r.messages.length !== this.messages.length || r.conversation.id !== this.selected?.id;
    this.selected = r.conversation;
    this.messages = r.messages;
    const row = this.conversations.find((c) => c.id === r.conversation.id);
    if (row) { row.unread = 0; row.status = r.conversation.status; row.assignedTo = r.conversation.assignedTo; }
    if (scroll && grew) setTimeout(() => this.threadEl?.nativeElement.scrollTo({ top: 1e9 }), 30);
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
    if (!message || !this.selectedId || this.sending) return;
    this.sending = true;
    this.http.post<any>(`${this.api}/inbox/${this.selectedId}/reply`, { message }).subscribe({
      next: (r) => { this.reply = ''; this.sending = false; this.applyConversation(r); this.loadInbox(true); },
      error: (e) => { this.sending = false; this.toast.error(e?.error?.message || 'Failed to send.'); },
    });
  }

  onReplyKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendReply(); }
  }

  useCanned(text: string) {
    this.reply = this.reply ? `${this.reply} ${text}` : text;
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

  brandColorPresets = ['#0284C7', '#2563EB', '#4F46E5', '#7C3AED', '#059669', '#0D9488', '#DB2777', '#0F172A'];

  selectColor(color: string) {
    if (this.editingWidget) {
      this.editingWidget.primaryColor = color;
    }
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

  newWidget() {
    this.editingWidget = {
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
    return `<script src="${environment.apiUrl}/public/chat-widget/embed.js" data-widget-key="${w.widgetKey}" async></script>`;
  }

  copy(text: string) {
    navigator.clipboard.writeText(text).then(() => this.toast.success('Copied.'));
  }
}
