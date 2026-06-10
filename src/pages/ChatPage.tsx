import React, { useRef, useEffect, useState } from 'react';
import { useAppStore, useChatStore, useEmotionStore, usePetStore, useMilestoneStore } from '@/store';
import { chatWithCoze } from '@/services/cozeApi';

export function ChatPage() {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const initSession = useAppStore((s) => s.initSession);
  const { messages, isLoading, loadHistory, addMessage, setLoading, loadSessions, sessions } = useChatStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentMood = useEmotionStore((s) => s.currentMood);

  useEffect(() => {
    loadSessions();
    const savedSessionId = localStorage.getItem('xinyuan_currentSessionId');
    const sid = savedSessionId ? JSON.parse(savedSessionId) : initSession();
    if (savedSessionId) useAppStore.getState().setCurrentSession(sid);
    loadHistory(sid);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 简易本地情绪分析
  const analyzeLocalEmotion = (text: string): { score: number; label: string } => {
    const lower = text;
    const intenseWords = ['崩溃', '绝望', '不想活', '自残', '自杀', '受不了'];
    const negativeWords = ['焦虑', '难过', '压力', '失眠', '害怕', '烦', '累', '痛', '抑郁', '孤单', '孤独', '迷茫', '伤心', '生气', '愤怒'];

    let score = 6;
    const hasIntense = intenseWords.some(w => lower.includes(w));
    const hasNegative = negativeWords.filter(w => lower.includes(w)).length;

    if (hasIntense) score = 2;
    else if (hasNegative >= 3) score = 3;
    else if (hasNegative >= 1) score = 4;

    let label = '平静';
    if (score <= 2) label = '极度低落';
    else if (score <= 3) label = '低落';
    else if (score <= 4) label = '轻微低落';
    else if (score <= 5) label = '略感不适';
    else label = '平和';

    return { score, label };
  };

  // 本地共情回复引擎
  const generateResponse = (text: string, emotion: { score: number; label: string }): string => {
    const templates: Record<string, string[]> = {
      '极度低落': [
        '我在这里。你愿意告诉我更多关于你现在感受到的吗？不用急，慢慢说。',
        '听起来你现在非常沉重。深呼吸，我在听，你可以把所有想说的都说出来。\n\n🌬️ 我们先一起深呼吸：\n吸气 1、2、3……\n呼气 1、2、3……\n再来一次，感受空气慢慢充满，再缓缓释放。',
      ],
      '低落': [
        '我能感受到你现在的心情不太好。最近是遇到什么事了吗？愿意跟我说说吗？',
        '听起来你最近有些压抑。有时候说出来本身，就是一种释放。',
      ],
      '轻微低落': [
        '好像有些事让你不太舒服？我在这里，你可以慢慢说。',
        '我注意到你似乎有些心事。没关系，我们可以一起理一理。',
      ],
      '略感不适': [
        '听起来今天可能有些不太顺心？跟我聊聊吧。',
        '有些烦躁是吗？说出来会好一些的。',
      ],
      '平和': [
        '我在这里哦，有什么想聊的都可以跟我说~ 😊',
        '今天怎么样？遇到什么有趣的事了吗？',
        '嗯，我在听。你可以慢慢说~',
      ],
    };

    const pool = templates[emotion.label] || templates['平和'];
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    setInput('');
    const sessionId = currentSessionId || initSession();
    const userMsg = { id: Date.now().toString(), session_id: sessionId, role: 'user' as const, content: text };
    addMessage(userMsg);
    setLoading(true);

    // 情绪分析
    const emotion = analyzeLocalEmotion(text);

    // 更新萌宠状态
    const petMoodMap: Record<string, string> = {
      '极度低落': 'sad', '低落': 'sad', '轻微低落': 'anxious',
      '略感不适': 'anxious', '平和': 'calm',
    };
    usePetStore.getState().setPetMood(petMoodMap[emotion.label] || 'calm');

    // 记录情绪日志
    const now = new Date();
    useEmotionStore.getState().addLog({
      date: now.toISOString().split('T')[0],
      hour: now.getHours(),
      score: emotion.score,
      label: emotion.label,
      note: text.substring(0, 100),
    });

    // 里程碑检测
    const allLogs = JSON.parse(localStorage.getItem('xinyuan_emotionLogs') || '[]');
    if (allLogs.length === 1) {
      useMilestoneStore.getState().unlock({
        type: 'first_emotion',
        title: '🌱 初次表达',
        description: '第一次向心元诉说深层情绪',
      });
    }

    // 调用 Coze API 获取真实AI回复
    try {
      const appStore = useAppStore.getState();
      const cozeConvId = appStore.getCozeConvId(sessionId);

      // 新会话传空历史，让API注入心元人设；已有会话传完整历史
      const currentMessages = useChatStore.getState().messages;
      const history = cozeConvId
        ? currentMessages.map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          }))
        : [];

      const result = await chatWithCoze(text, cozeConvId, history);

      // 保存 Coze 会话ID 以便后续对话保持上下文
      if (result.conversationId) {
        appStore.setCozeConvId(sessionId, result.conversationId);
      }

      const aiMsg = {
        id: (Date.now() + 1).toString(),
        session_id: sessionId,
        role: 'assistant' as const,
        content: result.content,
        emotion_score: emotion.score,
        emotion_label: emotion.label,
      };
      addMessage(aiMsg);
    } catch (err) {
      console.warn('[ChatPage] Coze API 调用失败，使用本地模板回复:', err);
      // 降级到本地模板回复
      const response = generateResponse(text, emotion);
      const aiMsg = {
        id: (Date.now() + 1).toString(),
        session_id: sessionId,
        role: 'assistant' as const,
        content: response,
        emotion_score: emotion.score,
        emotion_label: emotion.label,
      };
      addMessage(aiMsg);
    }

    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const moodBg: Record<string, string> = {
    '极度低落': 'linear-gradient(135deg, #1a1a30 0%, #1a1025 100%)',
    '低落': 'linear-gradient(135deg, #1a1a30 0%, #1a1525 100%)',
    '轻微低落': 'linear-gradient(135deg, #1a1a2e 0%, #1a1a25 100%)',
    '略感不适': 'linear-gradient(135deg, #1a1a2e 0%, #1a1a28 100%)',
    '平和': 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: moodBg[currentMood] || moodBg['平和'], transition: 'background 0.5s' }}>
      {/* 顶部会话栏 */}
      <div style={{
        padding: '8px 20px', borderBottom: '1px solid var(--border)',
        display: 'flex', gap: 8, overflowX: 'auto', alignItems: 'center', flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>历史:</span>
        {sessions.slice(0, 10).map((s) => (
          <button
            key={s.session_id}
            onClick={() => { useAppStore.getState().setCurrentSession(s.session_id); loadHistory(s.session_id); }}
            style={{
              background: s.session_id === currentSessionId ? 'var(--bg-tertiary)' : 'transparent',
              border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px',
              fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {new Date(s.last_active).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </button>
        ))}
        <button
          onClick={() => { const sid = useAppStore.getState().initSession(); loadHistory(sid); }}
          style={{ background: 'var(--accent-warm)', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          + 新对话
        </button>
      </div>

      {/* 消息列表 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 100, color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>💙</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
              嗨，我是心元
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.8 }}>
              我不是来给你答案的<br />
              我是来陪你一起找答案的<br /><br />
              今天有什么想和我聊的吗？
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="fade-in" style={{
            display: 'flex', marginBottom: 16,
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '75%', padding: '12px 18px', borderRadius: 16,
              borderTopRightRadius: msg.role === 'user' ? 4 : 16,
              borderTopLeftRadius: msg.role === 'assistant' ? 4 : 16,
              background: msg.role === 'user' ? 'var(--accent-warm)' : 'var(--bg-card)',
              color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
              border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
              fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}>
              {msg.content}
              {msg.role === 'assistant' && msg.emotion_label && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', opacity: 0.7 }}>
                  🧠 情绪感知: {msg.emotion_label}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div style={{ padding: '12px 18px' }} className="pulse">
            <span style={{ color: 'var(--text-muted)' }}>心元正在聆听...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div style={{
        padding: '16px 24px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="在这里写下你想说的…（Enter发送，Shift+Enter换行）"
            className="input-field"
            style={{ resize: 'none', minHeight: 44, maxHeight: 120, flex: 1 }}
            rows={1}
          />
          <button className="btn btn-primary" onClick={handleSend}
            disabled={isLoading || !input.trim()}
            style={{ height: 44, minWidth: 70, opacity: isLoading || !input.trim() ? 0.5 : 1 }}>
            {isLoading ? '...' : '发送'}
          </button>
        </div>
        {currentMood && currentMood !== '平和' && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--accent-warm)' }}>
            🧠 心元感知到: {currentMood} · 我在这里
          </div>
        )}
      </div>
    </div>
  );
}
