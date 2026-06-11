// 直接测试 Coze API 的续聊和消息提取逻辑
const COZE_TOKEN = 'pat_FkImL7mNOG5i6MWxSPi2gNMoANzUIOaxldxUHiSE46zrOEuzR1';
const BOT_ID = '7647439577560727552';
const BASE_URL = 'https://api.coze.cn/v3/chat';

// === 从 messages 中提取最新一轮 answer（反向遍历，遇 user 停）===
function extractLatestAnswerFromMessages(messages) {
  if (!messages || messages.length === 0) return '';
  const answers = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') break;
    if (m.role === 'assistant' && m.type === 'answer') {
      answers.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
    }
  }
  return answers.reverse().join('');
}

async function test() {
  console.log('=== 测试1: 发送第1条消息 ===');
  const resp1 = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${COZE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bot_id: BOT_ID,
      user_id: 'test-user',
      stream: false,
      auto_save_history: true,
      additional_messages: [{ role: 'user', content: '你好，你叫什么名字？', content_type: 'text' }]
    })
  });
  const data1 = await resp1.json();
  console.log('code:', data1.code, 'status:', data1.data?.status);
  const convId = data1.data?.conversation_id || '';
  const chatId1 = data1.data?.id || '';
  console.log('convId:', convId.slice(0,20), 'chatId:', chatId1.slice(0,20));

  // 提取第1条回复
  if (data1.data?.messages) {
    const answer1 = extractLatestAnswerFromMessages(data1.data.messages);
    console.log('第1条回复:', answer1.slice(0, 120));
  }

  // 如需轮询
  if (data1.data?.status !== 'completed') {
    console.log('轮询等待...');
    const dl = Date.now() + 120000;
    while (Date.now() < dl) {
      await new Promise(r => setTimeout(r, 2000));
      const listResp = await fetch(
        `https://api.coze.cn/v3/chat/message/list?conversation_id=${convId}`,
        { headers: { 'Authorization': `Bearer ${COZE_TOKEN}` } }
      );
      const listData = await listResp.json();
      if (listData.code === 0 && Array.isArray(listData.data)) {
        const latest = extractLatestAnswerFromMessages(listData.data);
        if (latest) {
          console.log('(轮询)第1条回复:', latest.slice(0, 120));
          break;
        }
      }
    }
  }

  console.log('\n=== 测试2: 续聊（第2条消息）→ 关键！ ===');
  const resp2 = await fetch(BASE_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${COZE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      bot_id: BOT_ID,
      user_id: 'test-user',
      stream: false,
      auto_save_history: true,
      conversation_id: convId,
      additional_messages: [{ role: 'user', content: '我刚才问了你什么？', content_type: 'text' }]
    })
  });
  const data2 = await resp2.json();
  console.log('code:', data2.code, 'status:', data2.data?.status);
  const chatId2 = data2.data?.id || '';
  console.log('新chatId:', chatId2.slice(0,20));

  // 提取第2条回复
  if (data2.data?.messages) {
    const answer2 = extractLatestAnswerFromMessages(data2.data.messages);
    console.log('第2条回复(直接):', answer2.slice(0, 200));
  }

  // 关键测试：用 conversation_id 拉全量消息 → 看能拿到什么
  console.log('\n=== 测试3: message/list?conversation_id → 全量消息 ===');
  const listResp = await fetch(
    `https://api.coze.cn/v3/chat/message/list?conversation_id=${convId}`,
    { headers: { 'Authorization': `Bearer ${COZE_TOKEN}` } }
  );
  const listData = await listResp.json();
  console.log('code:', listData.code, '消息数:', listData.data?.length);
  
  if (Array.isArray(listData.data)) {
    // 打印所有消息的 type
    listData.data.forEach((m, i) => {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      console.log(`  [${i}] role=${m.role} type=${m.type} content="${c.slice(0,80)}"`);
    });

    // 用新函数提取最新 answer
    const latest = extractLatestAnswerFromMessages(listData.data);
    console.log('\n✅ extractLatestAnswerFromMessages 结果:');
    console.log('  长度:', latest.length);
    console.log('  内容:', latest.slice(0, 300));
  }

  // 🔥 对比：旧的提取方式（过滤全量 answer 并 join）
  console.log('\n=== 对比：旧方式（过滤所有 answer 并 join）===');
  if (Array.isArray(listData.data)) {
    const oldWay = listData.data
      .filter(m => m.role === 'assistant' && m.type === 'answer')
      .map(m => typeof m.content === 'string' ? m.content : '')
      .join('');
    console.log('旧方式长度:', oldWay.length);
    console.log('旧方式内容:', oldWay.slice(0, 300));
    console.log('\n⚠️ 旧方式会包含第1轮的回复，导致内容混乱！');
  }
}

test().catch(e => console.error('Error:', e.message || e));
