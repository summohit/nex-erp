import { Component, ElementRef, HostListener, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AuthService } from '../../../services/auth.service';
import { environment } from '../../../../environments/environment';

type Block =
  | { type: 'kpis'; title?: string; items: { label: string; value: string | number; tone?: string }[] }
  | { type: 'table'; title: string; columns: string[]; rows: (string | number | null)[][]; employeeIds?: (number | null)[]; avatars?: Record<number, string> }
  | { type: 'chart'; title: string; kind: 'bar' | 'line'; labels: string[]; values: number[] };

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  html?: SafeHtml;
  blocks?: Block[];
  sources?: string[];
  error?: boolean;
  time?: string;
  replyTo?: string;
  reaction?: 'up' | 'down' | null;
  followUps?: string[];
}

export interface SuggestionItem {
  text: string;
  icon: 'calendar' | 'island' | 'trophy' | 'alert-doc' | 'checklist' | 'chart' | 'user-plus' | 'question' | 'clock' | 'building';
  tone: string;
}

export type MiraPanelState = 'closed' | 'bursting' | 'opening' | 'open' | 'closing';

/**
 * Ask MIRA (17 Nov 2026) — Super Admin only AI assistant.
 * Futuristic 60x60 morphing launcher + slide/scale transformation panel, opened with Ctrl/Cmd + J.
 */
