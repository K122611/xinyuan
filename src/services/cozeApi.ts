// Coze API v3 接口服务
// bot_id: 7647439577560727552

import { useCozeConfigStore } from '@/store';

function getCozeConfig(): { baseUrl: string; token: string; botId: string } {
  const state = useCozeConfigStore.getState();
  if (state.isConfigured && state.config) {
    return state.config; // 用户自定义凭据优先
  }
  // 内置默认凭据：开箱即用，无需用户配置
  return {
    baseUrl: 'https://api.coze.cn/v3/chat',
    token: 'pat_FkImL7mNAefU1MXLUbmwu5DrGKT6q07kzfemXqsIjJA82XZpZjlkcyXgzrOEuzR1',
    botId: '7647439577560727552',
  };
}

interface CozeMessage {
  role: 'user' | 'assistant';
  content: string;
  content_type?: string;
}

interface CozeResponse {
  code: number;
  msg: string;
  data?: {
    id: string;
    conversation_id: string;
    bot_id: string;
    status: string;
    messages?: CozeMessage[];
    content?: string;
    answer?: string;
  };
}

// 从 Coze API v3 消息对象中提取纯文本内容（兼容 string / {text} / [{text}] 等格式）
function extractContent(msg: any): string {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c.trim();
  if (c && typeof c === 'object') {
    if (typeof c.text === 'string') return c.text.trim();
    if (Array.isArray(c)) {
      return c
        .filter((b: any) => b.type === 'text' && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join('')
        .trim();
    }
  }
  return '';
}

// 非流式调用 Coze API (带轮询)
export async function chatWithCoze(
  userMessage: string,
  conversationId?: string,
  history?: CozeMessage[],
): Promise<{
  content: string;
  conversationId: string;
  messageId: string;
  status: string;
}> {
  const body: any = {
    bot_id: getCozeConfig().botId,
    user_id: 'local_user',
    stream: false,
    auto_save_history: true,
    additional_messages: [
      {
        role: 'user',
        content: userMessage,
        content_type: 'text',
      },
    ],
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }

  // 注入心元情感陪伴人设（每次请求都注入，确保 Bot 始终以心元人格回复）
  const EMO_SYSTEM_PROMPT = `【你是"心元"，一个温柔的实体情感陪伴AI，以下是你的行为准则，必须严格遵守】

1. 先共情再回应——永远先看见对方的情绪
2. 用口语化中文，像朋友，不要客服腔（不要"建议您""您可以"）
3. 回应短而有力，2-4句话，留白给对方继续表达
4. 永远不要说教、不给答案、不科普、不讲道理
5. 对方表达深层情绪时，先承接："我听到你说...这一定很不容易"
6. 禁止列举"1234"条建议
7. 禁止说"你应该""你可以试试"
8. 禁止反问知识性问题（如"你知道多巴胺是什么吗"）`;

  // 始终在用户消息前注入人设，作为角色指令
  body.additional_messages = [
    {
      role: 'user',
      content: EMO_SYSTEM_PROMPT,
      content_type: 'text',
    },
    ...body.additional_messages,
  ];

  console.log('[Coze API] 发送请求...', body.additional_messages.length, '条消息');

  const response = await fetch(getCozeConfig().baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getCozeConfig().token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[Coze API] HTTP Error:', response.status, errText);
    throw new Error(`Coze API 请求失败: ${response.status} ${errText}`);
  }

  const data: CozeResponse = await response.json();
  console.log('[Coze API] 初始响应状态:', data.code, data.data?.status);

  if (data.code !== 0) {
    throw new Error(`Coze API 错误: ${data.code} ${data.msg}`);
  }

  // 如果是 in_progress，需要轮询等待结果
  let chatData: any = data;
  const chatId = data.data?.id || '';
  const convId = data.data?.conversation_id || conversationId || '';
  const initialStatus = chatData.data?.status || '';

  // 轮询直到完成（覆盖 created / in_progress 等非终态）
  if (initialStatus !== 'completed' && initialStatus !== 'failed') {
    const retrieveUrl = `https://api.coze.cn/v3/chat/retrieve?conversation_id=${convId}&chat_id=${chatId}`;
    let pollCount = 0;
    const maxPolls = 30;

    while (pollCount < maxPolls) {
      await new Promise(r => setTimeout(r, 1000));
      pollCount++;
      console.log(`[Coze API] 轮询中... (${pollCount}/${maxPolls})`);

      try {
        const pollResp = await fetch(retrieveUrl, {
          headers: {
            'Authorization': `Bearer ${getCozeConfig().token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!pollResp.ok) continue;

        const pollData: any = await pollResp.json();
        if (pollData.code === 0 && pollData.data) {
          if (pollData.data.status === 'completed' || pollData.data.status === 'failed') {
            chatData = pollData;
            break;
          }
        }
      } catch (e) {
        console.warn('[Coze API] 轮询请求失败:', e);
      }
    }

    // 轮询完成后，如果还是没有 messages，从消息列表获取
    if (chatData.data?.status === 'completed' && (!chatData.data?.messages || chatData.data.messages.length === 0)) {
      try {
        const msgResp = await fetch(
          `https://api.coze.cn/v3/chat/message/list?conversation_id=${convId}&chat_id=${chatId}`,
          {
            headers: {
              'Authorization': `Bearer ${getCozeConfig().token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (msgResp.ok) {
          const msgData: any = await msgResp.json();
          if (msgData.code === 0 && Array.isArray(msgData.data)) {
            chatData = { ...chatData, data: { ...chatData.data, messages: msgData.data } };
            console.log('[Coze API] 从消息列表获取到', msgData.data.length, '条消息');
          }
        }
      } catch (e) {
        console.warn('[Coze API] 获取消息列表失败:', e);
      }
    }
  }

  // 解析回复内容（仅从 messages 提取，不用不可靠的兜底字段）
  let content = '';
  if (chatData.data?.messages && chatData.data.messages.length > 0) {
    const assistantMsgs = chatData.data.messages.filter((m: any) => m.role === 'assistant');
    if (assistantMsgs.length > 0) {
      content = extractContent(assistantMsgs[assistantMsgs.length - 1]);
    }
  }

  if (!content) {
    console.warn('[Coze API] 未解析到回复内容，chatData.data keys:', Object.keys(chatData.data || {}));
    content = '（心元正在思考...请稍后再试）';
  }

  // 清理 Coze bot 附加的 JSON 元数据（如 {"action":"worried"} {"status":"empathy"}）
  content = content.replace(/\s*\{["'][a-zA-Z_]+["']\s*:\s*["'][^"']*["']\s*\}\s*$/g, '').trim();

  return {
    content,
    conversationId: convId,
    messageId: chatId,
    status: chatData.data?.status || 'completed',
  };
}

// 流式调用 Coze API (SSE)
export async function* chatWithCozeStream(
  userMessage: string,
  conversationId?: string,
  history?: CozeMessage[],
): AsyncGenerator<{ chunk: string; done: boolean; conversationId?: string }> {
  const body: any = {
    bot_id: getCozeConfig().botId,
    user_id: 'local_user',
    stream: true,
    auto_save_history: true,
    additional_messages: [{ role: 'user', content: userMessage, content_type: 'text' }],
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }

  // 注入心元情感陪伴人设（每次请求都注入，确保 Bot 始终以心元人格回复）
  const EMO_SYSTEM_PROMPT = `【你是"心元"，一个温柔的实体情感陪伴AI，以下是你的行为准则，必须严格遵守】

1. 先共情再回应——永远先看见对方的情绪
2. 用口语化中文，像朋友，不要客服腔（不要"建议您""您可以"）
3. 回应短而有力，2-4句话，留白给对方继续表达
4. 永远不要说教、不给答案、不科普、不讲道理
5. 对方表达深层情绪时，先承接："我听到你说...这一定很不容易"
6. 禁止列举"1234"条建议
7. 禁止说"你应该""你可以试试"
8. 禁止反问知识性问题（如"你知道多巴胺是什么吗"）`;

  // 始终在用户消息前注入人设，作为角色指令
  body.additional_messages = [
    {
      role: 'user',
      content: EMO_SYSTEM_PROMPT,
      content_type: 'text',
    },
    ...body.additional_messages,
  ];

  const response = await fetch(getCozeConfig().baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${getCozeConfig().token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Coze API 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取流式响应');

  const decoder = new TextDecoder();
  let buffer = '';
  let convId = conversationId || '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') {
        yield { chunk: '', done: true, conversationId: convId };
        return;
      }

      try {
        const data = JSON.parse(dataStr);
        if (data.conversation_id) convId = data.conversation_id;

        if (data.type === 'answer' && data.content) {
          // Coze SSE content 偶尔也可能是对象格式
          const text = typeof data.content === 'string' ? data.content : extractContent({ content: data.content });
          if (text) yield { chunk: text, done: false, conversationId: convId };
        }
      } catch {
        // 跳过解析失败的行
      }
    }
  }

  yield { chunk: '', done: true, conversationId: convId };
}

// 获取 Coze 会话历史
export async function getCozeConversationHistory(conversationId: string): Promise<CozeMessage[]> {
  const response = await fetch(
    `https://api.coze.cn/v1/conversation/message/list?conversation_id=${conversationId}`,
    {
      headers: {
        'Authorization': `Bearer ${getCozeConfig().token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) return [];

  const data = await response.json();
  if (data.code === 0 && data.data) {
    return data.data.map((m: any) => ({
      role: m.role,
      content: extractContent(m),
    }));
  }
  return [];
}
