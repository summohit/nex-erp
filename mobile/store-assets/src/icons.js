const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '..', 'node_modules', 'lucide-react-native', 'dist', 'esm', 'icons');
const names = ['menu','bell','calendar','clock','receipt','map-pin','briefcase','play','chevron-right','chevron-down','arrow-up','plus','wallet','file-text','navigation','camera','check','user','search','download','trending-up','x','circle-check-big','square-check-big','sun','umbrella','banknote','list-checks','shield-check'];
const out = {};
for (const n of names) {
  const p = path.join(dir, `${n}.mjs`);
  if (!fs.existsSync(p)) { console.error('MISSING', n); continue; }
  const src = fs.readFileSync(p,'utf8');
  const start = src.indexOf('createLucideIcon(');
  const arrStart = src.indexOf('[', start);
  const arrEnd = src.lastIndexOf(']);');
  let body = src.slice(arrStart, arrEnd+1);
  // strip keys
  body = body.replace(/,\s*key:\s*"[^"]*"/g,'');
  let nodes;
  try { nodes = eval(body); } catch(e){ console.error('EVAL FAIL', n, e.message); continue; }
  out[n] = nodes.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}/>`).join('');
}
fs.writeFileSync(process.argv[2] || path.join(__dirname,'icons.json'), JSON.stringify(out,null,1));
console.log('ok', Object.keys(out).length);
