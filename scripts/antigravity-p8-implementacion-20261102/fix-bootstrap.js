const fs = require('fs');
const filePath = 'output/antigravity-p8-implementacion-20261102/workspace/src/app/api/v1/owner/bootstrap/route.ts';
let content = fs.readFileSync(filePath, 'utf8');
const lines = content.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const cacheKey =')) {
    lines[i] = '    const cacheKey = `bootstrap:${uid}`;';
    break;
  }
}
fs.writeFileSync(filePath, lines.join('\r\n'), 'utf8');
console.log('Fixed line successfully');
