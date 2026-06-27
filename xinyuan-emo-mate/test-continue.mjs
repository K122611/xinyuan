/**
 * 诊断脚本：模拟第二次询问的完整 Coze v3 API 调用链
 * 用法：node test-continue.mjs
 * 需要先设置环境变量：COZE_TOKEN, COZE_BOT_ID
 */

const TOKEN = process.env.COZE_TOKEN || '';
const BOT_ID = process.env.COZE_BOT_ID || '';

if (!TOKEN || !BOT_ID) {
  console.error('请设置环境变量: COZE_TOKEN, COZE_BOT_ID');
  process.exit(1);
}

const BASE = 'https://api.coze.cn';
const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function postChat(message, conversationId = null) {
  const body = {
    bot_id: BOT_ID,
    user_id: 'test_user',
    stream: false,
    auto_save_history: true,
    additional_messages: [
      { role: 'user', content: message, content_type: 'text' },
    ],
  };
  if (conversationId) body.conversation_id = conversationId;

  console.log('\n=== POST /v3/chat ===');
  console.log('conversation_id:', conversationId || '(新对话)');
  console.log('message:', message);

  const resp = await fetch(`${BASE}/v3/chat`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  console.log('响应 code:', data.code);
  console.log('data.id:', data.data?.id);
  console.log('data.conversation_id:', data.data?.conversation_id);
  console.log('data.status:', data.data?.status);
  return data;
}

async function pollRetrieve(chatId, conversationId, label) {
  const DEADLINE = Date.now() + 120_000;
  let count = 0;
  
  while (Date.now() < DEADLINE) {
    count++;
    const url = `${BASE}/v3/chat/retrieve?conversation_id=${conversationId}&chat_id=${chatId}`;
    const resp = await fetch(url, { headers: HEADERS });
    const data = await resp.json();
    
    console.log(`[${label}] retrieve #${count} | code: ${data.code} | status: ${data.data?.status} | hasMessages: ${!!data.data?.messages}`);

    if (data.code !== 0) {
      console.log(`[${label}] retrieve 返回非 0: code=${data.code} msg=${data.msg}`);
      return { success: false, data, error: `code=${data.code}` };
    }
    
    if (data.data?.status === 'completed' || data.data?.status === 'failed') {
      return { success: true, data };
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return { success: false, data: null, error: 'timeout' };
}

async function getMessages(chatId, conversationId, label) {
  const url = `${BASE}/v3/chat/message/list?conversation_id=${conversationId}&chat_id=${chatId}`;
  console.log(`\n[${label}] GET ${url}`);
  
  const resp = await fetch(url, { headers: HEADERS });
  const data = await resp.json();
  
  console.log(`[${label}] code: ${data.code}`);
  if (data.code !== 0) {
    console.log(`[${label}] msg: ${data.msg}`);
    return data;
  }
  
  console.log(`[${label}] 消息数: ${data.data?.length || 0}`);
  if (data.data) {
    data.data.forEach((m, i) => {
      const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      console.log(`  [${i}] role=${m.role} type=${m.type} | ${content.slice(0, 80)}`);
    });
  }
  return data;
}

async function main() {
  try {
    // ===== 第一次询问 =====
    console.log('\n\n========== 第一次询问 ==========');
    const msg1 = '我今天心情不太好';
    const res1 = await postChat(msg1);
    
    const chatId1 = res1.data?.id;
    const convId = res1.data?.conversation_id;
    
    console.log('\n--- 轮询第一次 ---');
    const poll1 = await pollRetrieve(chatId1, convId, '第1次');
    console.log('第1次轮询结果:', poll1.success ? '完成' : poll1.error);
    
    // 用 chatId1 拉消息
    const msgs1 = await getMessages(chatId1, convId, '第1次-用chatId1');
    
    // ===== 第二次询问（续接） =====
    console.log('\n\n========== 第二次询问（续接） ==========');
    const msg2 = '嗯，就是觉得有点孤单';
    const res2 = await postChat(msg2, convId);
    
    const chatId2 = res2.data?.id;
    console.log('\n第二次 chat_id:', chatId2);
    console.log('第一次 chat_id:', chatId1, '(作为 initialChatId)');
    
    // 测试 A: 用新 chatId2 轮询 retrieve
    console.log('\n--- 测试A: 用新 chatId2 轮询 retrieve ---');
    const poll2a = await pollRetrieve(chatId2, convId, '测试A');
    console.log('测试A 结果:', poll2a.success ? '完成' : poll2a.error);
    
    // 测试 B: 用旧 chatId1 拉消息
    console.log('\n--- 测试B: 用旧 chatId1 拉消息 ---');
    const msgs2b = await getMessages(chatId1, convId, '测试B');
    
    // 检查是否包含新回复
    if (msgs2b.code === 0 && Array.isArray(msgs2b.data)) {
      const answers = msgs2b.data.filter(m => m.type === 'answer');
      console.log(`\n测试B 找到 ${answers.length} 条 answer 消息`);
      answers.forEach((a, i) => {
        const content = typeof a.content === 'string' ? a.content : JSON.stringify(a.content);
        console.log(`  answer[${i}]: ${content.slice(0, 100)}`);
      });
    }
    
    // 测试 C: 用新 chatId2 拉消息
    console.log('\n--- 测试C: 用新 chatId2 拉消息 ---');
    const msgs2c = await getMessages(chatId2, convId, '测试C');
    
    console.log('\n\n========== 诊断总结 ==========');
    console.log('convId:', convId);
    console.log('chatId1 (initial):', chatId1);
    console.log('chatId2 (new):', chatId2);
    console.log('retrieve(chatId2):', poll2a.success ? '成功' : poll2a.error);
    console.log('messages(chatId1):', msgs2b.code === 0 ? `${msgs2b.data?.length || 0}条` : `code=${msgs2b.code}`);
    console.log('messages(chatId2):', msgs2c.code === 0 ? `${msgs2c.data?.length || 0}条` : `code=${msgs2c.code}`);
    
  } catch (e) {
    console.error('错误:', e);
  }
}

main();
