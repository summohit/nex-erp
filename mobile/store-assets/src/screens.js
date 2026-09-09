const fs = require('fs');
const { icon, BASE_CSS, LOGO } = require('./common.js');

const W = 360, H = 640;

const shell = (css, body) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html,body{width:${W}px;height:${H}px;overflow:hidden;background:#F5F7FA}
.screen{width:${W}px;height:${H}px;position:relative;background:#F5F7FA;overflow:hidden}
/* status bar */
.sb{height:26px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;font-size:12px;font-weight:700;color:#0F172A;letter-spacing:.2px}
.sb .r{display:flex;align-items:center;gap:5px}
.bars{display:flex;align-items:flex-end;gap:1.5px;height:9px}
.bars i{width:2.5px;background:#0F172A;border-radius:1px;display:block}
.batt{width:17px;height:9px;border:1.4px solid #0F172A;border-radius:2.5px;position:relative;display:block}
.batt:after{content:'';position:absolute;right:-3px;top:2.2px;width:1.6px;height:3px;background:#0F172A;border-radius:0 1px 1px 0}
.batt i{position:absolute;left:1.3px;top:1.3px;bottom:1.3px;width:9px;background:#0F172A;border-radius:1px;display:block}
/* header */
.hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 16px 12px}
.ibtn{width:40px;height:40px;border-radius:13px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,.05);position:relative}
.dot{position:absolute;top:9px;right:10px;width:7px;height:7px;border-radius:4px;background:#EF4444;border:1.5px solid #fff}
.hc{flex:1;text-align:center}
.greet{font-size:11px;font-weight:600;color:#94A3B8;letter-spacing:.2px}
.nm{font-size:16px;font-weight:800;color:#0F172A;letter-spacing:-.3px;margin-top:1px}
.hr{display:flex;align-items:center;gap:8px}
.av{width:40px;height:40px;border-radius:13px;background:linear-gradient(135deg,#F97316,#E25E3E);display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:800}
.body{padding:0 16px}
.card{background:#fff;border-radius:24px;box-shadow:0 4px 14px rgba(15,23,42,.045)}
.sec{font-size:17px;font-weight:800;color:#0F172A;margin-bottom:12px}
.secrow{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}
.viewall{font-size:13px;font-weight:700;color:#E25E3E}
${css}</style></head><body><div class="screen">${body}</div></body></html>`;

const statusBar = `<div class="sb"><span>9:41</span><div class="r">
<div class="bars"><i style="height:3px"></i><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i></div>
<svg width="14" height="11" viewBox="0 0 16 12"><path d="M8 10.2 1 4.4a10.6 10.6 0 0 1 14 0Z" fill="#0F172A"/></svg>
<span class="batt"><i></i></span></div></div>`;

const header = (greeting, name, initials) => `<div class="hdr">
<div class="ibtn">${icon('menu',21,'#0F172A',2.2)}</div>
<div class="hc"><div class="greet">${greeting}</div><div class="nm">${name}</div></div>
<div class="hr"><div class="ibtn">${icon('bell',19,'#0F172A',2)}<span class="dot"></span></div><div class="av">${initials}</div></div></div>`;

/* ---------- Screen 1: Dashboard ---------- */
const ring = (pct) => {
  const r = 26, c = 2 * Math.PI * r;
  return `<svg width="60" height="60" viewBox="0 0 60 60"><circle cx="30" cy="30" r="${r}" stroke="#F3E8E5" stroke-width="5" fill="none"/>
  <circle cx="30" cy="30" r="${r}" stroke="#EA580C" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-pct)}" transform="rotate(-90 30 30)"/></svg>`;
};
const qa = (name, ic, bg, col) => `<div class="qcard"><div class="qi" style="background:${bg}">${icon(ic,21,col,2)}</div><div class="qt">${name}</div></div>`;

const screen1 = shell(`
.acard{background:#fff;border-radius:24px;padding:16px;margin-bottom:16px;position:relative;overflow:hidden;border:1px solid #FFF5F2;box-shadow:0 8px 16px rgba(226,94,62,.06)}
.glow{position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:80px;background:#FFF1EC;opacity:.7}
.act{position:relative;font-size:11px;font-weight:700;color:#94A3B8;letter-spacing:.8px;margin-bottom:6px}
.adate{position:relative;font-size:14px;font-weight:600;color:#64748B}
.atrow{position:relative;display:flex;align-items:center;justify-content:space-between;margin:2px 0 14px}
.clock{font-size:26px;font-weight:900;color:#0F172A;letter-spacing:-.5px;font-variant-numeric:tabular-nums}
.ringwrap{position:relative;width:60px;height:60px;display:flex;align-items:center;justify-content:center}
.ringtxt{position:absolute;font-size:10px;font-weight:700;color:#0F172A}
.afoot{position:relative;display:flex;align-items:center;justify-content:space-between}
.pill{display:flex;align-items:center;background:#fff;border:1px solid #E2E8F0;padding:7px 12px;border-radius:20px}
.pd{width:8px;height:8px;border-radius:4px;background:#10B981;margin-right:8px}
.pt{font-size:13px;font-weight:600;color:#475569}
.punch{display:flex;align-items:center;gap:6px;background:#EF4444;padding:10px 18px;border-radius:22px;color:#fff;font-weight:700;font-size:14px;box-shadow:0 4px 8px rgba(239,68,68,.25)}
.qgrid{display:flex;gap:10px;margin-bottom:22px}
.qcard{flex:1;height:94px;background:#fff;border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;box-shadow:0 2px 6px rgba(15,23,42,.04)}
.qi{width:42px;height:42px;border-radius:14px;display:flex;align-items:center;justify-content:center}
.qt{font-size:11.5px;font-weight:600;color:#334155}
.ogrid{display:flex;gap:12px}
.ocard{flex:1;background:#fff;border-radius:22px;padding:16px;box-shadow:0 2px 6px rgba(15,23,42,.04)}
.oi{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.ov{font-size:22px;font-weight:800;color:#0F172A;letter-spacing:-.6px}
.ol{font-size:12.5px;color:#64748B;margin-top:2px;font-weight:500}
.obadge{display:inline-flex;align-items:center;gap:2px;margin-top:10px;padding:4px 8px;border-radius:8px;font-size:11px;font-weight:700}
`, `${statusBar}${header('Good morning','Arjun Mehta','AM')}
<div class="body">
 <div class="acard"><div class="glow"></div>
  <div class="act">TODAY'S ATTENDANCE</div>
  <div class="adate">Tue, Sep 9</div>
  <div class="atrow"><div class="clock">10: 42: 18</div>
   <div class="ringwrap">${ring(0.86)}<div class="ringtxt">7h 44m</div></div></div>
  <div class="afoot"><div class="pill"><span class="pd"></span><span class="pt">Clocked in</span></div>
   <div class="punch"><span style="transform:rotate(90deg);display:flex">${icon('play',14,'#fff',2)}</span>Clock Out</div></div>
 </div>
 <div class="sec">Quick Actions</div>
 <div class="qgrid">
  ${qa('Leave','calendar','#FFF7ED','#EA580C')}
  ${qa('Attendance','clock','#F0FDF4','#16A34A')}
  ${qa('Expense','receipt','#EFF6FF','#2563EB')}
  ${qa('Field Visit','map-pin','#FAF5FF','#9333EA')}
 </div>
 <div class="secrow"><div class="sec" style="margin:0">Overview</div><div class="viewall">View all</div></div>
 <div class="ogrid">
  <div class="ocard"><div class="oi" style="background:#FFF7ED">${icon('clock',20,'#EA580C',2)}</div>
   <div class="ov">7h 44m</div><div class="ol">Worked today</div>
   <div class="obadge" style="background:#ECFDF5;color:#16A34A">${icon('arrow-up',11,'#16A34A',2.6)} 8.4% vs avg</div></div>
  <div class="ocard"><div class="oi" style="background:#F0FDF4">${icon('briefcase',20,'#16A34A',2)}</div>
   <div class="ov">6</div><div class="ol">Active projects</div>
   <div class="obadge" style="background:#F1F5F9;color:#64748B">14 completed</div></div>
 </div>
</div>`);

/* ---------- Screen 2: Attendance / analytics ---------- */
const bars = [['Mon',58],['Tue',82],['Wed',70],['Thu',96],['Fri',88],['Sat',34],['Sun',12]];
const screen2 = shell(`
.chart{background:#fff;border-radius:24px;padding:16px;box-shadow:0 2px 8px rgba(15,23,42,.04);margin-bottom:14px}
.chdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
.ct{font-size:15.5px;font-weight:800;color:#0F172A}
.cs{font-size:12px;color:#94A3B8;margin-top:2px;font-weight:500}
.filt{display:flex;background:#F1F5F9;border-radius:10px;padding:3px}
.ft{font-size:11px;font-weight:700;color:#64748B;padding:5px 9px;border-radius:8px}
.ft.on{background:#fff;color:#0F172A;box-shadow:0 1px 3px rgba(15,23,42,.09)}
.plot{position:relative;height:132px;margin-bottom:4px}
.grid{position:absolute;inset:0 0 22px 0;display:flex;flex-direction:column;justify-content:space-between}
.grid span{height:1px;background:#F1F5F9;display:block}
.brow{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:space-between}
.bcol{flex:1;display:flex;flex-direction:column;align-items:center}
.btrack{height:110px;display:flex;align-items:flex-end}
.bfill{width:22px;background:#E25E3E;border-radius:11px}
.blab{font-size:11px;font-weight:700;color:#94A3B8;margin-top:7px}
.cfoot{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #F1F5F9;padding-top:12px}
.avgv{font-size:19px;font-weight:800;color:#0F172A;letter-spacing:-.4px}
.avgl{font-size:11.5px;color:#94A3B8;font-weight:500;margin-top:1px}
.cbadge{display:flex;align-items:center;gap:2px;background:#ECFDF5;color:#16A34A;font-size:12px;font-weight:700;padding:6px 10px;border-radius:10px}
.panel{background:#fff;border-radius:22px;padding:14px 16px;box-shadow:0 2px 8px rgba(15,23,42,.04);margin-bottom:12px}
.phdr{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.phl{display:flex;align-items:center;gap:10px}
.pi{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center}
.ptl{font-size:14.5px;font-weight:700;color:#0F172A}
.pvrow{display:flex;align-items:baseline;gap:6px;margin-bottom:10px}
.pbig{font-size:26px;font-weight:800;color:#0F172A;letter-spacing:-.8px}
.punit{font-size:12.5px;color:#64748B;font-weight:500}
.track{height:8px;background:#F1F5F9;border-radius:4px;overflow:hidden}
.fill{height:8px;background:#16A34A;border-radius:4px}
.plabs{display:flex;justify-content:space-between;margin-top:7px}
.plab{font-size:11px;color:#94A3B8;font-weight:600}
.cpill{background:#FFF7ED;color:#EA580C;font-size:11.5px;font-weight:800;padding:4px 9px;border-radius:9px}
.prow{display:flex;align-items:center;gap:9px;padding:6px 0}
.pdot{width:7px;height:7px;border-radius:4px}
.pnm{flex:1;font-size:13px;font-weight:600;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tag{font-size:9.5px;font-weight:800;padding:3px 7px;border-radius:6px;letter-spacing:.3px}
`, `${statusBar}${header('Good morning','Arjun Mehta','AM')}
<div class="body">
 <div class="sec">Attendance</div>
 <div class="chart">
  <div class="chdr"><div><div class="ct">Working hours</div><div class="cs">Your attendance this week</div></div>
   <div class="filt"><span class="ft">7D</span><span class="ft">30D</span><span class="ft on">3M</span></div></div>
  <div class="plot"><div class="grid"><span></span><span></span><span></span><span></span></div>
   <div class="brow">${bars.map(([d,h])=>`<div class="bcol"><div class="btrack"><div class="bfill" style="height:${h}%"></div></div><div class="blab">${d}</div></div>`).join('')}</div></div>
  <div class="cfoot"><div><div class="avgv">8h 12m</div><div class="avgl">Weekly average</div></div>
   <div class="cbadge">${icon('arrow-up',11,'#16A34A',2.6)} 8.4%</div></div>
 </div>
 <div class="panel">
  <div class="phdr"><div class="phl"><div class="pi" style="background:#ECFDF5">${icon('calendar',17,'#16A34A',2)}</div><div class="ptl">Leave Balance</div></div>${icon('chevron-right',17,'#CBD5E1',2)}</div>
  <div class="pvrow"><div class="pbig">14</div><div class="punit">days remaining</div></div>
  <div class="track"><div class="fill" style="width:42%"></div></div>
  <div class="plabs"><span class="plab">10 used</span><span class="plab">24 total</span></div>
 </div>
 <div class="panel">
  <div class="phdr"><div class="phl"><div class="pi" style="background:#FFF7ED">${icon('briefcase',17,'#EA580C',2)}</div><div class="ptl">Active Projects</div></div><span class="cpill">6</span></div>
  <div class="prow"><span class="pdot" style="background:#EA580C"></span><span class="pnm">Metro Depot Expansion</span><span class="tag" style="background:#FFF7ED;color:#EA580C">WIP</span></div>
  <div class="prow"><span class="pdot" style="background:#EA580C"></span><span class="pnm">Riverside Retail Fit-out</span><span class="tag" style="background:#FFF7ED;color:#EA580C">WIP</span></div>
  <div class="prow"><span class="pdot" style="background:#16A34A"></span><span class="pnm">Northgate Solar Audit</span><span class="tag" style="background:#F0FDF4;color:#16A34A">DONE</span></div>
 </div>
</div>`);


/* ---------- Screen 3: Field Visits ---------- */
const topBar = (title, sub, btn) => `<div class="tbar"><div class="tl"><div class="back">${icon('chevron-right',19,'#0F172A',2.2)}</div><div><div class="ttl">${title}</div><div class="tsub">${sub}</div></div></div>${btn||''}</div>`;

const screen3 = shell(`
.tbar{display:flex;align-items:center;justify-content:space-between;padding:6px 16px 12px}
.tl{display:flex;align-items:center;gap:10px}
.back{width:34px;height:34px;border-radius:11px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,.05);transform:rotate(180deg)}
.ttl{font-size:17px;font-weight:800;color:#0F172A;letter-spacing:-.2px}
.tsub{font-size:11.5px;color:#94A3B8;font-weight:500;margin-top:1px}
.newbtn{display:flex;align-items:center;gap:5px;background:#E25E3E;color:#fff;font-size:12.5px;font-weight:700;padding:8px 13px;border-radius:20px;box-shadow:0 4px 10px rgba(226,94,62,.28)}
.live{background:#0F172A;border-radius:22px;padding:16px;border:1.5px solid rgba(226,94,62,.4);box-shadow:0 6px 18px rgba(226,94,62,.18);margin-bottom:14px;position:relative;overflow:hidden}
.lglow{position:absolute;top:-60px;right:-50px;width:170px;height:170px;border-radius:99px;background:radial-gradient(circle,rgba(226,94,62,.35),transparent 70%)}
.ltop{position:relative;display:flex;align-items:center;justify-content:space-between;margin-bottom:11px}
.ltag{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:800;color:#FDBA74;letter-spacing:1px}
.pulse{width:8px;height:8px;border-radius:5px;background:#E25E3E;box-shadow:0 0 0 4px rgba(226,94,62,.25)}
.gps{display:flex;align-items:center;gap:4px;background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.3);padding:4px 9px;border-radius:20px;font-size:10.5px;font-weight:700;color:#38BDF8}
.lproj{position:relative;font-size:19px;font-weight:800;color:#fff;letter-spacing:-.4px}
.lpurp{position:relative;background:rgba(255,255,255,.07);border-radius:11px;padding:9px 11px;margin-top:10px;font-size:12px;color:#CBD5E1;line-height:1.45}
.mrow{position:relative;display:flex;align-items:center;margin-top:14px}
.mbox{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px}
.mi{width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center}
.mv{font-size:14px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums}
.ml{font-size:10px;color:#94A3B8;font-weight:600}
.mdiv{width:1px;height:38px;background:rgba(255,255,255,.1)}
.lact{position:relative;display:flex;gap:10px;margin-top:14px}
.endbtn{flex:1;display:flex;align-items:center;justify-content:center;gap:7px;background:#E25E3E;color:#fff;font-size:14px;font-weight:700;padding:11px;border-radius:14px}
.cxbtn{width:46px;border-radius:14px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);display:flex;align-items:center;justify-content:center}
.kpi{display:flex;align-items:center;background:#fff;border-radius:20px;padding:12px 6px;box-shadow:0 2px 8px rgba(15,23,42,.04);margin-bottom:14px}
.ki{flex:1;text-align:center}
.kv{font-size:18px;font-weight:800;color:#0F172A;letter-spacing:-.3px}
.ku{font-size:11px;font-weight:700}
.kl{font-size:10.5px;color:#94A3B8;font-weight:600;margin-top:3px}
.kd{width:1px;height:30px;background:#F1F5F9}
.hcard{background:#fff;border-radius:18px;padding:14px;box-shadow:0 2px 8px rgba(15,23,42,.04);margin-bottom:10px}
.hh{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.hpt{display:flex;align-items:center;gap:8px}
.hdot{width:8px;height:8px;border-radius:4px}
.hp{font-size:14px;font-weight:700;color:#0F172A}
.spill{display:flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:700;border:1px solid}
.drow{display:flex;align-items:center;gap:5px;margin-bottom:9px}
.dtxt{font-size:11px;color:#94A3B8;font-weight:600}
.chips{display:flex;gap:7px}
.chip{display:flex;align-items:center;gap:4px;background:#EFF6FF;padding:5px 9px;border-radius:9px;font-size:11px;font-weight:700;color:#2563EB}
.cbadge2{background:#FFF1EC;color:#E25E3E;font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:9px}
`, `${statusBar}
${topBar('Field Visits','Track your site visits & route','')}
<div class="body">
 <div class="live"><div class="lglow"></div>
  <div class="ltop"><div class="ltag"><span class="pulse"></span>LIVE TRACKING</div>
   <div class="gps">${icon('navigation',11,'#38BDF8',2.2)} GPS Active</div></div>
  <div class="lproj">Metro Depot Expansion</div>
  <div class="lpurp">Site inspection &amp; contractor handover — Phase 2</div>
  <div class="mrow">
   <div class="mbox"><div class="mi" style="background:rgba(226,94,62,.18)">${icon('clock',15,'#E25E3E',2)}</div><div class="mv">01:24:07</div><div class="ml">Elapsed</div></div>
   <div class="mdiv"></div>
   <div class="mbox"><div class="mi" style="background:rgba(56,189,248,.18)">${icon('navigation',15,'#38BDF8',2)}</div><div class="mv">18.42 km</div><div class="ml">Distance</div></div>
   <div class="mdiv"></div>
   <div class="mbox"><div class="mi" style="background:rgba(168,85,247,.18)">${icon('map-pin',15,'#C084FC',2)}</div><div class="mv">146</div><div class="ml">Points</div></div>
  </div>
  <div class="lact"><div class="endbtn"><svg width="13" height="13" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" fill="#fff"/></svg>End Visit</div>
   <div class="cxbtn">${icon('x',17,'#EF4444',2.5)}</div></div>
 </div>
 <div class="kpi">
  <div class="ki"><div class="kv">28</div><div class="kl">Total Visits</div></div><div class="kd"></div>
  <div class="ki"><div class="kv" style="color:#E25E3E">312.6 <span class="ku">km</span></div><div class="kl">Distance</div></div><div class="kd"></div>
  <div class="ki"><div class="kv">46h 20m</div><div class="kl">Time Logged</div></div>
 </div>
 <div class="secrow"><div class="sec" style="margin:0">Visit History</div><span class="cbadge2">28</span></div>
 <div class="hcard">
  <div class="hh"><div class="hpt"><span class="hdot" style="background:#2563EB"></span><span class="hp">Riverside Retail Fit-out</span></div>
   <span class="spill" style="background:#F0FDF4;border-color:#BBF7D0;color:#16A34A"><span class="hdot" style="background:#16A34A"></span>Completed</span></div>
  <div class="drow">${icon('calendar',11,'#94A3B8',2)}<span class="dtxt">8 Sep 2026  •  10:15 AM</span></div>
  <div class="chips"><span class="chip">${icon('navigation',12,'#2563EB',2)} 12.80 km</span>
   <span class="chip" style="background:#FFF1EC;color:#E25E3E">${icon('clock',12,'#E25E3E',2)} 2h 05m</span>
   <span class="chip" style="background:#FAF5FF;color:#9333EA">${icon('camera',12,'#9333EA',2)} 4 photos</span></div>
 </div>
 <div class="hcard">
  <div class="hh"><div class="hpt"><span class="hdot" style="background:#16A34A"></span><span class="hp">Northgate Solar Audit</span></div>
   <span class="spill" style="background:#F0FDF4;border-color:#BBF7D0;color:#16A34A"><span class="hdot" style="background:#16A34A"></span>Completed</span></div>
  <div class="drow">${icon('calendar',11,'#94A3B8',2)}<span class="dtxt">5 Sep 2026  •  09:02 AM</span></div>
  <div class="chips"><span class="chip">${icon('navigation',12,'#2563EB',2)} 31.05 km</span>
   <span class="chip" style="background:#FFF1EC;color:#E25E3E">${icon('clock',12,'#E25E3E',2)} 3h 40m</span></div>
 </div>
</div>`);

/* ---------- Screen 4: Payslips ---------- */
const psRow = (label, value, color) => `<div class="drow2"><span class="dl">${label}</span><span class="dv" style="${color?`color:${color}`:''}">${value}</span></div>`;

const screen4 = shell(`
.pbar{display:flex;align-items:center;gap:10px;padding:6px 16px 14px}
.psub{font-size:11.5px;color:#94A3B8;font-weight:500;margin-top:1px}
.dlbtn{width:34px;height:34px;border-radius:11px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,.05)}
.back{width:34px;height:34px;border-radius:11px;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(15,23,42,.05);transform:rotate(180deg)}
.ptitle{font-size:17px;font-weight:800;color:#0F172A}
.ybar{display:flex;gap:8px;background:#fff;border-radius:14px;padding:4px;margin-bottom:12px;box-shadow:0 2px 6px rgba(15,23,42,.04)}
.yt{flex:1;text-align:center;font-size:12.5px;font-weight:700;color:#64748B;padding:6px 0;border-radius:10px}
.yt.on{background:#FFF1EC;color:#E25E3E}
.pcard{background:#fff;border-radius:18px;padding:13px 14px;box-shadow:0 2px 8px rgba(15,23,42,.04);margin-bottom:10px}
.crow{display:flex;align-items:center;gap:12px}
.cico{width:44px;height:44px;border-radius:12px;background:#FFF1EC;display:flex;align-items:center;justify-content:center}
.cm{font-size:13.5px;font-weight:600;color:#64748B}
.cn{font-size:17px;font-weight:800;color:#0F172A;letter-spacing:-.3px;margin-top:1px}
.sb2{font-size:10px;font-weight:800;padding:4px 9px;border-radius:8px;letter-spacing:.3px}
.dtitle{display:flex;align-items:center;gap:7px;margin-bottom:10px}
.dt2{font-size:13.5px;font-weight:800;color:#0F172A}
.drow2{display:flex;justify-content:space-between;align-items:center;padding:4.5px 0}
.dl{font-size:12.5px;color:#64748B;font-weight:500}
.dv{font-size:12.5px;color:#0F172A;font-weight:700;font-variant-numeric:tabular-nums}
.dvd{height:1px;background:#F1F5F9;margin:8px 0}
.tot .dl,.tot .dv{font-weight:800;color:#0F172A;font-size:13px}
.net{background:#E25E3E;border-radius:18px;padding:17px 18px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 8px 18px rgba(226,94,62,.28)}
.netl{font-size:15px;font-weight:700;color:#fff}
.netv{font-size:21px;font-weight:800;color:#fff;letter-spacing:-.4px}
`, `${statusBar}
<div class="pbar"><div class="back">${icon('chevron-right',19,'#0F172A',2.2)}</div>
 <div style="flex:1"><div class="ptitle">August 2026</div><div class="psub">Payslip &middot; Arjun Mehta</div></div>
 <span class="sb2" style="background:#F0FDF4;color:#16A34A">PAID</span>
 <div class="dlbtn">${icon('download',17,'#E25E3E',2.2)}</div></div>
<div class="body">
 <div class="pcard"><div class="crow"><div class="cico">${icon('file-text',20,'#E25E3E',2)}</div>
  <div style="flex:1"><div class="cm">Net pay credited</div><div class="cn">₹ 86,420.00</div></div>
  <div style="text-align:right"><div class="cm" style="font-size:11px">Pay date</div><div style="font-size:12.5px;font-weight:700;color:#0F172A">31 Aug 2026</div></div></div></div>
 <div class="pcard">
  <div class="dtitle">${icon('arrow-up',14,'#16A34A',2.4)}<span class="dt2">Earnings</span></div>
  ${psRow('Basic Salary','₹ 52,000.00')}
  ${psRow('House Rent Allowance','₹ 20,800.00')}
  ${psRow('Conveyance','₹ 4,800.00')}
  ${psRow('Special Allowance','₹ 12,400.00')}
  ${psRow('Field Travel Reimbursement','₹ 4,200.00')}
  <div class="dvd"></div>
  <div class="drow2 tot"><span class="dl">Total Earnings</span><span class="dv">₹ 94,200.00</span></div>
 </div>
 <div class="pcard">
  <div class="dtitle"><span style="transform:rotate(180deg);display:flex">${icon('arrow-up',14,'#EF4444',2.4)}</span><span class="dt2">Deductions</span></div>
  ${psRow('Provident Fund','₹ 6,240.00')}
  ${psRow('Professional Tax','₹ 200.00')}
  ${psRow('Loss of Pay','₹ 1,340.00','#EF4444')}
  <div class="dvd"></div>
  <div class="drow2 tot"><span class="dl">Total Deductions</span><span class="dv">₹ 7,780.00</span></div>
 </div>
 <div class="net"><span class="netl">Net Pay</span><span class="netv">₹ 86,420.00</span></div>
</div>`);

fs.writeFileSync(process.env.SP + '/s3.html', screen3);
fs.writeFileSync(process.env.SP + '/s4.html', screen4);
console.log('screens 3-4 written');

fs.writeFileSync(process.env.SP + '/s1.html', screen1);
fs.writeFileSync(process.env.SP + '/s2.html', screen2);
console.log('screens 1-2 written');
