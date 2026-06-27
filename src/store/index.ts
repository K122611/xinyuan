import { create } from 'zustand';
import type { Conversation, ChatMessage, AppSettings } from '../types';
import { streamCozeChat } from '../services/cozeApi';

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

interface AppState {
  // 设置
  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;

  // 对话列表
  conversations: Conversation[];
  activeConversationId: string | null;

  // 对话操作
  createConversation: () => string;
  deleteConversation: (id: string) => void;
  setActiveConversation: (id: string) => void;

  // 消息操作
  sendMessage: (content: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;

  // UI 状态
  isLoading: boolean;
  streamingContent: string;

  // 获取当前活跃对话
  getActiveConversation: () => Conversation | undefined;

  // 持久化
  saveToLocal: () => void;
  loadFromLocal: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  settings: {
    cozeToken: '',
    cozeBotId: '',
    userName: '用户',
    theme: 'light',
  },

  conversations: [],
  activeConversationId: null,
  isLoading: false,
  streamingContent: '',

  updateSettings: (partial) => {
    set((s) => ({ settings: { ...s.settings, ...partial } }));
    get().saveToLocal();
  },

  createConversation: () => {
    const id = genId();
    const conv: Conversation = {
      id,
      title: '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      botId: get().settings.cozeBotId,
    };
    set((s) => ({
      conversations: [conv, ...s.conversations],
      activeConversationId: id,
    }));
    get().saveToLocal();
    return id;
  },

  deleteConversation: (id) => {
    set((s) => {
      const filtered = s.conversations.filter((c) => c.id !== id);
      return {
        conversations: filtered,
        activeConversationId:
          s.activeConversationId === id
            ? filtered[0]?.id || null
            : s.activeConversationId,
      };
    });
    get().saveToLocal();
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id });
  },

  getActiveConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId);
  },

  sendMessage: async (content: string) => {
    const { settings, activeConversationId } = get();
    if (!activeConversationId) return;
    if (!settings.cozeToken || !settings.cozeBotId) {
      // 无API配置时，本地回显
      const userMsg: ChatMessage = {
        id: genId(),
        role: 'user',
        content,
        timestamp: Date.now(),
        status: 'sent',
      };
      const echoMsg: ChatMessage = {
        id: genId(),
        role: 'assistant',
        content: '⚠️ 请先在设置中配置 Coze API Token 和 Bot ID',
        timestamp: Date.now(),
        status: 'sent',
      };
      set((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                messages: [...c.messages, userMsg, echoMsg],
                title:
                  c.messages.length === 0
                    ? content.slice(0, 30)
                    : c.title,
                updatedAt: Date.now(),
              }
            : c
        ),
      }));
      get().saveToLocal();
      return;
    }

    const conv = get().conversations.find(
      (c) => c.id === activeConversationId
    );
    if (!conv) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: 'user',
      content,
      timestamp: Date.now(),
      status: 'sent',
    };

    const assistantMsg: ChatMessage = {
      id: genId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      status: 'streaming',
    };

    set((s) => ({
      isLoading: true,
      streamingContent: '',
      conversations: s.conversations.map((c) =>
        c.id === activeConversationId
          ? {
              ...c,
              messages: [...c.messages, userMsg, assistantMsg],
              title:
                c.messages.length === 0 ? content.slice(0, 30) : c.title,
              updatedAt: Date.now(),
            }
          : c
      ),
    }));

    try {
      const newCid = await streamCozeChat(
        settings.cozeToken,
        settings.cozeBotId,
        settings.userName,
        [userMsg],
        conv.conversationId,
        {
          onToken: (token) => {
            set((s) => {
              const streaming = s.streamingContent + token;
              return {
                streamingContent: streaming,
                conversations: s.conversations.map((c) =>
                  c.id === activeConversationId
                    ? {
                        ...c,
                        messages: c.messages.map((m) =>
                          m.id === assistantMsg.id
                            ? { ...m, content: streaming }
                            : m
                        ),
                      }
                    : c
                ),
              };
            });
          },
          onComplete: async (fullText) => {
            set((s) => ({
              isLoading: false,
              streamingContent: '',
              conversations: s.conversations.map((c) =>
                c.id === activeConversationId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMsg.id
                          ? { ...m, content: fullText, status: 'sent' }
                          : m
                      ),
                    }
                  : c
              ),
            }));
            get().saveToLocal();

            // 设备 TTS: 让已连接的 ESP32 设备朗读 AI 回复
            try {
              const aiAPI = (window as any).aiAPI;
              if (aiAPI && fullText) {
                const sessions = await aiAPI.getSessions();
                if (sessions && sessions.length > 0) {
                  const sid = sessions[0].id;
                  console.log('[DeviceTTS] 推送回复到设备:', sid?.slice(0, 8), fullText.slice(0, 40) + '...');
                  aiAPI.speakText(sid, fullText).then((res: any) => {
                    console.log('[DeviceTTS] 结果:', res);
                  }).catch((e: any) => {
                    console.warn('[DeviceTTS] 失败:', e);
                  });
                }
              }
            } catch { /* 非 Electron 环境忽略 */ }
          },
          onError: (error) => {
            set((s) => ({
              isLoading: false,
              streamingContent: '',
              conversations: s.conversations.map((c) =>
                c.id === activeConversationId
                  ? {
                      ...c,
                      messages: c.messages.map((m) =>
                        m.id === assistantMsg.id
                          ? {
                              ...m,
                              content: `❌ 错误: ${error}`,
                              status: 'error',
                              error,
                            }
                          : m
                      ),
                    }
                  : c
              ),
            }));
            get().saveToLocal();
          },
        }
      );

      // 更新 conversation_id
      if (newCid) {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === activeConversationId
              ? { ...c, conversationId: newCid }
              : c
          ),
        }));
        get().saveToLocal();
      }
    } catch (err: any) {
      set((s) => ({
        isLoading: false,
        conversations: s.conversations.map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        content: `❌ 请求失败: ${err.message}`,
                        status: 'error',
                      }
                    : m
                ),
              }
            : c
        ),
      }));
      get().saveToLocal();
    }
  },

  retryMessage: async (messageId: string) => {
    const conv = get().getActiveConversation();
    if (!conv) return;

    const msgIndex = conv.messages.findIndex((m) => m.id === messageId);
    if (msgIndex <= 0) return;

    const userMsg = conv.messages[msgIndex - 1];
    if (userMsg.role !== 'user') return;

    // 移除失败的消息
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === conv.id
          ? {
              ...c,
              messages: c.messages.filter((m) => m.id !== messageId),
            }
          : c
      ),
    }));

    // 重新发送
    await get().sendMessage(userMsg.content);
  },

  saveToLocal: () => {
    try {
      const { conversations, settings } = get();
      localStorage.setItem('xin-yuan-conversations', JSON.stringify(conversations));
      localStorage.setItem('xin-yuan-settings', JSON.stringify(settings));
    } catch {
      // 忽略存储错误
    }
  },

  loadFromLocal: () => {
    try {
      const convsStr = localStorage.getItem('xin-yuan-conversations');
      const settingsStr = localStorage.getItem('xin-yuan-settings');
      if (convsStr) {
        const convs = JSON.parse(convsStr);
        set({ conversations: convs });
      }
      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        set({ settings: { ...get().settings, ...settings } });
      }
    } catch {
      // 忽略加载错误
    }
  },
}));
