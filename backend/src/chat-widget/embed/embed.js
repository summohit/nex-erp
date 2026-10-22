/*
 * Nex chat & help widget.
 *
 *   <script src="https://<api>/public/chat-widget/embed.js" data-widget-key="<key>" async></script>
 *
 * Optional attributes: data-source="CAREERS" (tells the bot it's on the careers
 * page), data-api="https://<api>" (defaults to the script's own origin+path),
 * data-theme="light" | "dark" | "auto" (auto follows the visitor's system setting; default light).
 * Everything renders inside a shadow root so the host site's CSS can't touch
 * it and ours can't leak out. No dependencies.
 */
(function () {
  'use strict';
  var script = document.currentScript || document.querySelector('script[data-widget-key]');
  if (!script || window.__nexChatLoaded) return;
  window.__nexChatLoaded = true;

  var WIDGET_KEY = script.getAttribute('data-widget-key');
  var SOURCE = (script.getAttribute('data-source') || 'WEBSITE').toUpperCase();
  var POSITION = script.getAttribute('data-position');
  var THEME = (script.getAttribute('data-theme') || 'light').toLowerCase();
  var API = (script.getAttribute('data-api') || script.src.replace(/\/public\/chat-widget\/embed\.js.*$/, '')).replace(/\/$/, '');
  var BASE = API + '/public/chat-widget/' + encodeURIComponent(WIDGET_KEY);
  if (!WIDGET_KEY) return;

  // ─── storage (may throw in private mode) ───
  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  var visitorId = store('nexchat_vid');
  if (!visitorId) {
    visitorId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    store('nexchat_vid', visitorId);
  }

  function api(path, opts) {
    opts = opts || {};
    return fetch(BASE + path, {
      method: opts.method || 'GET',
      // FormData (file uploads) sets its own multipart header.
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.form || (opts.body ? JSON.stringify(opts.body) : undefined),
      credentials: 'omit',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error((data && data.message) || 'Something went wrong. Please try again.');
        return data;
      });
    });
  }

  // ─── tiny safe markdown: escape first, then bold/italic/links/lists ───
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inline(s) {
    return s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }
  function md(text) {
    var lines = esc(text).split(/\r?\n/), out = [], list = null;
    lines.forEach(function (line) {
      var m = line.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)$/);
      var h = line.match(/^#{1,4}\s+(.*)$/);
      if (m) { if (!list) { list = []; } list.push('<li>' + inline(m[1]) + '</li>'); return; }
      if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; }
      if (h) out.push('<p class="h">' + inline(h[1]) + '</p>');
      else if (line.trim()) out.push('<p>' + inline(line) + '</p>');
    });
    if (list) out.push('<ul>' + list.join('') + '</ul>');
    return out.join('');
  }
  /** "Today" / "Yesterday" / "12 Oct" when iso falls on a new day, else null. */
  function dayLabel(iso, lastDay) {
    var d = new Date(iso);
    if (isNaN(d.getTime()) || d.toDateString() === lastDay) return null;
    var now = new Date(), y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    try { return d.toLocaleDateString([], { day: 'numeric', month: 'short' }); } catch (e) { return d.toDateString(); }
  }
  function time(iso) {
    try {
      var d = new Date(iso);
      var day = d.toLocaleDateString([], { weekday: 'short' });
      var t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return day + ' ' + t;
    } catch (e) {
      return '';
    }
  }

  var DEFAULT_AVATAR_SVG = '<svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="#F2CB67"/><path d="M18 9C13.58 9 10 12.58 10 17C10 19.8 11.45 22.25 13.68 23.68C13.88 23.81 14 24.03 14 24.27V25.5C14 25.78 14.22 26 14.5 26H21.5C21.78 26 22 25.78 22 25.5V24.27C22 24.03 22.12 23.81 22.32 23.68C24.55 22.25 26 19.8 26 17C26 12.58 22.42 9 18 9Z" fill="#5C42FD"/><circle cx="15.5" cy="16.5" r="1.5" fill="#FFFFFF"/><circle cx="20.5" cy="16.5" r="1.5" fill="#FFFFFF"/><path d="M16 19.5C16.8 20.3 19.2 20.3 20 19.5" stroke="#FFFFFF" stroke-width="1.3" stroke-linecap="round"/></svg>';

  function avatarHtml(c) {
    if (c && c.botAvatarUrl) {
      return '<img src="' + esc(c.botAvatarUrl) + '" alt="' + esc(c.botName || 'Bot') + '">';
    }
    return DEFAULT_AVATAR_SVG;
  }

  var ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
    volumeOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>',
    volumeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>',
    endChat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
    smile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
    clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
  };

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.launcher{position:fixed;bottom:24px;width:60px;height:60px;border-radius:50%;border:0;background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 75%,#0f172a));color:#fff;cursor:pointer;box-shadow:0 10px 28px -4px rgba(15,23,42,.32),0 0 0 1px rgba(255,255,255,.18) inset;display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .25s cubic-bezier(.16,1,.3,1),box-shadow .25s ease;animation:launcherEntrance .65s cubic-bezier(.34,1.56,.64,1) both,nexAttentionWiggle 7s ease-in-out infinite .7s}',
    '.launcher::before,.launcher::after{content:"";position:absolute;inset:-4px;border-radius:50%;background:var(--c);opacity:.35;z-index:-1;animation:nexPulse 2.6s cubic-bezier(.24,0,.38,1) infinite}',
    '.launcher::after{animation-delay:1.3s;inset:-8px;opacity:.2}',
    '@keyframes nexPulse{0%{transform:scale(.92);opacity:.45}50%{transform:scale(1.24);opacity:0}100%{transform:scale(.92);opacity:0}}',
    '@keyframes launcherEntrance{0%{transform:scale(0) translateY(45px);opacity:0}65%{transform:scale(1.18) translateY(-8px);opacity:1}85%{transform:scale(.94) translateY(2px)}100%{transform:scale(1) translateY(0);opacity:1}}',
    '@keyframes nexAttentionWiggle{0%,82%,100%{transform:scale(1) rotate(0deg)}85%{transform:scale(1.12) translateY(-6px) rotate(-8deg)}88%{transform:scale(1.12) translateY(-6px) rotate(8deg)}91%{transform:scale(1.06) translateY(-3px) rotate(-4deg)}94%{transform:scale(1.03) translateY(-1px) rotate(2deg)}97%{transform:scale(1) rotate(0deg)}}',
    '.launcher:hover{transform:scale(1.08) translateY(-2px);box-shadow:0 16px 36px -4px rgba(15,23,42,.38),0 0 24px color-mix(in srgb,var(--c) 45%,transparent)}',
    '.launcher:active{transform:scale(.94)}',
    '.launcher svg{width:26px;height:26px;transition:transform .3s cubic-bezier(.34,1.56,.64,1)}',
    '.launcher.open svg{transform:rotate(90deg)}',
    '.br{right:24px}.bl{left:24px}',
    '.badge{position:absolute;top:-2px;right:-2px;min-width:21px;height:21px;padding:0 6px;border-radius:11px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(239,68,68,.4);animation:badgePop .3s cubic-bezier(.16,1,.3,1)}',
    '@keyframes badgePop{from{transform:scale(0)}to{transform:scale(1)}}',
    '.teaser{position:fixed;bottom:96px;background:#ffffff;border-radius:18px;padding:12px 14px;box-shadow:0 14px 34px -4px rgba(15,23,42,.22),0 0 0 1px rgba(0,0,0,.06);display:flex;align-items:center;gap:10px;max-width:320px;cursor:pointer;z-index:2147483645;animation:teaserPop .4s cubic-bezier(.16,1,.3,1) both;transition:transform .2s ease,box-shadow .2s ease,opacity .25s ease;user-select:none}',
    '.teaser.br{right:24px}.teaser.bl{left:24px}',
    '.teaser:hover{transform:translateY(-2px);box-shadow:0 18px 40px -4px rgba(15,23,42,.28)}',
    '.teaser::after{content:"";position:absolute;bottom:-6px;width:12px;height:12px;background:#fff;transform:rotate(45deg);box-shadow:2px 2px 3px rgba(0,0,0,.04)}',
    '.teaser.br::after{right:24px}.teaser.bl::after{left:24px}',
    '.teaser-av{width:36px;height:36px;border-radius:50%;overflow:hidden;flex:none;background:#f2cb67;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.08)}',
    '.teaser-av img{width:100%;height:100%;object-fit:cover}',
    '.teaser-av svg{width:100%;height:100%}',
    '.teaser-txt{flex:1;min-width:0}',
    '.teaser-author{font-size:11.5px;font-weight:700;color:var(--c);display:flex;align-items:center;gap:4px;margin-bottom:2px}',
    '.teaser-msg{font-size:12.5px;color:#0f172a;line-height:1.38;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-weight:500}',
    '.teaser-x{background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;transition:color .12s,background .12s}',
    '.teaser-x:hover{color:#0f172a;background:#f1f5f9}',
    '@keyframes teaserPop{from{opacity:0;transform:translateY(14px) scale(.88)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '.panel{position:fixed;bottom:98px;width:390px;height:min(640px,calc(100vh - 120px));background:#fff;border-radius:20px;box-shadow:0 24px 60px -12px rgba(15,23,42,.28),0 0 0 1px rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden;z-index:2147483647;opacity:0;transform:translateY(22px) scale(.92);transform-origin:bottom right;pointer-events:none;transition:opacity .32s cubic-bezier(.16,1,.3,1),transform .35s cubic-bezier(.34,1.4,.64,1);color:#0f172a;font-size:14px;line-height:1.45}',
    '.panel.bl{transform-origin:bottom left}',
    '.panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
    '@media (max-width:480px){.panel{left:0!important;right:0!important;bottom:0;width:100%!important;height:100%!important;border-radius:0!important;max-height:100%}.panel.open~.launcher{display:none}}',
    '.head{background:linear-gradient(135deg,var(--c) 0%,color-mix(in srgb,var(--c) 80%,#0f172a) 100%);color:#fff;padding:14px 16px 12px;display:flex;align-items:center;gap:10px;position:relative;box-shadow:0 4px 12px rgba(0,0,0,.06);user-select:none}',
    '.avatar{width:40px;height:40px;border-radius:50%;background:#f2cb67;display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;position:relative;box-shadow:0 0 0 2px rgba(255,255,255,.35),0 3px 8px rgba(0,0,0,.15)}',
    '.avatar img{width:100%;height:100%;object-fit:cover}.avatar svg{width:100%;height:100%}',
    '.avatar-online-dot{position:absolute;bottom:0;right:0;width:11px;height:11px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 0 6px #10b981}',
    '.ht{flex:1;min-width:0}',
    '.ht b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ht-status-line{display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.92;margin-top:2px}',
    '.ht-live-dot{width:6px;height:6px;border-radius:50%;background:#34d399;animation:liveBlink 1.8s infinite ease-in-out}',
    '.seen{font-size:10.5px;color:#94a3b8;text-align:right;margin-top:2px;animation:nexMsgSlide .2s ease-out both}',
    '.offline-note{align-self:stretch;margin:0 4px 10px;padding:10px 12px;border-radius:12px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:12.5px;line-height:1.45;text-align:center}',
    '.ht-offline-dot{width:6px;height:6px;border-radius:50%;background:#cbd5e1;opacity:.8}',
    '@keyframes liveBlink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.85)}}',
    '.head-actions{display:flex;align-items:center;gap:3px;flex:none}',
    '.icon-btn{background:transparent;border:0;color:inherit;cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:background-color .15s,transform .1s}',
    '.icon-btn:hover{background:rgba(255,255,255,.2);transform:scale(1.05)}',
    '.icon-btn:active{transform:scale(.95)}',
    '.icon-btn svg{width:18px;height:18px}',
    '.sound-btn svg{width:17px;height:17px}',
    '.end-btn:hover{background:rgba(239,68,68,.35)!important}',
    '.tabs{display:flex;border-bottom:1px solid #e2e8f0;background:#fff;padding:0 8px}',
    '.tab{flex:1;border:0;background:none;padding:12px 8px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;border-bottom:2px solid transparent;transition:all .15s ease}',
    '.tab svg{width:16px;height:16px;transition:color .15s}.tab:hover{color:#0f172a}',
    '.tab.on{color:var(--c);border-bottom-color:var(--c)}',
    '.body{flex:1;overflow-y:auto;background:#ffffff;scroll-behavior:smooth}',
    '.date-divider{display:flex;align-items:center;justify-content:center;margin:8px 0 16px;user-select:none}',
    '.date-pill{background:#eae8f0;color:#475569;font-size:12px;font-weight:500;padding:4px 16px;border-radius:999px;letter-spacing:-.01em;box-shadow:0 1px 2px rgba(0,0,0,.02)}',
    '.msgs{padding:14px 16px;display:flex;flex-direction:column;gap:16px}',
    '.row{display:flex;width:100%;box-sizing:border-box;position:relative}',
    '.row.new-anim{animation:nexMsgSlide .22s cubic-bezier(.16,1,.3,1) both}',
    '@keyframes nexMsgSlide{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '.row:not(.me){align-items:flex-end;gap:10px}',
    '.msg-avatar{width:32px;height:32px;border-radius:50%;overflow:hidden;flex:none;background:#f2cb67;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:18px}',
    '.msg-avatar img{width:100%;height:100%;object-fit:cover}',
    '.msg-avatar svg{width:100%;height:100%}',
    '.msg-col{display:flex;flex-direction:column;max-width:calc(100% - 44px);position:relative}',
    '.who{font-size:11px;font-weight:600;color:#64748b;margin:0 4px 4px}',
    '.bubble{padding:12px 16px;border-radius:20px;word-wrap:break-word;overflow-wrap:anywhere;font-size:14px;line-height:1.48;position:relative}',
    '.row:not(.me) .bubble{background:#dfe3e7;color:#0f172a;border-radius:20px 20px 20px 6px;box-shadow:0 1px 2px rgba(15,23,42,.03)}',
    '.bubble-tooltip{position:absolute;top:-22px;left:6px;background:#374151;color:#ffffff;padding:2px 7px;border-radius:5px;font-size:10.5px;font-weight:500;letter-spacing:-.01em;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;transform:translateY(3px);box-shadow:0 3px 8px rgba(0,0,0,.18);z-index:10}',
    '.bubble:hover .bubble-tooltip{opacity:1;transform:translateY(0)}',
    '.row.me{justify-content:flex-end}',
    '.row.me .msg-col{display:flex;flex-direction:column;align-items:flex-end;max-width:86%}',
    '.row.me .bubble{background:#f2cb67;color:#0f172a;border-radius:20px 20px 6px 20px;padding:11px 18px;font-weight:500;box-shadow:0 1px 4px rgba(242,203,103,.35)}',
    '.bubble p{margin:0 0 6px}.bubble p:last-child{margin:0}.bubble p.h{font-weight:700}.bubble ul{margin:4px 0 6px;padding-left:18px}.bubble a{color:inherit;text-decoration:underline;font-weight:600}.bubble code{background:rgba(15,23,42,.08);padding:1px 5px;border-radius:4px;font-family:ui-monospace,monospace;font-size:12px}',
    '.sys{align-self:center;max-width:92%;text-align:center;font-size:12px;color:#475569;background:#eef2f7;padding:6px 14px;border-radius:12px;margin:4px 0}',
    '.ts{font-size:11px;color:#64748b;margin:5px 2px 0;letter-spacing:-.01em;font-weight:400}',
    '.row.me .ts{text-align:right;margin:5px 4px 0 0}',
    '.pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '.pill{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;max-width:100%;transition:all .16s cubic-bezier(.16,1,.3,1);box-shadow:0 1px 2px rgba(15,23,42,.04)}',
    '.pills.anim .pill{animation:pillPopIn .3s cubic-bezier(.34,1.56,.64,1) both}',
    '.pills.anim .pill:nth-child(1){animation-delay:.06s}.pills.anim .pill:nth-child(2){animation-delay:.12s}.pills.anim .pill:nth-child(3){animation-delay:.18s}.pills.anim .pill:nth-child(4){animation-delay:.24s}',
    '@keyframes pillPopIn{from{opacity:0;transform:translateY(8px) scale(.92)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '.pill svg{width:13px;height:13px;flex:none;color:var(--c)}.pill span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pill:hover{border-color:var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 6%,#fff);transform:translateY(-1px);box-shadow:0 4px 10px rgba(15,23,42,.08)}',
    '.pill:active{transform:scale(.97)}',
    '.typing-bubble{background:#dfe3e7;border-radius:20px 20px 20px 6px;padding:12px 16px;display:inline-flex;align-items:center;gap:5px;box-shadow:0 1px 2px rgba(15,23,42,.03);width:fit-content}',
    '.typing-bubble span{width:7px;height:7px;border-radius:50%;background:#475569;opacity:.4;animation:nexDotBounce 1.3s infinite ease-in-out}',
    '.typing-bubble span:nth-child(2){animation-delay:.16s}',
    '.typing-bubble span:nth-child(3){animation-delay:.32s}',
    '@keyframes nexDotBounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-5px);opacity:1}}',
    '.form{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:14px;display:flex;flex-direction:column;gap:10px;align-self:stretch;box-shadow:0 2px 6px rgba(15,23,42,.04);animation:nexMsgSlide .2s ease-out}',
    '.form b{font-size:13px;color:#0f172a;line-height:1.45}.form input{border:1px solid #cbd5e1;border-radius:9px;padding:9px 12px;font-size:13.5px;outline:none;width:100%;color:#0f172a;background:#fff;transition:border-color .15s}',
    '.form input:focus{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 15%,transparent)}',
    '.btn{background:var(--c);color:#fff;border:0;border-radius:9px;padding:10px 14px;font-weight:600;font-size:13px;cursor:pointer;transition:all .15s;box-shadow:0 1px 3px rgba(15,23,42,.1)}',
    '.btn:hover:not(:disabled){transform:translateY(-1px);filter:brightness(1.05);box-shadow:0 3px 8px rgba(15,23,42,.15)}',
    '.btn:disabled{opacity:.6;cursor:default}',
    '.err{color:#dc2626;font-size:12px}',
    '.emoji-pop{position:absolute;bottom:64px;left:12px;right:12px;display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:8px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 12px 28px -6px rgba(15,23,42,.22);z-index:20;animation:menuPop .16s cubic-bezier(.16,1,.3,1) both}',
    '.emoji{border:0;background:none;font-size:20px;line-height:1;padding:6px 0;border-radius:8px;cursor:pointer}.emoji:hover{background:#f1f5f9}',
    '.dk .emoji-pop{background:#1e293b;border-color:#334155}.dk .emoji:hover{background:#334155}',
    '.compose{position:relative;display:flex;gap:8px;padding:12px 14px;border-top:1px solid #e2e8f0;background:#fff;align-items:flex-end}',
    '.compose textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:9px 12px;font-size:13.5px;line-height:1.45;max-height:110px;min-height:42px;outline:none;color:#0f172a;background:#f8fafc;transition:all .15s ease}',
    '.attach{width:38px;height:42px;border-radius:12px;border:0;background:transparent;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:color .15s,background .15s}',
    '.attach svg{width:19px;height:19px}.attach:hover{color:var(--c);background:color-mix(in srgb,var(--c) 8%,transparent)}.attach:disabled{opacity:.4;cursor:default}',
    '.att-img{display:block;max-width:220px;max-height:220px;border-radius:12px;object-fit:cover;cursor:zoom-in}',
    '.att-file{display:flex;align-items:center;gap:10px;padding:2px 0;color:inherit;text-decoration:none;min-width:0}',
    '.att-file .att-ico{width:34px;height:34px;border-radius:9px;background:rgba(15,23,42,.08);display:flex;align-items:center;justify-content:center;flex:none}',
    '.att-file .att-ico svg{width:17px;height:17px}',
    '.att-file b{display:block;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px}',
    '.att-file small{display:block;font-size:11px;opacity:.7}',
    '.att-uploading{font-size:12.5px;opacity:.8}',
    '.compose textarea:focus{border-color:var(--c);background:#fff;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 15%,transparent)}',
    '.send{width:42px;height:42px;border-radius:12px;border:0;background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 82%,#0f172a));color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;transition:all .15s;box-shadow:0 2px 6px color-mix(in srgb,var(--c) 30%,transparent)}',
    '.send:hover:not(:disabled){transform:scale(1.05);box-shadow:0 4px 10px color-mix(in srgb,var(--c) 40%,transparent)}',
    '.send:active:not(:disabled){transform:scale(.94)}',
    '.send:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none}',
    '.send svg{width:18px;height:18px}',
    '.foot{text-align:center;font-size:11px;color:#94a3b8;padding:8px 12px;background:#fff;border-top:1px solid #f1f5f9;display:flex;align-items:center;justify-content:center;gap:6px;user-select:none}',
    '.foot strong{color:var(--c);font-weight:700;letter-spacing:.02em}',
    '.foot-sparkle{width:12px;height:12px;color:#f59e0b;display:inline-flex;align-items:center}',
    '.foot-sparkle svg{width:100%;height:100%}',
    '.kb{padding:16px}',
    '.search{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid #cbd5e1;border-radius:12px;padding:0 12px;margin-bottom:14px;transition:all .15s}',
    '.search:focus-within{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 15%,transparent)}',
    '.search svg{width:16px;height:16px;color:#94a3b8;flex:none}',
    '.search input{border:0;outline:none;padding:10px 0;font-size:13.5px;flex:1;background:transparent;color:#0f172a}',
    '.cat{margin-bottom:18px}.cat h4{margin:0 0 8px;font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:700}',
    '.art{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;background:#fff;border:1px solid #e2e8f0;border-radius:11px;padding:11px 13px;margin-bottom:7px;cursor:pointer;color:#0f172a;font-size:13.5px;transition:all .15s ease;box-shadow:0 1px 2px rgba(15,23,42,.03);animation:nexMsgSlide .26s cubic-bezier(.16,1,.3,1) both}',
    '.art:nth-child(2){animation-delay:.04s}.art:nth-child(3){animation-delay:.08s}.art:nth-child(4){animation-delay:.12s}.art:nth-child(5){animation-delay:.16s}.art:nth-child(n+6){animation-delay:.2s}',
    '.art:hover{border-color:var(--c);transform:translateY(-1px);box-shadow:0 3px 8px rgba(15,23,42,.07)}.art svg{width:16px;height:16px;color:var(--c);flex:none;margin-top:2px}.art small{display:block;color:#64748b;font-size:12px;margin-top:2px}',
    '.reader{padding:18px;animation:nexMsgSlide .2s ease-out}.reader h3{margin:8px 0 14px;font-size:18px;font-weight:700;color:#0f172a}.reader .bubble{border:0;background:none;padding:0;box-shadow:none}',
    '.back{display:inline-flex;align-items:center;gap:5px;border:0;background:none;color:var(--c);cursor:pointer;font-size:13px;padding:0;font-weight:600;margin-bottom:6px}.back svg{width:16px;height:16px}',
    '.vote{margin-top:22px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.empty{text-align:center;color:#64748b;font-size:13px;padding:28px 12px}',
    /* End Chat & Session Management Styles */
    '.menu-popover{position:absolute;top:56px;right:14px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 12px 28px -4px rgba(15,23,42,.2),0 0 0 1px rgba(0,0,0,.05);padding:6px;min-width:186px;z-index:30;display:flex;flex-direction:column;gap:2px;animation:menuPop .15s cubic-bezier(.16,1,.3,1)}',
    '@keyframes menuPop{from{transform:scale(.92) translateY(-6px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}',
    '.menu-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border:0;background:none;width:100%;text-align:left;font-size:13px;font-weight:500;color:#334155;border-radius:8px;cursor:pointer;transition:all .12s}',
    '.menu-item svg{width:16px;height:16px;flex:none;color:#64748b}',
    '.menu-item:hover{background:#f1f5f9;color:#0f172a}',
    '.menu-item.danger{color:#dc2626}',
    '.menu-item.danger svg{color:#dc2626}',
    '.menu-item.danger:hover{background:#fef2f2}',
    '.confirm-modal{position:absolute;inset:0;background:rgba(15,23,42,.45);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;z-index:40;padding:20px;animation:modalFadeIn .18s ease-out}',
    '@keyframes modalFadeIn{from{opacity:0}to{opacity:1}}',
    '.confirm-box{background:#fff;border-radius:16px;padding:22px;max-width:320px;width:100%;box-shadow:0 20px 40px rgba(0,0,0,.22);text-align:center;animation:modalPop .2s cubic-bezier(.16,1,.3,1)}',
    '@keyframes modalPop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}',
    '.confirm-title{font-size:16px;font-weight:700;color:#0f172a;margin-bottom:6px}',
    '.confirm-desc{font-size:13px;color:#64748b;line-height:1.45;margin-bottom:18px}',
    '.confirm-actions{display:flex;gap:10px;justify-content:center}',
    '.btn-cancel{flex:1;background:#f1f5f9;color:#475569;border:0;border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer;transition:background-color .15s}',
    '.btn-cancel:hover{background:#e2e8f0}',
    '.btn-danger{flex:1;background:#ef4444;color:#fff;border:0;border-radius:9px;padding:9px 12px;font-size:13px;font-weight:600;cursor:pointer;transition:all .15s;box-shadow:0 2px 6px rgba(239,68,68,.3)}',
    '.btn-danger:hover{filter:brightness(.92);transform:translateY(-1px)}',
    '.ended-card{margin:14px auto 6px;padding:16px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:14px;text-align:center;max-width:92%;display:flex;flex-direction:column;align-items:center;gap:8px;box-shadow:0 1px 3px rgba(15,23,42,.04)}',
    '.ended-card.anim{animation:nexMsgSlide .3s cubic-bezier(.16,1,.3,1) both}.ended-card.anim .ended-icon{animation:badgePop .35s .12s cubic-bezier(.34,1.56,.64,1) both}',
    '.ended-icon{width:32px;height:32px;border-radius:50%;background:#e2e8f0;color:#10b981;display:flex;align-items:center;justify-content:center}',
    '.ended-icon svg{width:18px;height:18px}',
    '.ended-text strong{font-size:13.5px;color:#1e293b;display:block}',
    '.ended-text p{margin:3px 0 0;font-size:12px;color:#64748b}',
    '.btn-new-chat{margin-top:4px;background:var(--c);color:#fff;border:0;border-radius:9px;padding:9px 15px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .15s;box-shadow:0 2px 6px color-mix(in srgb,var(--c) 25%,transparent)}',
    '.btn-new-chat svg{width:14px;height:14px}',
    '.btn-new-chat:hover{filter:brightness(1.08);transform:translateY(-1px);box-shadow:0 4px 10px color-mix(in srgb,var(--c) 35%,transparent)}',
    '.compose-ended{padding:14px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;color:#64748b;animation:composeUp .28s cubic-bezier(.16,1,.3,1) both}',
    '@keyframes composeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}'
  ].join('\n');

  // Dark theme: the same layout with surfaces, text and borders swapped. Applied
  // by the .dk class on the wrapper (see applyTheme). Brand colour stays as set.
  var DARK_CSS = [
    '.dk .panel{background:#0f172a;color:#e2e8f0;box-shadow:0 24px 60px -12px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.08)}',
    '.dk .teaser,.dk .teaser::after{background:#1e293b}.dk .teaser-msg{color:#e2e8f0}',
    '.dk .tabs{background:#0f172a;border-bottom-color:#1e293b}.dk .tab:hover{color:#f8fafc}',
    '.dk .body{background:#0f172a}',
    '.dk .date-pill{background:#1e293b;color:#94a3b8}',
    '.dk .row:not(.me) .bubble{background:#1e293b;color:#e2e8f0}',
    '.dk .row:not(.me) .bubble a{color:#93c5fd}',
    '.dk .sys{background:#1e293b;color:#94a3b8}',
    '.dk .pill{background:#1e293b;border-color:#334155;color:#e2e8f0}',
    '.dk .pill:hover{background:color-mix(in srgb,var(--c) 18%,#1e293b)}',
    '.dk .typing-bubble{background:#1e293b}.dk .typing-bubble span{background:#94a3b8}',
    '.dk .form{background:#1e293b;border-color:#334155}.dk .form b{color:#f1f5f9}',
    '.dk .form input{background:#0f172a;border-color:#334155;color:#e2e8f0}',
    '.dk .compose{background:#0f172a;border-top-color:#1e293b}',
    '.dk .compose textarea{background:#1e293b;border-color:#334155;color:#e2e8f0}.dk .compose textarea::placeholder{color:#64748b}',
    '.dk .compose textarea:focus{background:#1e293b}',
    '.dk .attach{color:#94a3b8}',
    '.dk .att-file .att-ico{background:rgba(255,255,255,.08)}',
    '.dk .foot{background:#0f172a;border-top-color:#1e293b;color:#64748b}',
    '.dk .search{background:#1e293b;border-color:#334155}.dk .search input{color:#e2e8f0}',
    '.dk .art{background:#1e293b;border-color:#334155;color:#e2e8f0}',
    '.dk .reader h3{color:#f8fafc}.dk .vote{border-top-color:#1e293b;color:#94a3b8}',
    '.dk .menu-popover{background:#1e293b;border-color:#334155}',
    '.dk .menu-item{color:#cbd5e1}.dk .menu-item:hover{background:#334155}',
    '.dk .confirm-box{background:#1e293b}.dk .confirm-title{color:#f8fafc}',
    '.dk .btn-cancel{background:#334155;color:#e2e8f0}.dk .btn-cancel:hover{background:#475569}',
    '.dk .ended-card{background:#1e293b;border-color:#334155}.dk .ended-icon{background:#334155}',
    '.dk .ended-text strong{color:#f1f5f9}.dk .ended-text p{color:#94a3b8}',
    '.dk .compose-ended{background:#111827;border-top-color:#1e293b;color:#94a3b8}',
    '.dk .badge{border-color:#0f172a}',
    '.dk .offline-note{background:#2a1a0e;border-color:#7c2d12;color:#fdba74}',
  ].join('\n');

  // ─── Sound System (Synthesized via Web Audio API) ───
  var audioCtx = null;
  var soundEnabled = store('nexchat_sound') !== '0';

  function getAudioCtx() {
    try {
      if (!audioCtx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      return audioCtx;
    } catch (e) {
      return null;
    }
  }

  function playSound(type) {
    if (!soundEnabled) return;
    try {
      var ctx = getAudioCtx();
      if (!ctx) return;
      var now = ctx.currentTime;
      if (type === 'send') {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(460, now);
        osc.frequency.exponentialRampToValueAtTime(240, now + 0.08);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'receive') {
        var notes = [554.37, 830.61];
        notes.forEach(function (freq, i) {
          var o = ctx.createOscillator();
          var g = ctx.createGain();
          o.type = 'sine';
          var st = now + (i * 0.08);
          o.frequency.setValueAtTime(freq, st);
          g.gain.setValueAtTime(0, st);
          g.gain.linearRampToValueAtTime(0.14, st + 0.015);
          g.gain.exponentialRampToValueAtTime(0.001, st + 0.28);
          o.connect(g);
          g.connect(ctx.destination);
          o.start(st);
          o.stop(st + 0.3);
        });
      }
    } catch (e) { }
  }

  // ─── state ───
  var cfg = null, conv = null, msgs = [], lastId = 0, open = false, tab = 'chat', unread = 0;
  var startersAnimatedFor = null, endedAnimatedFor = null; // conversations whose starter pills / ended card already animated in
  var sending = false, pollTimer = null, formFor = null, kbCache = null, article = null;
  var animatedIds = {};
  var openKey = 'nexchat_open';

  // ─── mount ───
  var host = document.createElement('div');
  host.id = 'nex-chat-widget';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var style = document.createElement('style');
  style.textContent = CSS + '\n' + DARK_CSS;
  root.appendChild(style);
  var wrap = document.createElement('div');
  root.appendChild(wrap);

  /** light | dark | auto (follows the visitor's system and updates when it changes). */
  function applyTheme() {
    var dark = THEME === 'dark' ||
      (THEME === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    wrap.classList.toggle('dk', !!dark);
  }
  applyTheme();
  if (THEME === 'auto' && window.matchMedia) {
    var themeMq = window.matchMedia('(prefers-color-scheme: dark)');
    if (themeMq.addEventListener) themeMq.addEventListener('change', applyTheme);
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var panel, bodyEl, launcher, badgeEl, composeEl, composeEndedEl, inputEl, sendBtn, attachBtn, tabsEl;
  var ATTACH_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,.heic,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt';
  var MAX_ATTACH = 10 * 1024 * 1024;
  var EMOJIS = '😀 😊 😂 🙂 😉 😍 🤔 😅 😢 😮 😎 🙏 👍 👎 👏 🙌 👋 🤝 💪 👀 ❤️ 🎉 ✅ ❌ ⭐ 🔥 💡 📎 📄 📞 📧 📅 ⏰ 💼 🚀'.split(' ');

  /** Put text where the caret is (or at the end) and keep typing from there. */
  function insertAtCursor(input, text) {
    var start = input.selectionStart == null ? input.value.length : input.selectionStart;
    var end = input.selectionEnd == null ? start : input.selectionEnd;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    input.focus();
    input.selectionStart = input.selectionEnd = start + text.length;
    input.dispatchEvent(new Event('input'));
  }
  var endBtn, moreBtn, soundBtn, menuPopover, confirmModal, teaserEl;

  function build() {
    wrap.style.setProperty('--c', cfg.primaryColor || '#2563EB');
    var side = (POSITION || cfg.position) === 'bl' ? 'bl' : 'br';

    panel = el('div', 'panel ' + side);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', cfg.headerTitle);
    var head = el('div', 'head');
    var av = el('div', 'avatar');
    av.innerHTML = avatarHtml(cfg);
    var dot = el('span', 'avatar-online-dot');
    av.appendChild(dot);
    var ht = el('div', 'ht', '<b>' + esc(cfg.headerTitle) + '</b><div class="ht-status-line">' + statusLineHtml() + '</div>');
    
    var headActions = el('div', 'head-actions');

    soundBtn = el('button', 'icon-btn sound-btn', soundEnabled ? ICONS.volumeOn : ICONS.volumeOff);
    soundBtn.setAttribute('aria-label', soundEnabled ? 'Mute sounds' : 'Unmute sounds');
    soundBtn.title = soundEnabled ? 'Mute sounds' : 'Unmute sounds';
    soundBtn.onclick = function (e) {
      e.stopPropagation();
      soundEnabled = !soundEnabled;
      store('nexchat_sound', soundEnabled ? '1' : '0');
      soundBtn.innerHTML = soundEnabled ? ICONS.volumeOn : ICONS.volumeOff;
      soundBtn.title = soundEnabled ? 'Mute sounds' : 'Unmute sounds';
      if (soundEnabled) playSound('send');
    };

    endBtn = el('button', 'icon-btn end-btn', ICONS.endChat);
    endBtn.setAttribute('aria-label', 'End chat conversation');
    endBtn.title = 'End chat';
    endBtn.onclick = function (e) {
      e.stopPropagation();
      closeMenu();
      confirmEndChat();
    };

    moreBtn = el('button', 'icon-btn more-btn', ICONS.more);
    moreBtn.setAttribute('aria-label', 'Chat options');
    moreBtn.title = 'More options';
    moreBtn.onclick = function (e) {
      e.stopPropagation();
      toggleMenu();
    };

    var closeBtn = el('button', 'icon-btn close-btn', ICONS.close);
    closeBtn.setAttribute('aria-label', 'Close chat');
    closeBtn.title = 'Minimize chat';
    closeBtn.onclick = function () { closeMenu(); toggle(false); };

    headActions.appendChild(soundBtn);
    headActions.appendChild(endBtn);
    headActions.appendChild(moreBtn);
    headActions.appendChild(closeBtn);

    head.appendChild(av);
    head.appendChild(ht);
    head.appendChild(headActions);

    // Options dropdown menu
    menuPopover = el('div', 'menu-popover');
    menuPopover.style.display = 'none';

    var miNew = el('button', 'menu-item', ICONS.refresh + '<span>New conversation</span>');
    miNew.onclick = function (e) {
      e.stopPropagation();
      closeMenu();
      startNewConversation();
    };
    var miEnd = el('button', 'menu-item danger', ICONS.endChat + '<span>End conversation</span>');
    miEnd.onclick = function (e) {
      e.stopPropagation();
      closeMenu();
      confirmEndChat();
    };
    var miSound = el('button', 'menu-item', (soundEnabled ? ICONS.volumeOff : ICONS.volumeOn) + '<span>' + (soundEnabled ? 'Mute sounds' : 'Enable sounds') + '</span>');
    miSound.onclick = function (e) {
      e.stopPropagation();
      soundBtn.click();
      miSound.innerHTML = (soundEnabled ? ICONS.volumeOff : ICONS.volumeOn) + '<span>' + (soundEnabled ? 'Mute sounds' : 'Enable sounds') + '</span>';
      closeMenu();
    };

    menuPopover.appendChild(miNew);
    menuPopover.appendChild(miEnd);
    menuPopover.appendChild(miSound);
    panel.appendChild(menuPopover);

    // Confirmation Modal for Ending Chat
    confirmModal = el('div', 'confirm-modal');
    confirmModal.style.display = 'none';
    confirmModal.innerHTML = 
      '<div class="confirm-box">' +
        '<div class="confirm-title">End conversation?</div>' +
        '<div class="confirm-desc">Are you sure you want to end this chat? You can start a fresh conversation whenever you like.</div>' +
        '<div class="confirm-actions">' +
          '<button class="btn-cancel" type="button">Cancel</button>' +
          '<button class="btn-danger" type="button">End Chat</button>' +
        '</div>' +
      '</div>';
    var cancelBtn = confirmModal.querySelector('.btn-cancel');
    var okEndBtn = confirmModal.querySelector('.btn-danger');
    cancelBtn.onclick = function () { confirmModal.style.display = 'none'; };
    okEndBtn.onclick = function () {
      confirmModal.style.display = 'none';
      endConversation();
    };
    panel.appendChild(confirmModal);

    tabsEl = el('div', 'tabs');
    [['chat', ICONS.chat + 'Chat'], ['help', ICONS.book + 'Help articles']].forEach(function (t) {
      var b = el('button', 'tab', t[1]);
      b.onclick = function () { setTab(t[0]); };
      b.dataset.t = t[0];
      tabsEl.appendChild(b);
    });

    bodyEl = el('div', 'body');
    composeEl = el('div', 'compose');
    inputEl = el('textarea');
    inputEl.rows = 1;
    inputEl.placeholder = 'Type your message…';
    inputEl.setAttribute('aria-label', 'Message');
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    inputEl.addEventListener('input', function () {
      pingTyping();
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(110, inputEl.scrollHeight) + 'px';
    });
    sendBtn = el('button', 'send', ICONS.send);
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.onclick = send;
    var fileInput = el('input');
    fileInput.type = 'file';
    fileInput.accept = ATTACH_ACCEPT;
    fileInput.style.display = 'none';
    fileInput.onchange = function () {
      var f = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (f) sendFile(f);
    };
    attachBtn = el('button', 'attach', ICONS.clip);
    attachBtn.setAttribute('aria-label', 'Attach a file');
    attachBtn.title = 'Attach an image or document (max 10 MB)';
    attachBtn.onclick = function () { fileInput.click(); };
    var emojiBtn = el('button', 'attach', ICONS.smile);
    emojiBtn.setAttribute('aria-label', 'Insert emoji');
    emojiBtn.title = 'Emoji';
    var emojiPop = el('div', 'emoji-pop');
    emojiPop.style.display = 'none';
    EMOJIS.forEach(function (e) {
      var b = el('button', 'emoji', e);
      b.type = 'button';
      b.onclick = function () { insertAtCursor(inputEl, e); };
      emojiPop.appendChild(b);
    });
    emojiBtn.onclick = function (ev) {
      ev.stopPropagation();
      emojiPop.style.display = emojiPop.style.display === 'none' ? 'grid' : 'none';
    };
    panel.addEventListener('click', function (ev) {
      if (emojiPop.style.display !== 'none' && !emojiPop.contains(ev.target)) emojiPop.style.display = 'none';
    });
    composeEl.appendChild(emojiPop);
    composeEl.appendChild(fileInput); composeEl.appendChild(attachBtn); composeEl.appendChild(emojiBtn);
    composeEl.appendChild(inputEl); composeEl.appendChild(sendBtn);

    composeEndedEl = el('div', 'compose-ended');
    composeEndedEl.style.display = 'none';
    composeEndedEl.innerHTML = '<span>Conversation ended</span>';

    panel.appendChild(head); panel.appendChild(tabsEl); panel.appendChild(bodyEl);
    panel.appendChild(composeEl);
    panel.appendChild(composeEndedEl);
    var footHtml = '<span class="foot-sparkle">' + ICONS.sparkle + '</span><span>Powered by <strong>MIRA</strong></span>';
    panel.appendChild(el('div', 'foot', footHtml));

    launcher = el('button', 'launcher ' + side, ICONS.chat);
    launcher.setAttribute('aria-label', 'Open chat');
    badgeEl = el('span', 'badge');
    badgeEl.style.display = 'none';
    launcher.appendChild(badgeEl);
    launcher.onclick = function () {
      dismissTeaser();
      toggle(!open);
    };

    // Proactive greeting teaser asking a question
    teaserEl = el('div', 'teaser ' + side);
    var tAv = el('div', 'teaser-av');
    tAv.innerHTML = avatarHtml(cfg);
    var tTxt = el('div', 'teaser-txt');
    var greetingQ = cfg.greetingMessage || "Hi there! How can we help you today?";
    tTxt.innerHTML = '<div class="teaser-author"><span>' + esc(cfg.botName || 'MIRA Assistant') + '</span></div><div class="teaser-msg">' + esc(greetingQ) + '</div>';
    var tClose = el('button', 'teaser-x', '✕');
    tClose.setAttribute('aria-label', 'Dismiss');
    tClose.onclick = function (e) {
      e.stopPropagation();
      dismissTeaser();
    };
    teaserEl.appendChild(tAv);
    teaserEl.appendChild(tTxt);
    teaserEl.appendChild(tClose);
    teaserEl.onclick = function () {
      dismissTeaser();
      toggle(true);
    };

    function showTeaser() {
      if (open || store('nexchat_dismissed') === '1') return;
      if (!teaserEl.parentNode) wrap.appendChild(teaserEl);
    }

    function dismissTeaser() {
      store('nexchat_dismissed', '1');
      if (teaserEl && teaserEl.parentNode) {
        teaserEl.style.opacity = '0';
        teaserEl.style.transform = 'translateY(10px) scale(0.9)';
        setTimeout(function () {
          if (teaserEl.parentNode) teaserEl.parentNode.removeChild(teaserEl);
        }, 220);
      }
    }

    wrap.appendChild(panel); wrap.appendChild(launcher);
    document.body.appendChild(host);

    // Global click listener to close popover menu
    document.addEventListener('click', function (e) {
      if (menuPopover && menuPopover.style.display === 'flex' && !menuPopover.contains(e.target)) {
        closeMenu();
      }
    });

    // Escape key listener to close popover or minimize chat
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && open) {
        if (confirmModal && confirmModal.style.display === 'flex') {
          confirmModal.style.display = 'none';
        } else if (menuPopover && menuPopover.style.display === 'flex') {
          closeMenu();
        } else {
          toggle(false);
        }
      }
    });

    // Automatic on-load sequence:
    // 1. Button springs in on load with ripple waves and wiggle.
    // 2. At 1.1s: Proactive teaser bubble pops in asking the greeting question.
    // 3. At 2.6s: If not previously dismissed by visitor, smoothly opens the chat box with question animation!
    if (store(openKey) === '1' && window.innerWidth > 480) {
      toggle(true);
    } else if (store('nexchat_dismissed') !== '1' && window.innerWidth > 480) {
      setTimeout(showTeaser, 1100);
      setTimeout(function () {
        if (!open && store('nexchat_dismissed') !== '1') {
          dismissTeaser();
          toggle(true);
        }
      }, 2600);
    }
  }

  function toggleMenu() {
    if (!menuPopover) return;
    var isShown = menuPopover.style.display === 'flex';
    menuPopover.style.display = isShown ? 'none' : 'flex';
  }

  function closeMenu() {
    if (menuPopover) menuPopover.style.display = 'none';
  }

  function confirmEndChat() {
    if (!conv || conv.status === 'RESOLVED' || conv.status === 'CLOSED') return;
    if (confirmModal) confirmModal.style.display = 'flex';
  }

  function endConversation() {
    if (!conv) return;
    api('/conversations/' + conv.id + '/close', { method: 'POST', body: { visitorId: visitorId } })
      .then(function (r) {
        if (r.conversation) conv = r.conversation;
        else conv.status = 'RESOLVED';
        var sysMsg = {
          id: lastId + 0.1,
          senderType: 'SYSTEM',
          senderName: 'System',
          message: 'The visitor ended the conversation.',
          createdAt: new Date().toISOString()
        };
        msgs.push(sysMsg);
        lastId = sysMsg.id;
        render();
      })
      .catch(function () {
        conv.status = 'RESOLVED';
        render();
      });
  }

  function startNewConversation() {
    conv = null;
    msgs = [];
    lastId = 0;
    formFor = null;
    animatedIds = {};
    render();
    api('/conversations', {
      method: 'POST',
      body: { visitorId: visitorId, source: SOURCE, pageUrl: location.href, referrer: document.referrer || null, forceNew: true },
    }).then(function (r) {
      merge(r);
      schedulePoll();
    }).catch(function (e) {
      if (bodyEl) bodyEl.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    });
  }

  function toggle(v) {
    open = v;
    store(openKey, v ? '1' : '0');
    if (!v) {
      store('nexchat_dismissed', '1');
    }
    if (v && teaserEl && teaserEl.parentNode) {
      teaserEl.parentNode.removeChild(teaserEl);
    }
    panel.classList.toggle('open', v);
    launcher.classList.toggle('open', v);
    launcher.innerHTML = v ? ICONS.close : ICONS.chat;
    launcher.appendChild(badgeEl);
    if (v) {
      getAudioCtx();
      unread = 0; renderBadge();
      setTab(tab);
      ensureConversation();
      if (soundEnabled) playSound('receive');
    }
    schedulePoll();
  }

  function setTab(t) {
    tab = t;
    Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle('on', b.dataset.t === t); });
    updateComposeVisibility();
    render();
    if (t === 'chat' && open) setTimeout(function () { inputEl.focus(); }, 50);
  }

  function updateComposeVisibility() {
    if (!composeEl || !composeEndedEl) return;
    var isEnded = conv && (conv.status === 'RESOLVED' || conv.status === 'CLOSED');
    if (tab === 'help') {
      composeEl.style.display = 'none';
      composeEndedEl.style.display = 'none';
    } else if (isEnded) {
      composeEl.style.display = 'none';
      composeEndedEl.style.display = 'flex';
    } else {
      composeEl.style.display = 'flex';
      composeEndedEl.style.display = 'none';
    }
  }

  function renderBadge() {
    badgeEl.style.display = unread > 0 && !open ? 'flex' : 'none';
    badgeEl.textContent = unread > 9 ? '9+' : String(unread);
  }

  function render() {
    if (!bodyEl) return;
    if (tab === 'help') return renderHelp();

    var isEnded = conv && (conv.status === 'RESOLVED' || conv.status === 'CLOSED');
    updateComposeVisibility();

    // Update header actions according to conversation status
    if (endBtn) {
      endBtn.style.display = isEnded ? 'none' : 'flex';
    }
    var htStatus = panel ? panel.querySelector('.ht-status-line') : null;
    if (htStatus) {
      if (isEnded) {
        htStatus.innerHTML = '<span class="ht-offline-dot"></span><span>Conversation ended</span>';
      } else {
        htStatus.innerHTML = statusLineHtml();
      }
    }

    var wasNearBottom = (bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight) < 60;
    bodyEl.innerHTML = '';
    var list = el('div', 'msgs');

    // Before the first message there's nothing to date — show "Today".
    if (!msgs.length) {
      var dateDiv = el('div', 'date-divider');
      dateDiv.innerHTML = '<span class="date-pill">Today</span>';
      list.appendChild(dateDiv);
    }

    if (!conv) {
      var tyRow0 = el('div', 'row new-anim');
      var av0 = el('div', 'msg-avatar');
      av0.innerHTML = avatarHtml(cfg);
      tyRow0.appendChild(av0);

      var mCol0 = el('div', 'msg-col');
      var tb0 = el('div', 'typing-bubble');
      tb0.appendChild(el('span')); tb0.appendChild(el('span')); tb0.appendChild(el('span'));
      mCol0.appendChild(tb0);
      tyRow0.appendChild(mCol0);
      list.appendChild(tyRow0);
    }
    var lastDay = null;
    if (cfg.online === false && cfg.offlineMessage && !isEnded) {
      list.appendChild(el('div', 'offline-note', esc(cfg.offlineMessage)));
    }
    var lastVisitorId = 0;
    msgs.forEach(function (m) { if (m.senderType === 'VISITOR' && m.id % 1 === 0) lastVisitorId = m.id; });
    msgs.forEach(function (m, idx) {
      var label = dayLabel(m.createdAt, lastDay);
      if (label) {
        lastDay = new Date(m.createdAt).toDateString();
        var dd = el('div', 'date-divider');
        dd.innerHTML = '<span class="date-pill">' + esc(label) + '</span>';
        list.appendChild(dd);
      }
      if (m.senderType === 'SYSTEM') {
        list.appendChild(el('div', 'sys', esc(m.message)));
        return;
      }
      var mine = m.senderType === 'VISITOR';
      var isNew = !animatedIds[m.id];
      if (isNew) animatedIds[m.id] = true;
      var row = el('div', 'row' + (mine ? ' me' : '') + (isNew ? ' new-anim' : ''));

      if (!mine) {
        var av = el('div', 'msg-avatar');
        av.innerHTML = avatarHtml(cfg);
        row.appendChild(av);
      }

      var mCol = el('div', 'msg-col');
      var prev = msgs[idx - 1];
      if (!mine && (!prev || prev.senderName !== m.senderName || prev.senderType !== m.senderType)) {
        mCol.appendChild(el('div', 'who', esc(m.senderName) + (m.senderType === 'AGENT' ? ' · Team' : '')));
      }

      var att = m.metadata && m.metadata.attachment;
      var b = el('div', 'bubble', att
        ? attachmentHtml(att) + (m.message && m.message !== att.name ? md(m.message) : '')
        : m.uploading ? '<span class="att-uploading">Uploading ' + esc(m.message) + '…</span>' : md(m.message));
      var tip = el('div', 'bubble-tooltip', time(m.createdAt));
      b.appendChild(tip);
      mCol.appendChild(b);

      var meta = m.metadata || {};
      var isLast = idx === msgs.length - 1;
      if ((meta.articles && meta.articles.length) || (isLast && meta.quickReplies && conv && conv.status === 'BOT')) {
        var pills = el('div', 'pills' + (isNew ? ' anim' : ''));
        (meta.articles || []).forEach(function (a) {
          var p = el('button', 'pill', ICONS.doc + '<span>' + esc(a.title) + '</span>');
          p.onclick = function () { openArticle(a.id, 'chat'); };
          pills.appendChild(p);
        });
        if (isLast && conv && conv.status === 'BOT') {
          (meta.quickReplies || []).forEach(function (q) {
            var p = el('button', 'pill', '<span>' + esc(q) + '</span>');
            p.onclick = function () { if (q === 'Talk to a person') handoff(); else send(q); };
            pills.appendChild(p);
          });
        }
        mCol.appendChild(pills);
      }
      mCol.appendChild(el('div', 'ts', time(m.createdAt)));
      // "Seen" under the visitor's latest message once an agent has opened it.
      if (mine && m.id === lastVisitorId && conv && conv.status === 'OPEN' && (conv.seenUpTo || 0) >= m.id) {
        mCol.appendChild(el('div', 'seen', 'Seen'));
      }
      row.appendChild(mCol);
      list.appendChild(row);

      if (isLast && meta.action === 'collect_contact' && conv && !conv.hasContact && !formFor && !isEnded) {
        formFor = meta.intent || 'human';
      }
    });

    if ((sending && conv && conv.status === 'BOT') || (!sending && conv && conv.status === 'OPEN' && conv.agentTyping)) {
      var tyRow = el('div', 'row new-anim');
      var av1 = el('div', 'msg-avatar');
      av1.innerHTML = avatarHtml(cfg);
      tyRow.appendChild(av1);

      var mCol1 = el('div', 'msg-col');
      var tb = el('div', 'typing-bubble');
      tb.appendChild(el('span')); tb.appendChild(el('span')); tb.appendChild(el('span'));
      mCol1.appendChild(tb);
      tyRow.appendChild(mCol1);
      list.appendChild(tyRow);
    }
    if (formFor && conv && !conv.hasContact && !isEnded) {
      list.appendChild(contactForm());
    } else if (conv && conv.status === 'BOT' && msgs.length <= 1) {
      var starters = el('div', 'pills' + (startersAnimatedFor === conv.id ? '' : ' anim'));
      startersAnimatedFor = conv.id;
      starters.style.alignSelf = 'flex-end';
      var opts = SOURCE === 'CAREERS'
        ? ['What roles are open?', 'How do I apply?', 'Talk to HR']
        : ['What services do you offer?', 'I need a quote', 'Talk to a person'];
      opts.forEach(function (q) {
        var p = el('button', 'pill', '<span>' + esc(q) + '</span>');
        p.onclick = function () { if (/^talk to/i.test(q)) handoff(SOURCE === 'CAREERS' ? 'job' : 'human'); else send(q); };
        starters.appendChild(p);
      });
      list.appendChild(starters);
    }

    // Display "Ended" status card when conversation is closed or resolved
    if (isEnded) {
      var endedBox = el('div', 'ended-card' + (endedAnimatedFor === conv.id ? '' : ' anim'));
      endedAnimatedFor = conv.id;
      endedBox.innerHTML =
        '<div class="ended-icon">' + ICONS.check + '</div>' +
        '<div class="ended-text">' +
          '<strong>Conversation Ended</strong>' +
          '<p>Thank you for reaching out! Let us know if you need anything else.</p>' +
        '</div>';
      list.appendChild(endedBox);
    }

    bodyEl.appendChild(list);
    if (wasNearBottom || sending || msgs.length <= 2) {
      bodyEl.scrollTop = bodyEl.scrollHeight;
    }
  }

  function contactForm() {
    var f = el('form', 'form');
    var intro = {
      sales: 'Share your details and our sales team will get back to you with a quote.',
      job: 'Leave your details and our HR team will reply.',
      support: 'Leave your details so our support team can follow up.',
      human: 'Leave your details and a team member will reply here.',
    }[formFor] || 'Leave your details and a team member will reply here.';
    f.innerHTML = '<b>' + esc(intro) + '</b>' +
      '<input name="name" placeholder="Your name *" autocomplete="name" required maxlength="120">' +
      '<input name="email" type="email" placeholder="Email" autocomplete="email" maxlength="160">' +
      '<input name="phone" type="tel" placeholder="Phone" autocomplete="tel" maxlength="30">' +
      '<div class="err"></div><button class="btn" type="submit">Connect me</button>';
    f.onsubmit = function (e) {
      e.preventDefault();
      var btn = f.querySelector('button'), err = f.querySelector('.err');
      var body = { visitorId: visitorId, intent: formFor, name: f.name.value, email: f.email.value, phone: f.phone.value };
      if (!body.email && !body.phone) { err.textContent = 'Please add an email or phone number.'; return; }
      btn.disabled = true; err.textContent = '';
      api('/conversations/' + conv.id + '/contact', { method: 'POST', body: body })
        .then(function (r) { formFor = null; merge(r); })
        .catch(function (x) { err.textContent = x.message; btn.disabled = false; });
    };
    setTimeout(function () { try { f.name.focus(); } catch (e) { } }, 30);
    return f;
  }

  function handoff(intent) {
    if (!conv) return;
    if (conv.hasContact) { send('I would like to talk to a person, please.'); return; }
    formFor = intent || 'human';
    render();
  }

  // ─── conversation ───
  var starting = null;
  function ensureConversation() {
    if (conv || starting) return starting;
    starting = api('/conversations', {
      method: 'POST',
      body: { visitorId: visitorId, source: SOURCE, pageUrl: location.href, referrer: document.referrer || null },
    }).then(function (r) {
      msgs = []; lastId = 0; animatedIds = {}; merge(r);
    }).catch(function (e) {
      if (bodyEl) bodyEl.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }).then(function () { starting = null; });
    return starting;
  }

  function merge(r) {
    var prevStatus = conv ? conv.status : null;
    var prevTyping = conv ? !!conv.agentTyping : false;
    var prevSeen = conv ? conv.seenUpTo || 0 : 0;
    if (r.conversation) conv = r.conversation;
    var statusChanged = conv && (conv.status !== prevStatus || !!conv.agentTyping !== prevTyping || (conv.seenUpTo || 0) !== prevSeen);

    var fresh = 0;
    (r.messages || []).forEach(function (m) {
      if (m.id > lastId) {
        msgs.push(m); lastId = m.id;
        if (m.senderType !== 'VISITOR') fresh++;
      }
    });

    if (fresh && !open) { unread += fresh; renderBadge(); }
    if (fresh) playSound('receive');

    // CRITICAL: Only trigger DOM render if genuinely new messages arrived or conversation status changed.
    // This eliminates the bug where the chat was refreshing / flickering every 3 seconds!
    if (fresh > 0 || statusChanged) {
      if (tab === 'chat') render();
    }
  }

  /** Header line: the widget subtitle while the team is in, "Offline · back …" outside office hours. */
  function statusLineHtml() {
    if (cfg && cfg.online === false) {
      return '<span class="ht-offline-dot"></span><span>' + esc(cfg.backAt ? 'Offline · back ' + cfg.backAt : 'Offline right now') + '</span>';
    }
    return '<span class="ht-live-dot"></span><span>' + esc((cfg && cfg.headerSubtitle) || 'Online • Instant Answers') + '</span>';
  }

  // Let agents see the visitor typing — only once a person is on the chat, at most every 3s.
  var lastTypingPing = 0;
  function pingTyping() {
    if (!conv || conv.status !== 'OPEN' || !inputEl.value.trim()) return;
    var now = Date.now();
    if (now - lastTypingPing < 3000) return;
    lastTypingPing = now;
    api('/conversations/' + conv.id + '/typing', { method: 'POST', body: { visitorId: visitorId } }).catch(function () {});
  }

  function fileSize(n) {
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  /** Image preview or a file card; only http(s) URLs are ever linked. */
  function attachmentHtml(a) {
    var url = /^https?:\/\//.test(a.url || '') ? esc(a.url) : '';
    if (!url) return esc(a.name || 'File');
    if (a.isImage) {
      return '<a href="' + url + '" target="_blank" rel="noopener noreferrer"><img class="att-img" src="' + url + '" alt="' + esc(a.name) + '" loading="lazy"></a>';
    }
    return '<a class="att-file" href="' + url + '" target="_blank" rel="noopener noreferrer">' +
      '<span class="att-ico">' + ICONS.doc + '</span>' +
      '<span><b>' + esc(a.name) + '</b><small>' + fileSize(a.size || 0) + ' · Open</small></span></a>';
  }

  function sendFile(file) {
    if (sending || !conv) return;
    var tempId = lastId + 0.5;
    if (file.size > MAX_ATTACH) {
      msgs.push({ id: lastId + 0.25, senderType: 'SYSTEM', message: 'That file is over 10 MB — please send a smaller one.' });
      animatedIds[lastId + 0.25] = true;
      render();
      return;
    }
    msgs.push({ id: tempId, senderType: 'VISITOR', senderName: 'You', message: file.name, uploading: true, createdAt: new Date().toISOString() });
    animatedIds[tempId] = true;
    playSound('send');
    sending = true; sendBtn.disabled = true; attachBtn.disabled = true; render();
    var form = new FormData();
    form.append('visitorId', visitorId);
    form.append('file', file);
    api('/conversations/' + conv.id + '/attachments', { method: 'POST', form: form })
      .then(function (r) {
        msgs = msgs.filter(function (m) { return m.id % 1 === 0; });
        merge(r);
      })
      .catch(function (e) {
        msgs = msgs.filter(function (m) { return m.id % 1 === 0; });
        var errId = lastId + 0.25;
        msgs.push({ id: errId, senderType: 'SYSTEM', message: e.message });
        animatedIds[errId] = true;
      })
      .then(function () { sending = false; sendBtn.disabled = false; attachBtn.disabled = false; render(); schedulePoll(); });
  }

  function send(text) {
    var msg = typeof text === 'string' ? text : inputEl.value.trim();
    if (!msg || sending || !conv) return;
    if (typeof text !== 'string') { inputEl.value = ''; inputEl.style.height = 'auto'; }
    // optimistic echo
    var tempId = lastId + 0.5;
    msgs.push({ id: tempId, senderType: 'VISITOR', senderName: 'You', message: msg, createdAt: new Date().toISOString() });
    animatedIds[tempId] = true;
    playSound('send');
    sending = true; sendBtn.disabled = true; render();
    // The bot often answers in a few ms — hold its typing dots long enough to be seen.
    var minTyping = conv.status === 'BOT' ? 900 + Math.min(900, msg.length * 15) : 0;
    var started = Date.now();
    api('/conversations/' + conv.id + '/messages', { method: 'POST', body: { visitorId: visitorId, message: msg } })
      .then(function (r) {
        var wait = minTyping - (Date.now() - started);
        return wait > 0 ? new Promise(function (res) { setTimeout(function () { res(r); }, wait); }) : r;
      })
      .then(function (r) {
        msgs = msgs.filter(function (m) { return m.id % 1 === 0; });
        merge(r);
      })
      .catch(function (e) {
        msgs = msgs.filter(function (m) { return m.id % 1 === 0; });
        var errId = lastId + 0.25;
        msgs.push({ id: errId, senderType: 'SYSTEM', message: e.message });
        animatedIds[errId] = true;
      })
      .then(function () { sending = false; sendBtn.disabled = false; render(); schedulePoll(); });
  }

  // Poll faster while open and a person is on the other end; slowly in the
  // background so a closed launcher can still show an unread badge.
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (conv && (conv.status === 'RESOLVED' || conv.status === 'CLOSED')) {
      return; // Stop polling while conversation is ended
    }
    var delay = !open ? 20000 : conv && conv.agentTyping ? 1500 : conv && conv.status === 'OPEN' ? 3000 : 8000;
    pollTimer = setTimeout(function () {
      if (conv && !sending && document.visibilityState !== 'hidden') {
        api('/conversations/' + conv.id + '/messages?visitorId=' + encodeURIComponent(visitorId) + '&after=' + Math.floor(lastId) +
          (open && tab === 'chat' ? '&seen=1' : ''))
          .then(merge)
          .catch(function () { /* transient — try again next tick */ })
          .then(schedulePoll);
      } else schedulePoll();
    }, delay);
  }

  // ─── help tab ───
  function renderHelp() {
    bodyEl.innerHTML = '';
    if (article) return renderArticle();
    var box = el('div', 'kb');
    var search = el('div', 'search', ICONS.search);
    var q = el('input');
    q.placeholder = 'Search help articles…';
    q.setAttribute('aria-label', 'Search help articles');
    search.appendChild(q);
    box.appendChild(search);
    var results = el('div');
    box.appendChild(results);
    bodyEl.appendChild(box);

    function list(cats) {
      results.innerHTML = '';
      var any = false;
      cats.forEach(function (c) {
        if (!c.articles.length) return;
        any = true;
        var sec = el('div', 'cat', '<h4>' + esc(c.name) + '</h4>');
        c.articles.forEach(function (a) { sec.appendChild(articleButton(a)); });
        results.appendChild(sec);
      });
      if (!any) results.appendChild(el('div', 'empty', 'No articles yet. Ask us in the Chat tab!'));
    }
    var t;
    q.addEventListener('input', function () {
      clearTimeout(t);
      var term = q.value.trim();
      if (!term) { list(kbCache || []); return; }
      t = setTimeout(function () {
        api('/kb/search?q=' + encodeURIComponent(term)).then(function (hits) {
          if (q.value.trim() !== term) return;
          results.innerHTML = '';
          if (!hits.length) {
            var none = el('div', 'empty', 'Nothing found for “' + esc(term) + '”.<br><br>');
            var ask = el('button', 'btn', 'Ask in chat');
            ask.onclick = function () { setTab('chat'); ensureConversation().then(function () { send(term); }); };
            none.appendChild(ask);
            results.appendChild(none);
          }
          hits.forEach(function (a) { results.appendChild(articleButton(a, a.category)); });
        }).catch(function () { });
      }, 250);
    });

    if (kbCache) list(kbCache);
    else {
      results.appendChild(el('div', 'typing', '<i></i><i></i><i></i>'));
      api('/kb/categories').then(function (cats) { kbCache = cats; if (!article && tab === 'help') list(cats); })
        .catch(function (e) { results.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    }
  }

  function articleButton(a, sub) {
    var b = el('button', 'art', ICONS.doc + '<div>' + esc(a.title) + (sub || a.excerpt ? '<small>' + esc(sub || a.excerpt) + '</small>' : '') + '</div>');
    b.onclick = function () { openArticle(a.id, 'help'); };
    return b;
  }

  function openArticle(id, from) {
    article = { id: id, from: from, loading: true };
    if (tab !== 'help') setTab('help'); else render();
    api('/kb/articles/' + id).then(function (a) {
      if (!article || article.id !== id) return;
      article = Object.assign(a, { from: from });
      render();
    }).catch(function (e) { article = { error: e.message, from: from }; render(); });
  }

  function renderArticle() {
    var r = el('div', 'reader');
    var back = el('button', 'back', ICONS.back + (article.from === 'chat' ? 'Back to chat' : 'All articles'));
    back.onclick = function () { var from = article.from; article = null; setTab(from === 'chat' ? 'chat' : 'help'); };
    r.appendChild(back);
    if (article.loading) r.appendChild(el('div', 'typing', '<i></i><i></i><i></i>'));
    else if (article.error) r.appendChild(el('div', 'empty', esc(article.error)));
    else {
      r.appendChild(el('h3', null, esc(article.title)));
      r.appendChild(el('div', 'bubble', md(article.content)));
      var vote = el('div', 'vote', 'Was this helpful?');
      [['Yes', true], ['No', false]].forEach(function (v) {
        var b = el('button', 'pill', '<span>' + v[0] + '</span>');
        b.onclick = function () {
          api('/kb/articles/' + article.id + '/vote', { method: 'POST', body: { helpful: v[1] } }).catch(function () { });
          vote.innerHTML = v[1] ? 'Thanks for the feedback!' : 'Sorry about that. ';
          if (!v[1]) {
            var ask = el('button', 'pill', '<span>Ask our team</span>');
            ask.onclick = function () { article = null; setTab('chat'); };
            vote.appendChild(ask);
          }
        };
        vote.appendChild(b);
      });
      r.appendChild(vote);
    }
    bodyEl.appendChild(r);
  }

  // ─── boot ───
  function boot() {
    api('/config').then(function (c) {
      cfg = c;
      build();
      // Resume a chat from a previous page so replies show on the badge.
      if (store('nexchat_conv') === WIDGET_KEY && !conv) {
        api('/conversations', { method: 'POST', body: { visitorId: visitorId, source: SOURCE, resumeOnly: true } })
          .then(function (r) { if (r.conversation && !conv) { msgs = []; lastId = 0; unread = 0; animatedIds = {}; merge(r); unread = 0; renderBadge(); } })
          .catch(function () { });
      }
      schedulePoll();
    }).catch(function (e) { console.warn('[nex-chat] widget disabled:', e.message); });
  }
  var _ensure = ensureConversation;
  ensureConversation = function () {
    store('nexchat_conv', WIDGET_KEY);
    return _ensure() || Promise.resolve();
  };
  window.NexChat = {
    open: function () { if (panel) toggle(true); },
    close: function () { if (panel) toggle(false); },
    end: function () { endConversation(); },
    newChat: function () { startNewConversation(); },
    destroy: function () {
      clearTimeout(pollTimer);
      if (host.parentNode) host.parentNode.removeChild(host);
      window.__nexChatLoaded = false;
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
