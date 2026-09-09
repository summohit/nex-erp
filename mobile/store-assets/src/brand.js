const fs = require('fs');
const { icon, BASE_CSS, LOGO } = require('./common.js');
const SP = process.env.SP;
const shot1 = 'data:image/png;base64,' + fs.readFileSync(SP + '/s1.png').toString('base64');
const shot3 = 'data:image/png;base64,' + fs.readFileSync(SP + '/s3.png').toString('base64');

/* ---------------- App icon 512x512 ---------------- */
const iconHtml = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html,body{width:512px;height:512px;overflow:hidden}
.i{width:512px;height:512px;position:relative;
  background:radial-gradient(120% 120% at 30% 22%, #FFFFFF 0%, #FFFBF9 45%, #FFF0EA 100%);
  display:flex;align-items:center;justify-content:center}
.i:before{content:'';position:absolute;left:-90px;bottom:-120px;width:340px;height:340px;border-radius:50%;
  background:radial-gradient(circle,rgba(226,94,62,.10),transparent 68%)}
.i:after{content:'';position:absolute;right:-70px;top:-90px;width:300px;height:300px;border-radius:50%;
  background:radial-gradient(circle,rgba(124,58,237,.07),transparent 68%)}
img{width:452px;height:452px;position:relative;z-index:2}
</style></head><body><div class="i"><img src="${LOGO}"></div></body></html>`;
fs.writeFileSync(SP + '/icon.html', iconHtml);

/* ---------------- Feature graphic 1024x500 ---------------- */
const feat = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
html,body{width:1024px;height:500px;overflow:hidden}
.f{width:1024px;height:500px;position:relative;overflow:hidden;
  background:linear-gradient(135deg,#111C2E 0%,#0F172A 45%,#160F1F 100%)}
.g1{position:absolute;left:-120px;top:-170px;width:620px;height:620px;border-radius:50%;
  background:radial-gradient(circle,rgba(226,94,62,.42),transparent 62%)}
.g2{position:absolute;right:120px;bottom:-260px;width:640px;height:640px;border-radius:50%;
  background:radial-gradient(circle,rgba(147,51,234,.30),transparent 62%)}
.g3{position:absolute;right:-140px;top:-120px;width:520px;height:520px;border-radius:50%;
  background:radial-gradient(circle,rgba(37,99,235,.22),transparent 64%)}
.grid{position:absolute;inset:0;opacity:.30;
  background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);
  background-size:44px 44px;
  -webkit-mask-image:linear-gradient(100deg,rgba(0,0,0,.9),transparent 72%)}
.wrap{position:relative;z-index:3;height:100%;display:flex;align-items:center;padding:0 62px}
.left{width:600px}
.brandrow{display:flex;align-items:center;gap:16px;margin-bottom:22px}
.mark{width:74px;height:74px;border-radius:22px;background:#fff;display:flex;align-items:center;justify-content:center;
  box-shadow:0 12px 34px rgba(226,94,62,.32)}
.mark img{width:64px;height:64px}
.bn{font-size:38px;font-weight:800;color:#fff;letter-spacing:-.8px;line-height:1}
.bs{font-size:12.5px;font-weight:700;color:#F59E8C;letter-spacing:2.4px;margin-top:7px}
h1{font-size:44px;line-height:1.14;font-weight:800;color:#fff;letter-spacing:-1.2px;margin-bottom:16px}
h1 em{font-style:normal;background:linear-gradient(90deg,#FB923C,#E25E3E 55%,#C026D3);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
p.sub{font-size:16.5px;line-height:1.55;color:#94A3B8;font-weight:500;max-width:520px;margin-bottom:26px}
.chips{display:flex;flex-wrap:wrap;gap:9px;max-width:540px}
.chip{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.13);
  border-radius:999px;padding:9px 15px;font-size:13.5px;font-weight:600;color:#E2E8F0}
.right{flex:1;position:relative;height:100%}
.ph{position:absolute;border-radius:34px;overflow:hidden;background:#0B1220;
  border:6px solid #1E293B;box-shadow:0 34px 70px rgba(0,0,0,.55)}
.ph img{width:100%;display:block}
.ph1{width:236px;top:44px;right:74px;transform:rotate(-5deg)}
.ph2{width:198px;top:120px;right:-34px;transform:rotate(6deg);opacity:.96}
</style></head><body><div class="f">
<div class="g1"></div><div class="g2"></div><div class="g3"></div><div class="grid"></div>
<div class="wrap">
 <div class="left">
  <div class="brandrow"><div class="mark"><img src="${LOGO}"></div>
   <div><div class="bn">NEX ERP</div><div class="bs">MODERN WORKSPACE SUITE</div></div></div>
  <h1>Your workday,<br><em>managed from your pocket</em></h1>
  <p class="sub">Clock in, apply for leave, log field visits with live GPS, claim expenses and download payslips — all in one app.</p>
  <div class="chips">
   <span class="chip">${icon('clock',15,'#FB923C',2.2)} Attendance</span>
   <span class="chip">${icon('calendar',15,'#4ADE80',2.2)} Leave</span>
   <span class="chip">${icon('map-pin',15,'#C084FC',2.2)} Field Visits</span>
   <span class="chip">${icon('receipt',15,'#60A5FA',2.2)} Expenses</span>
   <span class="chip">${icon('file-text',15,'#F472B6',2.2)} Payslips</span>
  </div>
 </div>
 <div class="right">
  <div class="ph ph2"><img src="${shot3}"></div>
  <div class="ph ph1"><img src="${shot1}"></div>
 </div>
</div></div></body></html>`;
fs.writeFileSync(SP + '/feature.html', feat);
console.log('brand html written');
