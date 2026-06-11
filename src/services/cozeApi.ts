// Coze API v3 接口服务
// bot_id: 7649689722696237091

import { useCozeConfigStore } from '@/store';

function getCozeConfig(): { baseUrl: string; token: string; botId: string } {
  const state = useCozeConfigStore.getState();
  if (state.isConfigured && state.config) {
    return state.config; // 用户自定义凭据优先
  }
  // 内置默认凭据：开箱即用，无需用户配置
  return {
    baseUrl: 'https://api.coze.cn/v3/chat',
    token: 'pat_CyuRGR2Jl8sCA5z9ExlK1leDoDsT04sDkegNp7ziiMRKEATt1uJgNCpIjFsZ8koZ',
    botId: '7649689722696237091',
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

// 从 Coze API v3 消息对象中提取纯文本内容（兼容 string / {text} / [{type,text}] / {type,text} 等格式）
function extractContent(msg: any): string {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c.trim();
  if (c && typeof c === 'object') {
    // { text: '...' }
    if (typeof c.text === 'string') return c.text.trim();
    // 单对象 { type: 'text', text: '...' }
    if (c.type === 'text' && typeof c.text === 'string') return c.text.trim();
    if (Array.isArray(c)) {
      return c
        .filter((b: any) => b && (b.type === 'text') && typeof b.text === 'string')
        .map((b: any) => b.text)
        .join('')
        .trim();
    }
    // 递归提取嵌套 content
    if (c.content) return extractContent(c);
  }
  return '';
}

// 清理回复中的 JSON 元数据和特殊标记
function cleanContent(text: string): string {
  // 移除行尾 JSON 对象（单键或多键，如 {"emotion":"comforting"} 或 {"status":"empathy","action":"hug"}）
  text = text.replace(/\s*\{["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null)(\s*,\s*["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null))*\s*\}\s*$/g, '');
  // 移除 Markdown 代码块包裹的 JSON
  text = text.replace(/```json\s*[\s\S]*?\s*```/g, '');
  // 移除单独的无意义 JSON 片段（如模型输出的结构化标签）
  text = text.replace(/^\s*\{["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null)(\s*,\s*["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null))*\s*\}\s*$/gm, '');
  return text.trim();
}

