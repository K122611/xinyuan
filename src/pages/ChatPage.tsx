import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store';

export default function ChatPage() {
  const {
    conversations,
    activeConversationId,
    isLoading,
    createConversation,
    deleteConversation,
    setActiveConversation,
    sendMessage,
    retryMessage,
  } = useAppStore();

  const [input, setInput] = useState('');
  const messageListRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeConv = conversations.find((c) => c.id === activeConversationId);

  // 自动滚动到底部
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [activeConv?.messages]);

  // 如果没有对话，自动创建
  useEffect(() => {
    if (conversations.length === 0) {
      createConversation();
    }
  }, [conversations.length, createConversation]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');

    if (!activeConversationId) {
      createConversation();
      // 需要等状态更新，简化处理：直接设
    }

    await sendMessage(text);

    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // 自动调整高度
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 150) + 'px';
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <div className="chat-page">
      {/* 侧边栏 */}
      <aside className="chat-sidebar">
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={() => createConversation()}>
            ＋ 新对话
          </button>
        </div>
        <div className="conversation-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conv-item ${conv.id === activeConversationId ? 'active' : ''}`}
              onClick={() => setActiveConversation(conv.id)}
            >
              <span className="conv-title">{conv.title || '新对话'}</span>
              <button
                className="conv-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('确定删除这个对话？')) {
                    deleteConversation(conv.id);
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, padding: 20 }}>
              点击上方按钮开始对话
            </p>
          )}
        </div>
      </aside>

      {/* 聊天主区域 */}
      <div className="chat-main">
        {!activeConv || activeConv.messages.length === 0 ? (
          <div className="chat-empty">
            <div className="empty-icon">💗</div>
            <h2>心元 EMO-Mate</h2>
            <p>你的情感陪伴伙伴，随时倾听与回应</p>
          </div>
        ) : (
          <div className="message-list" ref={messageListRef}>
            {activeConv.messages.map((msg) => (
              <div
                key={msg.id}
                className={`message ${msg.role} ${msg.status === 'error' ? 'error' : ''} ${msg.status === 'streaming' ? 'streaming' : ''}`}
              >
                <div className="message-avatar">
                  {msg.role === 'user' ? '👤' : '💗'}
                </div>
                <div className="message-content">
                  <div className="message-bubble">{msg.content}</div>
                  <div className="message-time">
                    {formatTime(msg.timestamp)}
                    {msg.status === 'error' && (
                      <span className="message-actions" style={{ display: 'inline', opacity: 1 }}>
                        <button
                          className="message-action-btn"
                          onClick={() => retryMessage(msg.id)}
                        >
                          重试
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 输入区域 */}
        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <textarea
              ref={textareaRef}
              className="chat-input"
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
              rows={1}
            />
            <button
              className="send-btn"
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
            >
              {isLoading ? '⏳' : '➤'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
