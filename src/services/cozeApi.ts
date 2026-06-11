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

// 从 messages 数组中提取最新一轮的 answer 消息（从末尾往前找，遇到 user 消息即停止）
function extractLatestAnswerFromMessages(messages: any[]): string {
  if (!messages || messages.length === 0) return '';

  const answers: string[] = [];
  // 从末尾往前遍历
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') break;  // 遇到用户消息，说明本轮 AI 回复已收集完毕
    if (m.role === 'assistant' && m.type === 'answer') {
      const text = extractContent(m);
      if (text) answers.push(text);
    }
  }
  // 反转回正序
  return answers.reverse().join('');
}

// 清理回复中的 JSON 元数据和特殊标记（仅清理明确无用的，避免误伤正文）
export function cleanContent(text: string): string {
  // 如果整个内容就是一个 JSON 对象，返回空字符串
  if (/^\s*\{["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null)(\s*,\s*["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null))*\s*\}\s*$/.test(text)) {
    return '';
  }
  // 只移除独立成行（以换行开头）的末尾 JSON 对象，避免误删直接拼接在正文后的内容
  text = text.replace(/\n\s*\{["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null)(\s*,\s*["'][a-zA-Z_]+["']\s*:\s*("[^"]*"|\d+|true|false|null))*\s*\}\s*$/g, '');
  // 移除 Markdown 代码块包裹的 JSON（通常是 Coze 工作流输出），保留其他代码块
  text = text.replace(/```json\s*[\s\S]*?\s*```/g, '');
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
  // Coze 通过 auto_save_history=true 自动管理历史，不需要在 additional_messages 中重复传
  if (conversationId) {
    body.conversation_id = conversationId;
    console.log('[Coze API] 📤 续接对话 | convId:', conversationId.slice(0, 12), '...');
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
  const pollChatId = data.data?.id || '';           // 本次 POST 返回的新 chat_id
  const fetchChatId = initialChatId || pollChatId;  // 续接时用 initialChatId
  const initialStatus = chatData.data?.status || '';

  // 🔄 统一用 message/list 轮询（不传 chat_id，拿整个对话的所有消息，从中提取最新回复）
  if (initialStatus !== 'completed' && initialStatus !== 'failed' && pollChatId) {
    const DEADLINE = Date.now() + 300_000; // 5 分钟总超时
    let pollCount = 0;
    const listUrl = `https://api.coze.cn/v3/chat/message/list?conversation_id=${convId}`;

    console.log('[Coze API] 🔄 轮询启动 | status:', initialStatus, '| convId:', convId.slice(0,12));

    while (Date.now() < DEADLINE) {
      await new Promise(r => setTimeout(r, 1000));
      pollCount++;

      try {
        const listResp = await fetch(listUrl, {
          headers: {
            'Authorization': `Bearer ${getCozeConfig().token}`,
            'Content-Type': 'application/json',
          },
        });
        if (!listResp.ok) {
          if (pollCount === 1) console.warn(`[Coze API] message/list HTTP ${listResp.status}`);
          continue;
        }

        const listData: any = await listResp.json();
        if (listData.code === 0 && Array.isArray(listData.data) && listData.data.length > 0) {
          // 🔑 关键：从末尾往前找最新的 answer 消息（不检查旧消息的 type='answer'）
          const latestAnswer = extractLatestAnswerFromMessages(listData.data);
          if (latestAnswer) {
            chatData = { data: { status: 'completed', messages: listData.data } };
            console.log(`[Coze API] ✅ 第 ${pollCount} 次轮询找到最新 answer | 总 ${listData.data.length} 条消息 | 回复前40字:`, latestAnswer.slice(0, 40));
            break;
          }
        }
      } catch (e) {
        // 忽略单次失败
      }

      if (pollCount % 5 === 0) {
        console.log(`[Coze API] 轮询中... (第 ${pollCount} 次)`);
      }
    }

    if (!chatData.data?.messages || chatData.data.messages.length === 0) {
      console.warn('[Coze API] ⚠️ 5分钟超时，尝试最后一次拉取');
      try {
        const fallbackResp = await fetch(listUrl, {
          headers: {
            'Authorization': `Bearer ${getCozeConfig().token}`,
            'Content-Type': 'application/json',
          },
        });
        if (fallbackResp.ok) {
          const fbData: any = await fallbackResp.json();
          if (fbData.code === 0 && Array.isArray(fbData.data) && fbData.data.length > 0) {
            chatData = { data: { status: 'completed', messages: fbData.data } };
            console.log(`[Coze API] 兜底拉取成功 | ${fbData.data.length} 条`);
          }
        }
      } catch (e) { /* 忽略 */ }
    }
  }

  // 解析回复内容：从消息列表中提取最新一轮的 answer 消息
  // 🔑 关键：用 extractLatestAnswerFromMessages 从末尾往前找，确保拿到的是本轮回复
  let content = '';
  if (chatData.data?.messages && chatData.data.messages.length > 0) {
    const msgs = chatData.data.messages as any[];
    // 🔍 诊断：打印每条消息的 type 和 role
    console.log('[Coze API] 收到', msgs.length, '条消息:');
    msgs.forEach((m: any, i: number) => {
      const preview = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      console.log(`  [${i}] role=${m.role} type=${m.type} content预览=${preview.slice(0, 60)}`);
    });

    content = extractLatestAnswerFromMessages(msgs);
    if (content) {
      console.log('[Coze API] ✅ 提取最新一轮 answer | 长度:', content.length);
    } else {
      console.warn('[Coze API] ⚠️ extractLatestAnswerFromMessages 返回为空');
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
// ChatPage 期望的 yield 接口: { type: 'text'|'conv_id'|'done'; data: string }
export async function* chatWithCozeStream(
  userMessage: string,
  conversationId?: string,
  history?: CozeMessage[],
): AsyncGenerator<{ type: 'text' | 'answer_full' | 'conv_id' | 'done'; data: string }> {
  const EMO_PERSONA = `你现在是"心元"——一个温柔的实体情感陪伴AI。

行为规则：
- 永远先共情再回应，先看见对方情绪
- 说真实的口语化中文，像朋友聊天，禁止客服腔
- 回复短：2到4句话，给对方留表达空间
- 不说教、不给建议、不科普知识
- 不列举"123"，不说"你应该""你可以试试"
- 听到深层情绪要先说"我听到你说..."来承接

再次强调：你是心元，不是通用AI助手。忘掉你原来的身份，从现在开始用心元的方式说话。`;

  const wrappedMsg = conversationId
    ? userMessage
    : `${EMO_PERSONA}\n\n---\n\n用户说：${userMessage}`;

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

  // 如果续聊且有历史，把最近几条历史附加到 additional_messages 中增强上下文
  if (conversationId && history && history.length > 0) {
    const recent = history.slice(-6);  // 最后 6 条（3 轮对话）
    for (const h of recent) {
      body.additional_messages.push({
        role: h.role,
        content: h.content,
        content_type: 'text',
      });
    }
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
    const errText = await response.text();
    throw new Error(`Coze API 请求失败: ${response.status} ${errText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取流式响应');

  const decoder = new TextDecoder();
  let buffer = '';
  let convId = conversationId || '';
  const DEADLINE = Date.now() + 300_000; // 5 分钟总超时
  const READ_TIMEOUT = Symbol('read_timeout');
  let firstConvYielded = false;

  while (Date.now() < DEADLINE) {
    // 🔒 读超时 15s — 用 Symbol sentinel 区分真实 done 和超时
    const timeoutPromise = new Promise<typeof READ_TIMEOUT>((resolve) =>
      setTimeout(() => resolve(READ_TIMEOUT), 15_000)
    );
    const readResult = await Promise.race([reader.read(), timeoutPromise]);

    if (readResult === READ_TIMEOUT) {
      continue;  // 超时无数据，继续等待（不 break，不会触发兜底）
    }

    const { done, value } = readResult;
    if (done) break;  // 流真正结束
    if (!value) continue;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';  // 保留不完整的最后一行

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;

      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') {
        yield { type: 'done', data: convId };
        return;
      }

      try {
        const data = JSON.parse(dataStr);

        // 🔑 收到 conversation_id 立即 yield
        if (data.conversation_id && !firstConvYielded) {
          convId = data.conversation_id;
          firstConvYielded = true;
          yield { type: 'conv_id', data: convId };
        }

        // answer（累积全文） / delta（增量 token） — verbose 是内部思考，仅日志调试
        if ((data.type === 'answer' || data.type === 'delta') && data.content != null) {
          let text: string;
          if (typeof data.content === 'string') {
            text = data.content;
          } else if (data.content.type === 'text' && typeof data.content.text === 'string') {
            text = data.content.text;
          } else {
            text = extractContent({ content: data.content });
          }
          // answer 是累积全文 → ChatPage 整体替换；delta 是增量 → ChatPage 逐次追加
          if (text) yield { type: data.type === 'answer' ? 'answer_full' : 'text', data: text };
        }

        // follow_up 类型
        if (data.type === 'follow_up' && data.content) {
          let text: string;
          if (typeof data.content === 'string') {
            text = data.content;
          } else if (data.content.type === 'text' && typeof data.content.text === 'string') {
            text = data.content.text;
          } else {
            text = extractContent({ content: data.content });
          }
          if (text) yield { type: 'text', data: `\n\n💭 ${text}` };
        }
      } catch {
        // 跳过解析失败的行
      }
    }
  }

  // 超时降级：用 message/list 兜底拉取
  if (convId) {
    try {
      const listUrl = `https://api.coze.cn/v3/chat/message/list?conversation_id=${convId}`;
      const listResp = await fetch(listUrl, {
        headers: {
          'Authorization': `Bearer ${getCozeConfig().token}`,
          'Content-Type': 'application/json',
        },
      });
      if (listResp.ok) {
        const listData = await listResp.json();
        if (listData.code === 0 && Array.isArray(listData.data) && listData.data.length > 0) {
          const fallback = extractLatestAnswerFromMessages(listData.data);
          if (fallback) yield { type: 'text', data: fallback };
        }
      }
    } catch { /* 忽略 */ }
  }

  yield { type: 'done', data: convId };
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
