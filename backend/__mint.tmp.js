const jwt = require('jsonwebtoken');
const fs = require('fs');
const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
const line = lines.find((l) => l.trim().startsWith('JWT_SECRET='));
let secret = line ? line.slice(line.indexOf('=') + 1).trim() : '';
if ((secret.startsWith('"') && secret.endsWith('"')) || (secret.startsWith("'") && secret.endsWith("'"))) {
  secret = secret.slice(1, -1);
}
if (!secret) { console.error('no JWT_SECRET found'); process.exit(1); }
process.stdout.write(jwt.sign({ sub: 101, companyId: 1, role: 'ADMIN', employeeId: 1 }, secret, { expiresIn: '5m' }));