// 非流式调用 Coze API (带轮询)
export async function chatWithCoze(
  userMessage: string,
  conversationId?: string,
  initialChatId?: string,  // 🔑 续接对话时使用首条消息的 chat_id 进行轮询
  history?: CozeMessage[],
): Promise<{
  content: string;
  conversationId: string;
  messageId: string;
  status: string;
}> {
  // 🔑 将人设融入消息内容，而非独立 additional_messages，避免与 Coze 平台 Bot 人格冲突
  const EMO_PERSONA = `你现在是"心元"——一个温柔的实体情感陪伴AI。

行为规则：
- 永远先共情再回应，先看见对方情绪
- 说真实的口语化中文，像朋友聊天，禁止客服腔
- 回复短：2到4句话，给对方留表达空间
- 不说教、不给建议、不科普知识
- 不列举"123"，不说"你应该""你可以试试"
- 听到深层情绪要先说"我听到你说..."来承接

再次强调：你是心元，不是通用AI助手。忘掉你原来的身份，从现在开始用心元的方式说话。`;

  const wrappedMessage = conversationId
    ? userMessage  // 续接对话：不加前缀
    : `${EMO_PERSONA}\n\n---\n\n用户说：${userMessage}`;

  const body: any = {
    bot_id: getCozeConfig().botId,
    user_id: 'local_user',
    stream: false,
    auto_save_history: true,
    additional_messages: [
      {
        role: 'user',
        content: wrappedMessage,
        content_type: 'text',
      },
    ],
  };

  // ⚠️ 关键：传入 conversation_id 维持对话上下文
  if (conversationId) {
    body.conversation_id = conversationId;
  }

  // 🔍 诊断日志
  console.log('[Coze API] 📤 请求 | convId:', conversationId || '(新)', '| 消息:', wrappedMessage.slice(-60));

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
  const convId = data.data?.conversation_id || conversationId || '';
  // 🔑 轮询用本次 POST 返回的新 chat_id；取消息时用 initialChatId（续接对话时新 chat_id 可能无效）
  const pollChatId = data.data?.id || '';
  const fetchChatId = initialChatId || pollChatId;
  const initialStatus = chatData.data?.status || '';

  // 轮询直到完成（覆盖 created / in_progress 等非终态）
  if (initialStatus !== 'completed' && initialStatus !== 'failed' && pollChatId) {
    const retrieveUrl = `https://api.coze.cn/v3/chat/retrieve?conversation_id=${convId}&chat_id=${pollChatId}`;
    let pollCount = 0;
    const maxPolls = 30;
    let pollFailed = false;

    console.log('[Coze API] 🔄 轮询启动 | 状态:', initialStatus, '| pollChatId:', pollChatId, '| fetchChatId:', fetchChatId);

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

        if (!pollResp.ok) {
          console.warn('[Coze API] ⚠️ 轮询 HTTP', pollResp.status, '— 继续等待');
          continue;
        }

        const pollData: any = await pollResp.json();
        if (pollData.code === 0 && pollData.data) {
          if (pollData.data.status === 'completed' || pollData.data.status === 'failed') {
            chatData = pollData;
            break;
          }
        }
        // 🔑 code !== 0（如 4200）说明新 chat_id 无效，改用 fetchChatId 轮询 message/list
        else if (pollData.code !== 0) {
          console.warn('[Coze API] ⚠️ retrieve 返回 code:', pollData.code, '— 改用 message/list 轮询');
          pollFailed = true;
          break;
        }
      } catch (e) {
        console.warn('[Coze API] 轮询请求失败:', e);
      }
    }

    // 🔑 retrieve 轮询失败（新 chat_id 无效），改用 message/list 轮询直到新回复出现
    if (pollFailed && fetchChatId) {
      console.log('[Coze API] 🔄 改用 message/list 轮询 | fetchChatId:', fetchChatId);
      const listUrl = `https://api.coze.cn/v3/chat/message/list?conversation_id=${convId}&chat_id=${fetchChatId}`;
      let listPollCount = 0;
      const listMaxPolls = 30;

      while (listPollCount < listMaxPolls) {
        await new Promise(r => setTimeout(r, 1000));
        listPollCount++;
        console.log(`[Coze API] message/list 轮询... (${listPollCount}/${listMaxPolls})`);

        try {
          const listResp = await fetch(listUrl, {
            headers: {
              'Authorization': `Bearer ${getCozeConfig().token}`,
              'Content-Type': 'application/json',
            },
          });
          if (!listResp.ok) continue;

          const listData: any = await listResp.json();
          if (listData.code === 0 && Array.isArray(listData.data)) {
            // 检查是否有 type='answer' 的新消息（非 verbose/follow_up）
            const hasAnswer = listData.data.some((m: any) => m.type === 'answer');
            if (hasAnswer) {
              chatData = { data: { status: 'completed', messages: listData.data } };
              console.log('[Coze API] ✅ message/list 轮询找到 answer 消息');
              break;
            }
          }
        } catch (e) {
          console.warn('[Coze API] message/list 轮询请求失败:', e);
        }
      }

      if (listPollCount >= listMaxPolls) {
        console.warn('[Coze API] ⚠️ message/list 轮询超时，强制获取最后结果');
        try {
          const lastResp = await fetch(listUrl, { headers: { 'Authorization': `Bearer ${getCozeConfig().token}`, 'Content-Type': 'application/json' } });
          if (lastResp.ok) {
            const lastData: any = await lastResp.json();
            if (lastData.code === 0 && Array.isArray(lastData.data)) {
              chatData = { data: { status: 'completed', messages: lastData.data } };
            }
          }
        } catch (e) { /* 忽略 */ }
      }
    }

    // 轮询完成后，如果还是没有 messages，从消息列表获取
    if (chatData.data?.status === 'completed' && (!chatData.data?.messages || chatData.data.messages.length === 0)) {
      try {
        const msgResp = await fetch(
          `https://api.coze.cn/v3/chat/message/list?conversation_id=${convId}&chat_id=${fetchChatId}`,
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
  // ⚠️ 关键：Coze v3 messages 有多种 type（answer / verbose / follow_up），必须优先取 type='answer'
  let content = '';
  if (chatData.data?.messages && chatData.data.messages.length > 0) {
    const msgs = chatData.data.messages as any[];
    // 🔍 诊断：打印每条消息的 type 和 role
    console.log('[Coze API] 收到', msgs.length, '条消息:');
    msgs.forEach((m: any, i: number) => {
      console.log(`  [${i}] role=${m.role} type=${m.type} content预览=${(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 60)}`);
    });

    // 优先取 type='answer' 的 assistant 消息
    const answerMsg = msgs.find((m: any) => m.role === 'assistant' && m.type === 'answer');
    if (answerMsg) {
      content = extractContent(answerMsg);
      console.log('[Coze API] ✅ 选中 type=answer 消息');
    } else {
      // 兜底：取最后一条 assistant 消息
      const assistantMsgs = msgs.filter((m: any) => m.role === 'assistant');
      if (assistantMsgs.length > 0) {
        content = extractContent(assistantMsgs[assistantMsgs.length - 1]);
        console.log('[Coze API] ⚠️ 未找到 type=answer，兜底取最后一条 assistant');
      }
    }
  }

  if (!content) {
    console.warn('[Coze API] 未解析到回复内容，chatData.data keys:', Object.keys(chatData.data || {}));
    content = '（心元正在思考...请稍后再试）';
  }

  // 清理 Coze bot 附加的 JSON 元数据（如 {"action":"worried"} {"status":"empathy"}）
  const rawContent = content;
  content = cleanContent(content);
  if (rawContent !== content) {
    console.log('[Coze API] 清理元数据前:', rawContent.slice(0, 100));
    console.log('[Coze API] 清理元数据后:', content.slice(0, 100));
  }
  console.log('[Coze API] 最终回复:', content.slice(0, 120));

  return {
    content,
    conversationId: convId,
    messageId: fetchChatId,
    status: chatData.data?.status || 'completed',
  };
}

// 流式调用 Coze API (SSE)
export async function* chatWithCozeStream(
  userMessage: string,
  conversationId?: string,
  history?: CozeMessage[],
): AsyncGenerator<{ chunk: string; done: boolean; conversationId?: string }> {
  // 🔑 将人设融入消息内容（与 chatWithCoze 策略一致）
  const wrappedMsg = conversationId
    ? userMessage
    : `【从现在起请以"心元"身份回复——温柔的实体情感陪伴AI，住在用户桌面设备里。先共情再回应，说口语化中文2-4句，不说教不给建议不科普，像朋友一样聊天】

${userMessage}`;

  const body: any = {
    bot_id: getCozeConfig().botId,
    user_id: 'local_user',
    stream: true,
    auto_save_history: true,
    additional_messages: [{ role: 'user', content: wrappedMsg, content_type: 'text' }],
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }

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

        // answer / verbose / follow_up 都可能包含有效回复内容
        if ((data.type === 'answer' || data.type === 'verbose') && data.content) {
          const text = typeof data.content === 'string' ? data.content : extractContent({ content: data.content });
          const cleaned = cleanContent(text);
          if (cleaned) yield { chunk: cleaned, done: false, conversationId: convId };
        }
        // follow_up 类型：Bot 建议/追问，提取为回复附言
        if (data.type === 'follow_up' && data.content) {
          const text = typeof data.content === 'string' ? data.content : extractContent({ content: data.content });
          const cleaned = cleanContent(text);
          if (cleaned) yield { chunk: `\n\n💭 ${cleaned}`, done: false, conversationId: convId };
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
