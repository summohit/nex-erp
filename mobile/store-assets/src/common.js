const fs = require('fs');
const path = require('path');
const ICONS = JSON.parse(fs.readFileSync(path.join(__dirname,'icons.json'),'utf8'));
// Brand mark, taken straight from the web app's icon so store and product stay in step.
const LOGO_PATH = path.join(__dirname, '..', '..', '..', 'frontend', 'public', 'icon.png');
const LOGO_B64 = fs.readFileSync(LOGO_PATH).toString('base64');
const LOGO = `data:image/png;base64,${LOGO_B64}`;

function icon(name, size, color, sw) {
  const body = ICONS[name];
  if (!body) throw new Error('no icon ' + name);
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw||2}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0;-webkit-font-smoothing:antialiased}
body{font-family:'SF Pro Display','SF Pro Text',-apple-system,'Helvetica Neue',Arial,sans-serif;}
svg{display:block}
`;
module.exports = { ICONS, LOGO, icon, BASE_CSS };
