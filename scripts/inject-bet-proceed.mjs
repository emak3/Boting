/**
 * raceSchedule.mjs 内の buildSelectionRow({ ... }), の直後に
 * betProceedButtonRow(raceId, customId式), を挿入する（冪等）
 */
import fs from 'fs';

const path = 'discord/interactions/menu/raceSchedule.mjs';
let s = fs.readFileSync(path, 'utf8');

const blockRe = /buildSelectionRow\(\{[\s\S]*?\r?\n\s*\}\),\r?\n/g;
let m;
let count = 0;
const out = [];
let last = 0;

while ((m = blockRe.exec(s)) !== null) {
  const full = m[0];
  const tail = s.slice(m.index + full.length, m.index + full.length + 120);
  if (tail.includes('betProceedButtonRow')) {
    out.push(s.slice(last, m.index + full.length));
    last = m.index + full.length;
    continue;
  }
  const cm = full.match(
    /customId:\s*((?:`(?:\$\{[^}]+\}|[^`])*`|'[^']+'|[a-zA-Z_]\w*))/,
  );
  if (!cm) {
    out.push(s.slice(last, m.index + full.length));
    last = m.index + full.length;
    continue;
  }
  const idExpr = cm[1];
  const insert = `${full}          betProceedButtonRow(raceId, ${idExpr}),\r\n`;
  out.push(s.slice(last, m.index));
  out.push(insert);
  last = m.index + full.length;
  count++;
}
out.push(s.slice(last));
s = out.join('');

fs.writeFileSync(path, s);
console.log('Inserted betProceedButtonRow after', count, 'buildSelectionRow blocks');
