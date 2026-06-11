// 模拟 Coze 回复的诊断测试 - 逐步追踪截断位置

// === 从源码复制的 extractContent ===
function extractContent(msg) {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c.trim();
  if (c && typeof c === 'object') {
    if (typeof c.text === 'string') return c.text.trim();
    if (c.type === 'text' && typeof c.text === 'string') return c.text.trim();
    if (Array.isArray(c)) {
      return c
        .filter(b => b && (b.type === 'text') && typeof b.text === 'string')
        .map(b => b.text)
        .join('')
        .trim();
    }
    if (c.content) return extractContent(c);
  }
  return '';
}

// === 从源码复制的 extractLatestAnswerFromMessages ===
function extractLatestAnswerFromMessages(messages) {
  if (!messages || messages.length === 0) return '';
  const answers = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') break;
    if (m.role === 'assistant' && m.type === 'answer') {
      const text = extractContent(m);
      if (text) answers.push(text);
    }
  }
  return answers.reverse().join('');
}

// === 从源码复制的 cleanContent ===
function cleanContent(text) {
  text = text.replace(/\s*\{["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null)(\s*,\s*["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null))*\s*\}\s*$/g, '');
  text = text.replace(/```json\s*[\s\S]*?\s*```/g, '');
  return text.trim();
}

console.log('=== 测试1: 正常回复（字符串 content）===');
const msgs1 = [
  { role: 'user', type: 'user', content: '你好' },
  { role: 'assistant', type: 'verbose', content: '思考中...' },
  { role: 'assistant', type: 'answer', content: '你好呀！我是心元，很高兴认识你！有什么我可以帮你的吗？' },
  { role: 'assistant', type: 'follow_up', content: '还有其他想聊的吗？' },
];
let raw = extractLatestAnswerFromMessages(msgs1);
let cleaned = cleanContent(raw);
console.log('raw:', JSON.stringify(raw));
console.log('cleaned:', JSON.stringify(cleaned));
console.log('length:', cleaned.length, '\n');

console.log('=== 测试2: 带 JSON 元数据的回复 ===');
const msgs2 = [
  { role: 'user', type: 'user', content: '你好' },
  { role: 'assistant', type: 'answer', content: '好的\n{"emotion": "positive"}' },
];
raw = extractLatestAnswerFromMessages(msgs2);
console.log('raw:', JSON.stringify(raw));
cleaned = cleanContent(raw);
console.log('cleaned:', JSON.stringify(cleaned));
console.log('length:', cleaned.length, '\n');

console.log('=== 测试3: 回复末尾有 JSON 但正文也短 ===');
const msgs3 = [
  { role: 'user', type: 'user', content: '你在吗' },
  { role: 'assistant', type: 'answer', content: '在呢{"status":"active","mood":"happy"}' },
];
raw = extractLatestAnswerFromMessages(msgs3);
console.log('raw:', JSON.stringify(raw));
cleaned = cleanContent(raw);
console.log('cleaned:', JSON.stringify(cleaned));
console.log('length:', cleaned.length, '\n');

console.log('=== 测试4: 对象 content（type=text）===');
const msgs4 = [
  { role: 'user', type: 'user', content: '你好' },
  { role: 'assistant', type: 'answer', content: { type: 'text', text: '你好呀！我是心元，很高兴认识你！有什么我可以帮你的吗？' } },
];
raw = extractLatestAnswerFromMessages(msgs4);
console.log('raw:', JSON.stringify(raw));
cleaned = cleanContent(raw);
console.log('cleaned:', JSON.stringify(cleaned));
console.log('length:', cleaned.length, '\n');

console.log('=== 测试5: 数组 content ===');
const msgs5 = [
  { role: 'user', type: 'user', content: '你好' },
  { role: 'assistant', type: 'answer', content: [
    { type: 'text', text: '你好呀！' },
    { type: 'text', text: '我是心元，很高兴认识你！' },
  ] },
];
raw = extractLatestAnswerFromMessages(msgs5);
console.log('raw:', JSON.stringify(raw));
cleaned = cleanContent(raw);
console.log('cleaned:', JSON.stringify(cleaned));
console.log('length:', cleaned.length, '\n');

console.log('=== 测试6: 旧方式（全量 answer filter）vs 新方式 ===');
const msgs6 = [
  { role: 'user', type: 'user', content: '你好' },
  { role: 'assistant', type: 'answer', content: '第一轮回复很长很长的内容...' },
  { role: 'user', type: 'user', content: '继续' },
  { role: 'assistant', type: 'answer', content: '第二轮回复' },
];
const oldWay = msgs6
  .filter(m => m.role === 'assistant' && m.type === 'answer')
  .map(m => typeof m.content === 'string' ? m.content : '')
  .join('');
const newWay = extractLatestAnswerFromMessages(msgs6);
console.log('旧方式:', JSON.stringify(oldWay));
console.log('新方式:', JSON.stringify(newWay));
console.log('旧方式长度:', oldWay.length, '| 新方式长度:', newWay.length);
console.log('⚠️ 旧方式包含了第1轮的回复!');

console.log('\n=== 测试7: cleanContent 对各种内容的处理 ===');
const tests = [
  '你好，很高兴认识你！我是心元。',
  '好的',
  '好的{"status":"ok"}',
  '好的{"status":"ok","mood":"happy","level":5}',
  '```json\n{"key": "value"}\n```',
  '正文\n```json\n{"key": "value"}\n```\n结尾',
  '回复内容\n{"status":"ok"}',
  '{"status":"ok"}', // 纯 JSON
];
tests.forEach((t, i) => {
  const c = cleanContent(t);
  console.log(`  [${i}] input(${t.length}): "${t.slice(0, 50)}" → output(${c.length}): "${c.slice(0, 50)}"`);
});

// 🔥 关键测试：如果 Coze 回复是这种格式怎么办？
console.log('\n=== 🔥 测试8: 回复被截断为2字的场景 ===');
// 假设 Coze 返回格式是 "好的" + 换行 + JSON
const scenario = '好的\n{"emotion":"positive","action":"smile","mood":"happy"}';
console.log('原始:', JSON.stringify(scenario));
const afterClean = cleanContent(scenario);
console.log('cleanContent后:', JSON.stringify(afterClean), '| 长度:', afterClean.length);
// 如果结果是"好的"（2字），那说明问题就在这里！
