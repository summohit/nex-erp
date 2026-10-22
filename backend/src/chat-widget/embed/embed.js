/*
 * Nex chat & help widget.
 *
 *   <script src="https://<api>/public/chat-widget/embed.js" data-widget-key="<key>" async></script>
 *
 * Optional attributes: data-source="CAREERS" (tells the bot it's on the careers
 * page), data-api="https://<api>" (defaults to the script's own origin+path).
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
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
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
  function time(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
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
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>'
  };

  var CSS = [
    ':host{all:initial}',
    '*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.launcher{position:fixed;bottom:24px;width:60px;height:60px;border-radius:50%;border:0;background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 75%,#0f172a));color:#fff;cursor:pointer;box-shadow:0 10px 28px -4px rgba(15,23,42,.32),0 0 0 1px rgba(255,255,255,.18) inset;display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .25s cubic-bezier(.16,1,.3,1),box-shadow .25s ease}',
    '.launcher::before{content:"";position:absolute;inset:-4px;border-radius:50%;background:var(--c);opacity:.35;z-index:-1;animation:nexPulse 2.8s cubic-bezier(.24,0,.38,1) infinite}',
    '@keyframes nexPulse{0%{transform:scale(.95);opacity:.45}50%{transform:scale(1.18);opacity:0}100%{transform:scale(.95);opacity:0}}',
    '.launcher:hover{transform:scale(1.08) translateY(-2px);box-shadow:0 16px 36px -4px rgba(15,23,42,.38),0 0 24px color-mix(in srgb,var(--c) 45%,transparent)}',
    '.launcher:active{transform:scale(.95)}',
    '.launcher svg{width:26px;height:26px;transition:transform .25s cubic-bezier(.16,1,.3,1)}',
    '.br{right:24px}.bl{left:24px}',
    '.badge{position:absolute;top:-2px;right:-2px;min-width:21px;height:21px;padding:0 6px;border-radius:11px;background:#ef4444;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(239,68,68,.4);animation:badgePop .3s cubic-bezier(.16,1,.3,1)}',
    '@keyframes badgePop{from{transform:scale(0)}to{transform:scale(1)}}',
    '.panel{position:fixed;bottom:98px;width:390px;height:min(640px,calc(100vh - 120px));background:#fff;border-radius:20px;box-shadow:0 24px 60px -12px rgba(15,23,42,.28),0 0 0 1px rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden;z-index:2147483647;opacity:0;transform:translateY(16px) scale(.94);transform-origin:bottom right;pointer-events:none;transition:opacity .28s cubic-bezier(.16,1,.3,1),transform .28s cubic-bezier(.16,1,.3,1);color:#0f172a;font-size:14px;line-height:1.45}',
    '.panel.bl{transform-origin:bottom left}',
    '.panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}',
    '@media (max-width:480px){.panel{left:0!important;right:0!important;bottom:0;width:100%!important;height:100%!important;border-radius:0!important;max-height:100%}.panel.open~.launcher{display:none}}',
    '.head{background:linear-gradient(135deg,var(--c) 0%,color-mix(in srgb,var(--c) 80%,#0f172a) 100%);color:#fff;padding:16px 18px 14px;display:flex;align-items:center;gap:12px;position:relative;box-shadow:0 4px 12px rgba(0,0,0,.06)}',
    '.avatar{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.24);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:none;font-weight:700;position:relative;box-shadow:0 0 0 2px rgba(255,255,255,.35),0 3px 8px rgba(0,0,0,.15)}',
    '.avatar img{width:100%;height:100%;object-fit:cover}.avatar svg{width:22px;height:22px}',
    '.avatar-online-dot{position:absolute;bottom:0;right:0;width:11px;height:11px;border-radius:50%;background:#10b981;border:2px solid #fff;box-shadow:0 0 6px #10b981}',
    '.ht{flex:1;min-width:0}',
    '.ht b{display:block;font-size:15px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.ht-status-line{display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.92;margin-top:2px}',
    '.ht-live-dot{width:6px;height:6px;border-radius:50%;background:#34d399;animation:liveBlink 1.8s infinite ease-in-out}',
    '@keyframes liveBlink{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.85)}}',
    '.icon-btn{background:transparent;border:0;color:inherit;cursor:pointer;padding:7px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:background-color .15s}',
    '.icon-btn:hover{background:rgba(255,255,255,.2)}.icon-btn svg{width:18px;height:18px}',
    '.sound-btn svg{width:17px;height:17px}',
    '.tabs{display:flex;border-bottom:1px solid #e2e8f0;background:#fff;padding:0 8px}',
    '.tab{flex:1;border:0;background:none;padding:12px 8px;font-size:13px;font-weight:600;color:#64748b;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;border-bottom:2px solid transparent;transition:all .15s ease}',
    '.tab svg{width:16px;height:16px;transition:color .15s}.tab:hover{color:#0f172a}',
    '.tab.on{color:var(--c);border-bottom-color:var(--c)}',
    '.body{flex:1;overflow-y:auto;background:#f8fafc;scroll-behavior:smooth}',
    '.msgs{padding:18px 16px;display:flex;flex-direction:column;gap:12px}',
    '.row{display:flex;flex-direction:column;max-width:86%;animation:nexMsgSlide .22s cubic-bezier(.16,1,.3,1) both}',
    '@keyframes nexMsgSlide{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:translateY(0) scale(1)}}',
    '.row.me{align-self:flex-end;align-items:flex-end}',
    '.who{font-size:11px;font-weight:600;color:#64748b;margin:0 4px 4px}',
    '.bubble{padding:10px 14px;border-radius:16px;background:#fff;border:1px solid #e2e8f0;word-wrap:break-word;overflow-wrap:anywhere;box-shadow:0 1px 3px rgba(15,23,42,.04);font-size:13.5px;line-height:1.5}',
    '.me .bubble{background:linear-gradient(135deg,var(--c),color-mix(in srgb,var(--c) 88%,#1e3a8a));color:#fff;border-color:transparent;border-bottom-right-radius:4px;box-shadow:0 2px 8px color-mix(in srgb,var(--c) 25%,transparent)}',
    '.row:not(.me) .bubble{border-bottom-left-radius:4px}',
    '.bubble p{margin:0 0 6px}.bubble p:last-child{margin:0}.bubble p.h{font-weight:700}.bubble ul{margin:4px 0 6px;padding-left:18px}.bubble a{color:inherit;text-decoration:underline;font-weight:500}.bubble code{background:rgba(15,23,42,.08);padding:1px 5px;border-radius:4px;font-family:ui-monospace,monospace;font-size:12px}',
    '.sys{align-self:center;max-width:92%;text-align:center;font-size:12px;color:#475569;background:#eef2f7;padding:6px 14px;border-radius:12px;margin:4px 0}',
    '.ts{font-size:10px;color:#94a3b8;margin:3px 4px 0}',
    '.pills{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
    '.pill{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:500;cursor:pointer;display:inline-flex;align-items:center;gap:6px;max-width:100%;transition:all .16s cubic-bezier(.16,1,.3,1);box-shadow:0 1px 2px rgba(15,23,42,.04)}',
    '.pill svg{width:13px;height:13px;flex:none;color:var(--c)}.pill span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pill:hover{border-color:var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 6%,#fff);transform:translateY(-1px);box-shadow:0 4px 10px rgba(15,23,42,.08)}',
    '.pill:active{transform:scale(.97)}',
    '.typing-bubble{background:#fff;border:1px solid #e2e8f0;border-radius:16px 16px 16px 4px;padding:10px 14px;display:inline-flex;align-items:center;gap:5px;box-shadow:0 1px 3px rgba(15,23,42,.04);width:fit-content}',
    '.typing-bubble span{width:7px;height:7px;border-radius:50%;background:var(--c);opacity:.4;animation:nexDotBounce 1.3s infinite ease-in-out}',
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
    '.compose{display:flex;gap:8px;padding:12px 14px;border-top:1px solid #e2e8f0;background:#fff;align-items:flex-end}',
    '.compose textarea{flex:1;resize:none;border:1px solid #cbd5e1;border-radius:12px;padding:9px 12px;font-size:13.5px;line-height:1.45;max-height:110px;min-height:42px;outline:none;color:#0f172a;background:#f8fafc;transition:all .15s ease}',
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
    '.art{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;background:#fff;border:1px solid #e2e8f0;border-radius:11px;padding:11px 13px;margin-bottom:7px;cursor:pointer;color:#0f172a;font-size:13.5px;transition:all .15s ease;box-shadow:0 1px 2px rgba(15,23,42,.03)}',
    '.art:hover{border-color:var(--c);transform:translateY(-1px);box-shadow:0 3px 8px rgba(15,23,42,.07)}.art svg{width:16px;height:16px;color:var(--c);flex:none;margin-top:2px}.art small{display:block;color:#64748b;font-size:12px;margin-top:2px}',
    '.reader{padding:18px;animation:nexMsgSlide .2s ease-out}.reader h3{margin:8px 0 14px;font-size:18px;font-weight:700;color:#0f172a}.reader .bubble{border:0;background:none;padding:0;box-shadow:none}',
    '.back{display:inline-flex;align-items:center;gap:5px;border:0;background:none;color:var(--c);cursor:pointer;font-size:13px;padding:0;font-weight:600;margin-bottom:6px}.back svg{width:16px;height:16px}',
    '.vote{margin-top:22px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:13px;color:#475569;display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.empty{text-align:center;color:#64748b;font-size:13px;padding:28px 12px}',
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
  var sending = false, pollTimer = null, formFor = null, kbCache = null, article = null;
  var openKey = 'nexchat_open';

  // ─── mount ───
  var host = document.createElement('div');
  host.id = 'nex-chat-widget';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);
  var wrap = document.createElement('div');
  root.appendChild(wrap);

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  var panel, bodyEl, launcher, badgeEl, composeEl, inputEl, sendBtn, tabsEl;

  function build() {
    wrap.style.setProperty('--c', cfg.primaryColor || '#2563EB');
    var side = (POSITION || cfg.position) === 'bl' ? 'bl' : 'br';

    panel = el('div', 'panel ' + side);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', cfg.headerTitle);
    var head = el('div', 'head');
    var av = el('div', 'avatar');
    if (cfg.botAvatarUrl) { var img = el('img'); img.src = cfg.botAvatarUrl; img.alt = ''; av.appendChild(img); }
    else av.innerHTML = ICONS.chat;
    var dot = el('span', 'avatar-online-dot');
    av.appendChild(dot);
    var ht = el('div', 'ht', '<b>' + esc(cfg.headerTitle) + '</b><div class="ht-status-line"><span class="ht-live-dot"></span><span>' + esc(cfg.headerSubtitle || 'Online • Instant Answers') + '</span></div>');
    var soundBtn = el('button', 'icon-btn sound-btn', soundEnabled ? ICONS.volumeOn : ICONS.volumeOff);
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
    var closeBtn = el('button', 'icon-btn', ICONS.close);
    closeBtn.setAttribute('aria-label', 'Close chat');
    closeBtn.onclick = function () { toggle(false); };
    head.appendChild(av); head.appendChild(ht); head.appendChild(soundBtn); head.appendChild(closeBtn);

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
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(110, inputEl.scrollHeight) + 'px';
    });
    sendBtn = el('button', 'send', ICONS.send);
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.onclick = send;
    composeEl.appendChild(inputEl); composeEl.appendChild(sendBtn);

    panel.appendChild(head); panel.appendChild(tabsEl); panel.appendChild(bodyEl);
    panel.appendChild(composeEl);
    var footHtml = '<span class="foot-sparkle">' + ICONS.sparkle + '</span><span>Powered by <strong>MIRA</strong></span>';
    panel.appendChild(el('div', 'foot', footHtml));

    launcher = el('button', 'launcher ' + side, ICONS.chat);
    launcher.setAttribute('aria-label', 'Open chat');
    badgeEl = el('span', 'badge');
    badgeEl.style.display = 'none';
    launcher.appendChild(badgeEl);
    launcher.onclick = function () { toggle(!open); };

    wrap.appendChild(panel); wrap.appendChild(launcher);
    document.body.appendChild(host);
    if (store(openKey) === '1' && window.innerWidth > 480) toggle(true);
  }

  function toggle(v) {
    open = v;
    store(openKey, v ? '1' : '0');
    panel.classList.toggle('open', v);
    launcher.innerHTML = v ? ICONS.close : ICONS.chat;
    launcher.appendChild(badgeEl);
    if (v) {
      getAudioCtx();
      unread = 0; renderBadge();
      setTab(tab);
      ensureConversation();
    }
    schedulePoll();
  }

  function setTab(t) {
    tab = t;
    Array.prototype.forEach.call(tabsEl.children, function (b) { b.classList.toggle('on', b.dataset.t === t); });
    composeEl.style.display = t === 'chat' ? 'flex' : 'none';
    render();
    if (t === 'chat' && open) setTimeout(function () { inputEl.focus(); }, 50);
  }

  function renderBadge() {
    badgeEl.style.display = unread > 0 && !open ? 'flex' : 'none';
    badgeEl.textContent = unread > 9 ? '9+' : String(unread);
  }

  function render() {
    if (!bodyEl) return;
    if (tab === 'help') return renderHelp();
    bodyEl.innerHTML = '';
    var list = el('div', 'msgs');
    if (!conv) {
      var tyRow0 = el('div', 'row');
      var tb0 = el('div', 'typing-bubble');
      tb0.appendChild(el('span')); tb0.appendChild(el('span')); tb0.appendChild(el('span'));
      tyRow0.appendChild(tb0);
      list.appendChild(tyRow0);
    }
    msgs.forEach(function (m, idx) {
      if (m.senderType === 'SYSTEM') { list.appendChild(el('div', 'sys', esc(m.message))); return; }
      var mine = m.senderType === 'VISITOR';
      var row = el('div', 'row' + (mine ? ' me' : ''));
      var prev = msgs[idx - 1];
      if (!mine && (!prev || prev.senderName !== m.senderName || prev.senderType !== m.senderType)) {
        row.appendChild(el('div', 'who', esc(m.senderName) + (m.senderType === 'AGENT' ? ' · Team' : '')));
      }
      row.appendChild(el('div', 'bubble', md(m.message)));
      var meta = m.metadata || {};
      var isLast = idx === msgs.length - 1;
      if ((meta.articles && meta.articles.length) || (isLast && meta.quickReplies && conv && conv.status === 'BOT')) {
        var pills = el('div', 'pills');
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
        row.appendChild(pills);
      }
      row.appendChild(el('div', 'ts', time(m.createdAt)));
      list.appendChild(row);

      if (isLast && meta.action === 'collect_contact' && conv && !conv.hasContact && !formFor) formFor = meta.intent || 'human';
    });

    if (sending) {
      var tyRow = el('div', 'row');
      var tb = el('div', 'typing-bubble');
      tb.appendChild(el('span')); tb.appendChild(el('span')); tb.appendChild(el('span'));
      tyRow.appendChild(tb);
      list.appendChild(tyRow);
    }
    if (formFor && conv && !conv.hasContact) list.appendChild(contactForm());
    else if (conv && conv.status === 'BOT' && msgs.length <= 1) {
      var starters = el('div', 'pills');
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
    bodyEl.appendChild(list);
    bodyEl.scrollTop = bodyEl.scrollHeight;
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
      msgs = []; lastId = 0; merge(r);
    }).catch(function (e) {
      bodyEl.innerHTML = '<div class="empty">' + esc(e.message) + '</div>';
    }).then(function () { starting = null; });
    return starting;
  }

  function merge(r) {
    if (r.conversation) conv = r.conversation;
    var fresh = 0;
    (r.messages || []).forEach(function (m) {
      if (m.id > lastId) {
        msgs.push(m); lastId = m.id;
        if (m.senderType !== 'VISITOR') fresh++;
      }
    });
    if (fresh && !open) { unread += fresh; renderBadge(); }
    if (fresh) playSound('receive');
    if (tab === 'chat' || !open) render();
  }

  function send(text) {
    var msg = typeof text === 'string' ? text : inputEl.value.trim();
    if (!msg || sending || !conv) return;
    if (typeof text !== 'string') { inputEl.value = ''; inputEl.style.height = 'auto'; }
    // optimistic echo
    msgs.push({ id: lastId + 0.5, senderType: 'VISITOR', senderName: 'You', message: msg, createdAt: new Date().toISOString() });
    playSound('send');
    sending = true; sendBtn.disabled = true; render();
    api('/conversations/' + conv.id + '/messages', { method: 'POST', body: { visitorId: visitorId, message: msg } })
      .then(function (r) {
        msgs = msgs.filter(function (m) { return m.id % 1 === 0; });
        merge(r);
      })
      .catch(function (e) {
        msgs = msgs.filter(function (m) { return m.id % 1 === 0; });
        msgs.push({ id: lastId + 0.25, senderType: 'SYSTEM', message: e.message });
      })
      .then(function () { sending = false; sendBtn.disabled = false; render(); });
  }

  // Poll faster while open and a person is on the other end; slowly in the
  // background so a closed launcher can still show an unread badge.
  function schedulePoll() {
    clearTimeout(pollTimer);
    var delay = !open ? 20000 : conv && conv.status === 'OPEN' ? 3000 : 8000;
    pollTimer = setTimeout(function () {
      if (conv && !sending && document.visibilityState !== 'hidden') {
        api('/conversations/' + conv.id + '/messages?visitorId=' + encodeURIComponent(visitorId) + '&after=' + Math.floor(lastId))
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
          .then(function (r) { if (r.conversation && !conv) { msgs = []; lastId = 0; unread = 0; merge(r); unread = 0; renderBadge(); } })
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
    destroy: function () {
      clearTimeout(pollTimer);
      if (host.parentNode) host.parentNode.removeChild(host);
      window.__nexChatLoaded = false;
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
