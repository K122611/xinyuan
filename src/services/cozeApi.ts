/**
 * Coze v3 API 集成
 * 参考记忆库中的 coze-v3-api-pitfalls
 */

import type { StreamingCallbacks, ChatMessage } from '../types';

const COZE_API_BASE = 'https://api.coze.cn';

interface CozeV3ChatRequest {
  bot_id: string;
  user_id: string;
  stream: boolean;
  auto_save_history: boolean;
  additional_messages: Array<{
    role: string;
    content: string;
    content_type: string;
  }>;
  conversation_id?: string;
}

/**
 * 流式调用 Coze v3 Chat API
 * 关键：v3 API 使用 conversation_id 维持会话
 */
export async function streamCozeChat(
  token: string,
  botId: string,
  userId: string,
  messages: ChatMessage[],
  conversationId: string | undefined,
  callbacks: StreamingCallbacks
): Promise<string> {
  const url = `${COZE_API_BASE}/v3/chat`;

  const body: CozeV3ChatRequest = {
    bot_id: botId,
    user_id: userId,
    stream: true,
    auto_save_history: true,
    additional_messages: messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
      content_type: 'text',
    })),
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    callbacks.onError(`API 错误 ${response.status}: ${errorText}`);
    throw new Error(`Coze API error ${response.status}: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError('无法获取响应流');
    throw new Error('Response body is not readable');
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let newConversationId: string | undefined;
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          // 提取 conversation_id
          if (event.conversation_id && !newConversationId) {
            newConversationId = event.conversation_id;
          }

          // 提取文本内容
          if (event.type === 'answer' && event.content) {
            fullText += event.content;
            callbacks.onToken(event.content);
          }
        } catch {
          // 跳过无法解析的事件
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  callbacks.onComplete(fullText);

  // 返回可能更新的 conversation_id
  return newConversationId || conversationId || '';
}

/**
 * 非流式调用（备用）
 */
export async function sendCozeMessage(
  token: string,
  botId: string,
  userId: string,
  message: string,
  conversationId?: string
): Promise<{ content: string; conversationId: string }> {
  const url = `${COZE_API_BASE}/v3/chat`;

  const body: CozeV3ChatRequest = {
    bot_id: botId,
    user_id: userId,
    stream: false,
    auto_save_history: true,
    additional_messages: [
      {
        role: 'user',
        content: message,
        content_type: 'text',
      },
    ],
  };

  if (conversationId) {
    body.conversation_id = conversationId;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Coze API error ${response.status}`);
  }

  const data = await response.json();

  // Coze v3 非流式返回结构
  const content =
    data.data?.content ||
    data.messages?.find((m: { role: string }) => m.role === 'assistant')
      ?.content ||
    '';
  const cid = data.data?.conversation_id || data.conversation_id || '';

  return { content, conversationId: cid };
}