@Component({
  selector: 'app-ask-mira',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ask-mira.html',
  styleUrls: ['./ask-mira.scss'],
})
export class AskMiraComponent implements OnDestroy {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);
  private api = `${environment.apiUrl}/ai/ask-mira`;

  @ViewChild('scroller') scroller?: ElementRef<HTMLElement>;
  @ViewChild('inputEl') inputEl?: ElementRef<HTMLTextAreaElement>;

  readonly allowed = computed(() => ['SUPERADMIN', 'SUPER_ADMIN'].includes(this.auth.currentUser()?.role));

  // Animation & Lifecycle State Machine
  panelState = signal<MiraPanelState>('closed');
  justReturned = signal(false);
  expanded = signal(false);

  // Derived states for template & backward compatibility
  readonly open = computed(() => {
    const s = this.panelState();
    return s === 'opening' || s === 'open' || s === 'closing';
  });
  readonly isBursting = computed(() => this.panelState() === 'bursting');
  readonly isOpening = computed(() => this.panelState() === 'opening');
  readonly isClosing = computed(() => this.panelState() === 'closing');
  readonly isLauncherMorphed = computed(() => {
    const s = this.panelState();
    return s === 'opening' || s === 'open';
  });

  messages = signal<Msg[]>([]);
  input = signal('');
  thinking = signal(false);
  briefing = signal<{ date: string; items: { label: string; value: number; tone: string; ask: string }[] } | null>(null);
  showAllSuggestions = signal(false);
  showMoreQuick = signal(false);
  replyingTo = signal<{ preview: string; full: string } | null>(null);
  copiedIndex = signal<number | null>(null);
  listening = signal(false);
  tableLimit: Record<string, number> = {};
  tableSearch: Record<string, string> = {};

  private stageTimer1: any = null;
  private stageTimer2: any = null;
  private returnTimer: any = null;
  private recognition: any = null;

  readonly suggestionItems: SuggestionItem[] = [
    { text: 'Who came late today?', icon: 'calendar', tone: 'blue' },
    { text: 'Who is on leave this week?', icon: 'island', tone: 'teal' },
    { text: 'Top 10 late comers this month', icon: 'trophy', tone: 'amber' },
    { text: 'Show overdue tasks by person', icon: 'alert-doc', tone: 'red' },
    { text: 'Pending leave requests', icon: 'checklist', tone: 'indigo' },
    { text: 'Attendance trend last 30 days', icon: 'chart', tone: 'sky' },
    { text: 'New joiners this month', icon: 'user-plus', tone: 'violet' },
    { text: 'Aaj kaun absent hai?', icon: 'question', tone: 'purple' },
    { text: 'Who has 100% attendance this month?', icon: 'trophy', tone: 'green' },
    { text: 'Department-wise attendance today', icon: 'building', tone: 'blue' },
    { text: 'Who has not clocked out yesterday?', icon: 'clock', tone: 'amber' },
    { text: 'High priority overdue tasks', icon: 'alert-doc', tone: 'red' },
  ];

  readonly visibleSuggestions = computed(() =>
    this.showAllSuggestions() ? this.suggestionItems : this.suggestionItems.slice(0, 8)
  );

  readonly quickChips = [
    { label: 'This week', ask: 'Give me the attendance and leave summary for this week' },
    { label: 'This month', ask: 'Give me the attendance and punctuality summary for this month' },
    { label: 'Employee report', ask: 'Show employee attendance and overdue task summary report' },
  ];

  readonly extraQuickChips = [
    { label: 'Today summary', ask: 'Give me a complete summary of attendance, leaves, and tasks today' },
    { label: 'Late comers', ask: 'Who came late today and this week?' },
    { label: 'Pending approvals', ask: 'Show all pending leave requests that need approval' },
    { label: 'Dept breakdown', ask: 'Show department-wise attendance breakdown for today' },
  ];

  ngOnDestroy() {
    this.clearTimers();
  }

  private clearTimers() {
    if (this.stageTimer1) { clearTimeout(this.stageTimer1); this.stageTimer1 = null; }
    if (this.stageTimer2) { clearTimeout(this.stageTimer2); this.stageTimer2 = null; }
    if (this.returnTimer) { clearTimeout(this.returnTimer); this.returnTimer = null; }
  }

  private prefersReducedMotion(): boolean {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent) {
    if (!this.allowed()) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      this.toggle();
    } else if (e.key === 'Escape' && (this.panelState() === 'open' || this.panelState() === 'opening')) {
      this.closePanel();
    }
  }

  toggle() {
    const s = this.panelState();
    if (s === 'closed' || s === 'closing') {
      this.openPanel();
    } else {
      this.closePanel();
    }
  }

  openPanel() {
    this.clearTimers();
    this.justReturned.set(false);
    if (!this.briefing()) this.loadBriefing();

    if (this.prefersReducedMotion()) {
      this.panelState.set('open');
      setTimeout(() => this.inputEl?.nativeElement.focus(), 40);
      return;
    }

    this.panelState.set('bursting');

    this.stageTimer1 = setTimeout(() => {
      this.panelState.set('opening');
      setTimeout(() => this.inputEl?.nativeElement.focus(), 140);

      this.stageTimer2 = setTimeout(() => {
        if (this.panelState() === 'opening') {
          this.panelState.set('open');
        }
      }, 640);
    }, 115);
  }

  closePanel() {
    const s = this.panelState();
    if (s === 'closed' || s === 'closing') return;
    this.clearTimers();

    if (this.prefersReducedMotion()) {
      this.panelState.set('closed');
      return;
    }

    this.panelState.set('closing');
    this.justReturned.set(true);

    this.stageTimer1 = setTimeout(() => {
      this.panelState.set('closed');
      this.returnTimer = setTimeout(() => this.justReturned.set(false), 450);
    }, 410);
  }

  loadBriefing() {
    this.http.get<any>(`${this.api}/briefing`).subscribe({
      next: (b) => this.briefing.set(b),
      error: () => {},
    });
  }

  greetingPrefix() {
    const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }

  userName() {
    return this.auth.currentUser()?.employee?.firstName || 'Developer';
  }

  cardMeta(label: string): { trend: string; dir: 'up' | 'down'; cardClass: string; badge?: string } {
    switch (label) {
      case 'Present':
        return { trend: '+2%', dir: 'up', cardClass: 'card-present' };
      case 'Late':
        return { trend: '+1%', dir: 'up', cardClass: 'card-late' };
      case 'On leave':
        return { trend: '0%', dir: 'up', cardClass: 'card-leave' };
      case 'Not clocked in':
        return { trend: '-1%', dir: 'down', cardClass: 'card-not-clocked' };
      case 'Pending leave':
        return { trend: '+1%', dir: 'up', cardClass: 'card-pending', badge: 'Action Needed' };
      case 'Overdue tasks':
        return { trend: '+5%', dir: 'up', cardClass: 'card-overdue' };
      default:
        return { trend: '0%', dir: 'up', cardClass: 'card-present' };
    }
  }

  kpiTone(k: { label: string; tone?: string }): string {
    if (k.tone) return k.tone;
    const l = k.label.toLowerCase();
    if (l.includes('present') || l.includes('clocked in') || l.includes('completed') || l.includes('done')) return 'green';
    if (l.includes('late') || l.includes('not clocked') || l.includes('pending') || l.includes('progress')) return 'amber';
    if (l.includes('overdue') || l.includes('absent') || l.includes('rejected')) return 'red';
    if (l.includes('people') || l.includes('employee') || l.includes('leave')) return 'blue';
    return 'violet';
  }

  kpiIcon(label: string): 'calendar' | 'users' | 'check' | 'clock' | 'alert' {
    const l = label.toLowerCase();
    if (l.includes('people') || l.includes('employee') || l.includes('team')) return 'users';
    if (l.includes('clocked in') || l.includes('present') || l.includes('completed') || l.includes('approved')) return 'check';
    if (l.includes('not clocked') || l.includes('late') || l.includes('pending')) return 'clock';
    if (l.includes('overdue') || l.includes('absent')) return 'alert';
    return 'calendar';
  }

  formatDateCell(val: any): string {
    const s = String(val ?? '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return s;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mon = months[Number(m[2]) - 1] || m[2];
    return `${Number(m[3])} ${mon} ${m[1]}`;
  }

  isDateValue(val: any): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(val ?? '').trim());
  }

  newChat() {
    this.messages.set([]);
    this.replyingTo.set(null);
    this.loadBriefing();
  }

  setReplyContext(text: string) {
    const clean = text.replace(/\s+/g, ' ').trim();
    const preview = clean.length > 90 ? clean.slice(0, 90) + '…' : clean;
    this.replyingTo.set({ preview, full: clean });
    setTimeout(() => this.inputEl?.nativeElement.focus(), 30);
  }

  askAboutPerson(name: any, tableTitle: string) {
    const person = String(name ?? '').trim();
    if (!person) return;
    this.setReplyContext(`${person} (${tableTitle})`);
    this.input.set(`Tell me more about ${person}'s attendance, leaves, and tasks`);
    setTimeout(() => this.inputEl?.nativeElement.focus(), 30);
  }

  clearReply() {
    this.replyingTo.set(null);
  }

  send(text?: string) {
    const raw = (text ?? this.input()).trim();
    if (!raw || this.thinking()) return;
    const replyCtx = this.replyingTo();
    const promptToSend = replyCtx && !text ? `[Context: "${replyCtx.preview}"]\n${raw}` : raw;

    this.input.set('');
    this.replyingTo.set(null);

    const nowTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const userMsg: Msg = {
      role: 'user',
      content: raw,
      time: nowTime,
      replyTo: replyCtx?.preview,
    };

    const history = [...this.messages(), userMsg];
    this.messages.set(history);
    this.thinking.set(true);
    this.scrollDown();

    const payloadMessages = history
      .filter((m) => !m.error)
      .map((m, idx) => ({
        role: m.role,
        content: idx === history.length - 1 ? promptToSend : m.content,
      }));

    this.http
      .post<{ answer: string; blocks: Block[]; sources: string[] }>(`${this.api}/chat`, {
        messages: payloadMessages,
      })
      .subscribe({
        next: (r) => {
          const botTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          this.messages.set([
            ...this.messages(),
            {
              role: 'assistant',
              content: r.answer,
              html: this.md(r.answer),
              blocks: r.blocks,
              sources: r.sources,
              time: botTime,
              reaction: null,
              followUps: this.buildFollowUps(raw, r.blocks),
            },
          ]);
          this.thinking.set(false);
          this.scrollDown();
        },
        error: (e) => {
          const t =
            e?.status === 403
              ? 'Ask MIRA is available to Super Admin only.'
              : 'Something went wrong. Please try again.';
          this.messages.set([
            ...this.messages(),
            {
              role: 'assistant',
              content: t,
              html: this.md(t),
              error: true,
              time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            },
          ]);
          this.thinking.set(false);
          this.scrollDown();
        },
      });
  }

  regenerate(msgIndex: number) {
    if (this.thinking()) return;
    const msgs = this.messages();
    let userPrompt = '';
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        userPrompt = msgs[i].content;
        break;
      }
    }
    if (!userPrompt) return;
    this.messages.set(msgs.slice(0, msgIndex));
    this.send(userPrompt);
  }

  copyMessage(m: Msg, index: number) {
    navigator.clipboard?.writeText(m.content);
    this.copiedIndex.set(index);
    setTimeout(() => {
      if (this.copiedIndex() === index) this.copiedIndex.set(null);
    }, 1800);
  }

  react(index: number, type: 'up' | 'down') {
    const updated = [...this.messages()];
    const cur = updated[index];
    if (!cur) return;
    updated[index] = { ...cur, reaction: cur.reaction === type ? null : type };
    this.messages.set(updated);
  }

  toggleVoice() {
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      this.input.set(this.input() || 'Who came late today?');
      this.inputEl?.nativeElement.focus();
      return;
    }
    if (this.listening() && this.recognition) {
      this.recognition.stop();
      this.listening.set(false);
      return;
    }
    const rec = new SpeechRec();
    this.recognition = rec;
    rec.lang = 'en-IN';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    this.listening.set(true);
    rec.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript || '';
      if (transcript) {
        this.input.set((this.input() + ' ' + transcript).trim());
      }
      this.listening.set(false);
      setTimeout(() => this.inputEl?.nativeElement.focus(), 30);
    };
    rec.onerror = () => this.listening.set(false);
    rec.onend = () => this.listening.set(false);
    rec.start();
  }

  onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      this.send();
    }
  }

  private buildFollowUps(query: string, blocks?: Block[]): string[] {
    const q = query.toLowerCase();
    if (q.includes('late')) {
      return ['Top 10 late comers this month', 'Department-wise late arrivals', 'Who was on time today?'];
    }
    if (q.includes('leave')) {
      return ['Pending leave requests', 'Who is on leave next week?', 'Leave trend this month'];
    }
    if (q.includes('task') || q.includes('overdue')) {
      return ['High priority overdue tasks', 'Tasks completed this week', 'Who has the most open tasks?'];
    }
    if (q.includes('absent') || q.includes('not clocked')) {
      return ['Who came late today?', 'Who is on approved leave today?', 'Attendance trend last 30 days'];
    }
    if (blocks?.some((b) => b.type === 'table')) {
      return ['Show department breakdown', 'Attendance trend last 30 days', 'Show overdue tasks by person'];
    }
    return ['Who came late today?', 'Pending leave requests', 'Show overdue tasks by person'];
  }

  private scrollDown() {
    setTimeout(() => {
      const el = this.scroller?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 35);
  }

  /**
   * Executive AI Markdown Renderer:
   * - Supports **bold**, *italic*, `code`
   * - Converts *Insight* / Note / Takeaway lines into a glowing .am-insight-card callout
   * - Styles status breakdown bullets (Scheduled:, Completed:, In-progress:, etc.) as color-coded chips
   * - Formats parenthesized counts like (3 visits) into inline badges
   */
  private md(s: string): SafeHtml {
    const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = esc.split('\n');
    let html = '';
    let inList = false;

    const formatInline = (txt: string) => {
      return txt
        .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[\s(])\*([^*]+?)\*(?=[\s.,;:!?)"]|$)/g, '$1<em>$2</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/\((\s*(?:<strong>)?\d+(?:<\/strong>)?\s+[a-zA-Z\s-]+)\)/g, '<span class="am-count-pill">$1</span>');
    };

    const statusBadgeTone = (key: string): string | null => {
      const k = key.toLowerCase().trim();
      if (['completed', 'present', 'approved', 'done', 'on time', 'clocked in'].includes(k)) return 'green';
      if (['in-progress', 'in progress', 'pending', 'late', 'half day'].includes(k)) return 'amber';
      if (['scheduled', 'on leave', 'upcoming', 'planned'].includes(k)) return 'blue';
      if (['overdue', 'absent', 'rejected', 'missed'].includes(k)) return 'red';
      if (['location', 'site', 'office', 'project', 'department'].includes(k)) return 'violet';
      return null;
    };

    for (const raw of lines) {
      const trimmed = raw.trim();
      if (!trimmed) {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        continue;
      }

      // Check for Insight / Takeaway / Note callout line
      const insightMatch = trimmed.match(/^(?:\*{1,2})?(Insight|Key\s*Takeaway|Recommendation|Summary|Note)(?:\*{1,2})?\s*:\s*(.+)$/i);
      if (insightMatch) {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        const label = insightMatch[1];
        const body = formatInline(insightMatch[2]);
        html += `<div class="am-insight-card"><div class="am-insight-head"><span class="am-insight-ic">✦</span><span>AI ${label}</span></div><div class="am-insight-body">${body}</div></div>`;
        continue;
      }

      // Check for bullet or numbered list item
      const m = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
      if (m) {
        const contentRaw = m[1].trim();

        // Check if bullet is a standalone section sub-header (e.g., "**Status breakdown**" with no colon)
        const secMatch = contentRaw.match(/^\*\*(.+?)\*\*\s*:?$/);
        if (secMatch && secMatch[1].length < 36) {
          if (inList) {
            html += '</ul>';
            inList = false;
          }
          html += `<div class="am-reply-subhead">${secMatch[1]}</div>`;
          continue;
        }

        if (!inList) {
          html += '<ul class="am-rich-list">';
          inList = true;
        }

        // Check if bullet is a Key: Value status or metadata row
        const kvMatch = contentRaw.match(/^(?:\*\*(.+?)\*\*|([A-Za-z][A-Za-z\s-]{1,22}))\s*:\s*(.+)$/);
        if (kvMatch) {
          const keyLabel = (kvMatch[1] || kvMatch[2]).trim();
          const valHtml = formatInline(kvMatch[3]);
          const tone = statusBadgeTone(keyLabel);
          if (tone) {
            html += `<li class="am-kv-item"><span class="am-kv-badge" data-tone="${tone}"><i class="dot"></i>${keyLabel}</span><span class="am-kv-val">${valHtml}</span></li>`;
            continue;
          }
        }

        html += `<li><span class="am-li-bullet" aria-hidden="true"></span><span class="am-li-txt">${formatInline(contentRaw)}</span></li>`;
      } else {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        html += `<p>${formatInline(trimmed)}</p>`;
      }
    }
    if (inList) html += '</ul>';
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  // ----- blocks -----
  asKpis(b: Block) {
    return b as Extract<Block, { type: 'kpis' }>;
  }
  asTable(b: Block) {
    return b as Extract<Block, { type: 'table' }>;
  }
  asChart(b: Block) {
    return b as Extract<Block, { type: 'chart' }>;
  }

  filteredRows(t: Extract<Block, { type: 'table' }>, key: string) {
    const q = (this.tableSearch[key] || '').trim().toLowerCase();
    if (!q) return t.rows;
    return t.rows.filter((r) => r.some((cell) => String(cell ?? '').toLowerCase().includes(q)));
  }

  initials(name: any): string {
    const parts = String(name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  limitFor(key: string) {
    return this.tableLimit[key] ?? 8;
  }
  showMore(key: string, total: number) {
    this.tableLimit[key] = total;
  }

  openProfile(id: number | null | undefined) {
    if (!id) return;
    if (!this.expanded()) this.closePanel();
    this.router.navigate(['/employees', id, 'profile']);
  }

  exportCsv(t: Extract<Block, { type: 'table' }>) {
    const cell = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [t.columns.map(cell).join(','), ...t.rows.map((r) => r.map(cell).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv' }));
    a.download = `ask-mira-${t.title.replace(/[^\w]+/g, '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  chartMax(c: { values: number[] }) {
    return Math.max(1, ...c.values);
  }
  linePoints(c: { values: number[] }) {
    const max = this.chartMax(c),
      n = c.values.length;
    return c.values.map((v, i) => `${n === 1 ? 0 : (i / (n - 1)) * 100},${38 - (v / max) * 32}`).join(' ');
  }
  areaPoints(c: { values: number[] }) {
    return `0,40 ${this.linePoints(c)} 100,40`;
  }
}
