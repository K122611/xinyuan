/** 聊天相关类型定义 */

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status?: 'sending' | 'sent' | 'error' | 'streaming';
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  botId: string;
  conversationId?: string; // Coze 对话ID
}

export interface AppSettings {
  cozeToken: string;
  cozeBotId: string;
  userName: string;
  theme: 'light' | 'dark';
}

export interface StreamingCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: string) => void;
}
