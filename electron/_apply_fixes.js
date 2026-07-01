// Apply latency optimizations to ai-conversation.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'ai-conversation.js');
let content = fs.readFileSync(file, 'utf8');
let changes = 0;

// Fix 1: STT race optimization - parallel Coze ASR vs local System.Speech
// Replace sequential fallback with parallel race
const oldStt = `    const t1 = Date.now();
    // 🚀 并行 Coze ASR + System.Speech
    const sysSttPromise = (async () => { try { return await windowsSTT(STT_WAV); } catch (_) { return null; } })();
    let sttText = await cozeStt(STT_WAV);
    let cozeRetryPromise = null;
    if (sttText === null) {
      // Coze ASR 空返回，500ms内并行等本地结果
      cozeRetryPromise = (async () => { await new Promise(r => setTimeout(r, 500)); return await cozeStt(STT_WAV); })();
      const winner = await Promise.race([cozeRetryPromise, sysSttPromise]);
      if (winner) { sttText = winner; }
    }
    if (sttText === null) {
      console.log('[AI对话] 🔄 Coze+本地并行均失败，最终回落...');
      sttText = await sysSttPromise;
    }
    // 等待所有后台 STT 读取器完成，再删除 WAV（避免 ENOENT）
    if (cozeRetryPromise) await cozeRetryPromise.catch(() => {});
    await sysSttPromise.catch(() => {});
    try { unlinkSync(STT_WAV); } catch (_) {}
    console.log('[AI对话] ⏱️ STT耗时:', Date.now() - t1, 'ms');`;

const newStt = `    const t1 = Date.now();
    // 🚀 并行竞速：Coze ASR vs 本地 System.Speech，取第一个有效结果（节省 0.5-2s）
    const sysSttPromise = (async () => { try { return await windowsSTT(STT_WAV); } catch (_) { return null; } })();
    const cozePromise = cozeStt(STT_WAV).then(r => (r && r.length > 0) ? r : null);

    let sttText = null;
    const raceResult = await Promise.race([
      cozePromise.then(r => r ? { src: 'coze', text: r } : null),
      sysSttPromise.then(r => (r && r.length > 0) ? { src: 'sys', text: r } : null),
    ]);

    if (raceResult && raceResult.text) {
      sttText = raceResult.text;
      console.log('[AI对话] ⚡ STT竞速胜出:', raceResult.src, '\u2192', sttText.slice(0, 30));
    } else {
      const [cozeResult, sysResult] = await Promise.all([cozePromise.catch(() => null), sysSttPromise.catch(() => null)]);
      sttText = cozeResult || sysResult;
      if (!sttText) console.log('[AI对话] ⚡ STT竞速双败，无有效结果');
    }
    await Promise.allSettled([cozePromise, sysSttPromise]);
    try { unlinkSync(STT_WAV); } catch (_) {}
    console.log('[AI对话] \u23F1\uFE0F STT耗时:', Date.now() - t1, 'ms');`;

if (content.includes(oldStt)) {
  content = content.replace(oldStt, newStt);
  changes++;
  console.log('[FIX] STT race optimization applied');
} else {
  console.log('[WARN] STT old pattern not found');
}

// Fix 2: Reduce SSE silence timeout 800ms → 500ms
const oldSseSilence = '(Date.now() - lastData > 800)';
const newSseSilence = '(Date.now() - lastData > 500)';
if (content.includes(oldSseSilence)) {
  content = content.replace(oldSseSilence, newSseSilence);
  changes++;
  console.log('[FIX] SSE silence timeout 800→500');
} else {
  console.log('[WARN] SSE silence not found');
}

// Fix 3: Reduce cooldown 1000ms → 500ms
const oldCooldown = 'const cooldownMs = 1000;';
const newCooldown = 'const cooldownMs = 500;';
if (content.includes(oldCooldown)) {
  content = content.replace(oldCooldown, newCooldown);
  changes++;
  console.log('[FIX] Cooldown 1000→500');
} else {
  console.log('[WARN] Cooldown not found');
}

// Fix 4: Reduce tail pad 4800 → 2400 (300ms → 150ms)
const oldTail = 'const tailPad = 4800;';
const newTail = 'const tailPad = 2400;';
if (content.includes(oldTail)) {
  content = content.replace(oldTail, newTail);
  changes++;
  console.log('[FIX] Tail pad 4800→2400');
} else {
  console.log('[WARN] Tail pad not found');
}

// Fix 5: Reduce FRAME_GAP 50ms → 40ms (faster frame delivery)
const oldGap = 'const FRAME_GAP = 50;';
const newGap = 'const FRAME_GAP = 40;';
if (content.includes(oldGap)) {
  content = content.replace(oldGap, newGap);
  changes++;
  console.log('[FIX] FRAME_GAP 50→40');
} else {
  console.log('[WARN] FRAME_GAP not found');
}

if (changes > 0) {
  fs.writeFileSync(file, content, 'utf8');
  console.log(`[DONE] Applied ${changes} optimizations`);
} else {
  console.log('[ERROR] No changes applied!');
}
