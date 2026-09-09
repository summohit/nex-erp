const fs = require('fs');
const path = require('path');
const { icon, BASE_CSS, LOGO } = require('./common.js');
const SP = process.env.SP;

const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(SP, f)).toString('base64');

// Each panel: the screen it frames, its accent, and the one thing it promises.
const PANELS = [
  { file: 's1.png', out: 'c1', eyebrow: 'ATTENDANCE',  accent: '#FB923C', glow: 'rgba(251,146,60,.34)',
    head: 'Clock in from<br>anywhere',       sub: 'One tap in, one tap out — your hours tracked live all day.' },
  { file: 's2.png', out: 'c2', eyebrow: 'INSIGHTS',    accent: '#4ADE80', glow: 'rgba(74,222,128,.28)',
    head: 'See where your<br>hours go',      sub: 'Working-hour trends, leave balance and projects at a glance.' },
  { file: 's3.png', out: 'c3', eyebrow: 'FIELD VISITS', accent: '#C084FC', glow: 'rgba(192,132,252,.30)',
    head: 'Site visits tracked<br>by live GPS', sub: 'Route, distance and duration logged the moment you set off.' },
  { file: 's4.png', out: 'c4', eyebrow: 'PAYROLL',     accent: '#60A5FA', glow: 'rgba(96,165,250,.30)',
    head: 'Payslips in<br>your pocket',      sub: 'Every earning, deduction and reimbursement, itemised.' },
];

const page = (p) => `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html,body{width:360px;height:640px;overflow:hidden}
.p{width:360px;height:640px;position:relative;overflow:hidden;
  background:linear-gradient(160deg,#131E32 0%,#0F172A 42%,#150F1E 100%)}
.ga{position:absolute;left:-130px;top:-160px;width:480px;height:480px;border-radius:50%;
  background:radial-gradient(circle,${p.glow},transparent 64%)}
.gb{position:absolute;right:-160px;bottom:-150px;width:460px;height:460px;border-radius:50%;
  background:radial-gradient(circle,rgba(226,94,62,.26),transparent 66%)}
.grid{position:absolute;inset:0;opacity:.3;
  background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);
  background-size:34px 34px;-webkit-mask-image:linear-gradient(180deg,rgba(0,0,0,.85),transparent 62%)}
.top{position:relative;z-index:3;padding:30px 30px 0}
.hrow{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.brand{display:flex;align-items:center;gap:7px;opacity:.9}
.brand img{width:20px;height:20px;border-radius:6px;background:#fff}
.brand span{font-size:10.5px;font-weight:800;color:#CBD5E1;letter-spacing:.6px}
.eyebrow{display:inline-flex;align-items:center;gap:6px;font-size:9.5px;font-weight:800;letter-spacing:2px;
  color:${p.accent};background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);
  padding:6px 12px;border-radius:999px}
.eyebrow i{width:5px;height:5px;border-radius:3px;background:${p.accent};display:block}
h1{font-size:27px;line-height:1.2;font-weight:800;color:#fff;letter-spacing:-.8px;margin-bottom:10px}
.sub{font-size:12.5px;line-height:1.55;color:#94A3B8;font-weight:500;max-width:290px}
.stage{position:absolute;left:0;right:0;top:192px;display:flex;justify-content:center;z-index:2}
.ph{width:252px;border-radius:26px;overflow:hidden;background:#0B1220;border:5px solid #1E293B;
  box-shadow:0 26px 56px rgba(0,0,0,.6)}
.ph img{width:100%;display:block}
</style></head><body><div class="p">
<div class="ga"></div><div class="gb"></div><div class="grid"></div>
<div class="top">
 <div class="hrow"><div class="eyebrow"><i></i>${p.eyebrow}</div>
  <div class="brand"><img src="${LOGO}"><span>NEX ERP</span></div></div>
 <h1>${p.head}</h1>
 <div class="sub">${p.sub}</div>
</div>
<div class="stage"><div class="ph"><img src="${b64(p.file)}"></div></div>
</div></body></html>`;

for (const p of PANELS) fs.writeFileSync(path.join(SP, p.out + '.html'), page(p));
console.log('captioned panels written:', PANELS.length);
