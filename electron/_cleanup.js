const fs = require('fs');
const f = 'D:/HuaweiMoveData/Users/Anne/Desktop/心元AI/xinyuan-1.0.11/xinyuan-emo-mate/electron/ai-conversation.js';
let c = fs.readFileSync(f, 'utf8');
// Remove dead code block (old sequential STT fallback)
const deadStart = '    try { unlinkSync(STT_WAV); } catch (_) {}\n    if (sttText === null) {';
const deadEnd = '    try { unlinkSync(STT_WAV); } catch (_) {}\n    console.log';
let i1 = c.indexOf(deadStart);
let i2 = c.indexOf(deadEnd, i1 + 10);
if (i1 >= 0 && i2 > i1) {
  c = c.slice(0, i1 + 48) + '\n' + c.slice(i2);
  fs.writeFileSync(f, c, 'utf8');
  console.log('OK: dead code removed');
} else {
  console.log('NOT FOUND: i1=' + i1 + ' i2=' + i2);
}
