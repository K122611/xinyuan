// 验证修复后的 cleanContent 逻辑
function cleanContent(text) {
  // 如果整个内容就是一个 JSON 对象，返回空字符串
  if (/^\s*\{["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null)(\s*,\s*["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null))*\s*\}\s*$/.test(text)) {
    return '';
  }
  // 只移除独立成行（以换行开头）的末尾 JSON 对象
  text = text.replace(/\n\s*\{["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null)(\s*,\s*["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null))*\s*\}\s*$/g, '');
  // 移除 Markdown 代码块包裹的 JSON
  text = text.replace(/```json\s*[\s\S]*?\s*```/g, '');
  return text.trim();
}

const cases = [
  { input: '你好呀！我是心元', desc: '正常回复' },
  { input: '好的\n{"emotion":"positive"}', desc: '换行+JSON元数据' },
  { input: '在呢{"status":"active","mood":"happy"}', desc: '无换行拼接JSON' },
  { input: '好的', desc: '纯粹短回复' },
  { input: '{"status":"ok"}', desc: '纯JSON' },
  { input: '正文\n```json\n{"key":"value"}\n```\n结尾', desc: '含json代码块' },
  { input: '好的\n{"emotion":"positive","action":"smile","mood":"happy"}', desc: '🔥短回复+换行+复杂JSON' },
  { input: '我听到了你的声音，感受到你此刻的情绪。愿意多和我说说吗？', desc: '长回复无JSON' },
];

let allPassed = true;
cases.forEach((c, i) => {
  const result = cleanContent(c.input);
  const displayIn = c.input.replace(/\n/g, '\\n');
  console.log(`[${i}] ${c.desc}`);
  console.log(`  in:  "${displayIn}"`);
  console.log(`  out: "${result}" | 长度=${result.length}`);

  // 关键断言
  if (i === 0 && result.length < 5) { allPassed = false; console.log('  ❌ 正常回复被截断!'); }
  if (i === 1 && result !== '好的') { allPassed = false; console.log('  ❌ 换行JSON未清理!'); }
  if (i === 2 && result !== '在呢{"status":"active","mood":"happy"}') { allPassed = false; console.log('  ❌ 无换行JSON被误删!'); }
  if (i === 3 && result !== '好的') { allPassed = false; console.log('  ❌ 纯短回复被修改!'); }
  if (i === 4 && result !== '') { allPassed = false; console.log('  ❌ 纯JSON未清空!'); }
  if (i === 6 && result !== '好的') { allPassed = false; console.log('  ❌ 短回复+换行+JSON未被正确清理!'); }
  if (i === 7 && result.length < 10) { allPassed = false; console.log('  ❌ 长回复被截断!'); }
  console.log('');
});

console.log(allPassed ? '✅ 所有测试通过!' : '❌ 有测试失败!');
process.exit(allPassed ? 0 : 1);
