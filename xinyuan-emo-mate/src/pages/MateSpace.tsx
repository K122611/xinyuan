import React, { useEffect, useState, useRef } from 'react';
import { useMateStore, usePetStore, useEmotionStore } from '@/store';
import { useAuthStore } from '@/store/authStore';

const matchModes = [
  { id: 'resonance', label: '共鸣搭子', icon: '🫂', desc: '与你有相似情绪状态的同行者', color: '#60b0d0' },
  { id: 'complement', label: '互补搭子', icon: '🌟', desc: '走过你当前困境的过来人', color: '#60c080' },
  { id: 'growth', label: '成长搭子', icon: '🌱', desc: '一起练习情绪技能', color: '#d0a060' },
  { id: 'silent', label: '静默搭子', icon: '🌙', desc: '不说话，萌宠替你陪伴', color: '#9080e0' },
];

type TabId = 'mates' | 'requests' | 'search';

export function MateSpace() {
  const {
    mates, incomingRequests, searchResults, isSearching,
    activeMateId, activeMateUserId, messages,
    loadMates, loadIncomingRequests,
    searchForMates, requestMate, acceptRequest, rejectRequest,
    setActiveMate, loadMateMessages, sendMessage, clearSearch,
    hasSearched,
  } = useMateStore();
  const { user } = useAuthStore();
  const { currentMood } = useEmotionStore();

  const [activeTab, setActiveTab] = useState<TabId>('mates');
  const [inputText, setInputText] = useState('');
  const [selectedMode, setSelectedMode] = useState('resonance');
  const [requestMsg, setRequestMsg] = useState('');
  const [sendingRequestTo, setSendingRequestTo] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 初始化加载
  useEffect(() => {
    if (user?.id) {
      loadMates();
      loadIncomingRequests();
    }
  }, [user?.id]);

  // 列表轮询：每 5 秒刷新搭子列表和申请列表（根据当前 tab）
  useEffect(() => {
    if (!user?.id) return;
    const timer = setInterval(() => {
      if (activeTab === 'mates') loadMates();
      if (activeTab === 'requests') loadIncomingRequests();
    }, 5000);
    return () => clearInterval(timer);
  }, [user?.id, activeTab, loadMates, loadIncomingRequests]);

  // 进入聊天时加载消息 + 启动轮询
  useEffect(() => {
    if (activeMateId) {
      loadMateMessages(activeMateId);
      // 每 3 秒轮询新消息
      pollingRef.current = setInterval(() => {
        loadMateMessages(activeMateId);
      }, 3000);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeMateId]);

  // 自动滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 未登录提示
  if (!user?.id) {
    return (
      <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🤝</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
          请先登录
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          登录后才能使用搭子空间功能
        </div>
      </div>
    );
  }

  const hasIncomingRequests = incomingRequests.length > 0;

  // ========== 搜索搭子 ==========
  const handleSearch = async () => {
    setErrorMsg('');
    await searchForMates(selectedMode, currentMood || undefined);
  };

  const handleSendRequest = async (toUserId: string, toUsername: string) => {
    setSendingRequestTo(toUserId);
    setErrorMsg('');
    try {
      await requestMate(toUserId, toUsername, requestMsg || undefined);
      setRequestMsg('');
    } catch (err: any) {
      setErrorMsg(err.message || '发送申请失败');
    } finally {
      setSendingRequestTo(null);
    }
  };

  // ========== 聊天 ==========
  const handleSendChat = async () => {
    const text = inputText.trim();
    if (!text || !activeMateId) return;
    setInputText('');
    await sendMessage(text);
  };

  const activeMate = mates.find(m => m.id === activeMateId);

  // ========== 退出聊天 ==========
  const handleBackToList = () => {
    setActiveMate(null, null);
  };

  // ========== 渲染聊天界面 ==========
  if (activeMate && activeMateId) {
    return (
      <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
        {/* 顶部栏 */}
        <div style={{
          padding: '10px 16px',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius)',
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleBackToList}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 18, color: 'var(--text-muted)', padding: '4px 8px',
              }}
            >
              ←
            </button>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {activeMate.mate_nickname}
            </span>
            {activeMate.mate_emotion_label && (
              <span style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 10,
                background: 'var(--accent-calm)',
                color: '#fff',
              }}>
                {activeMate.mate_emotion_label}
              </span>
            )}
          </div>
        </div>

        {/* 消息列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
              开始你们的第一次对话吧
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className="fade-in"
              style={{
                display: 'flex',
                marginBottom: 12,
                justifyContent: msg.sender_role === 'me' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '70%',
                padding: '10px 16px',
                borderRadius: 14,
                background: msg.sender_role === 'me' ? 'var(--accent-calm)' : 'var(--bg-card)',
                color: msg.sender_role === 'me' ? '#fff' : 'var(--text-primary)',
                border: msg.sender_role === 'mate' ? '1px solid var(--border)' : 'none',
                fontSize: 14,
              }}>
                {msg.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入框 */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
            placeholder="说点什么..."
            className="input-field"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={handleSendChat}>发送</button>
        </div>
      </div>
    );
  }

  // ========== 主界面 ==========
  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>🤝 搭子空间</h2>
      </div>

      {/* Tab 切换 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)', padding: 3 }}>
        {([
          { id: 'mates' as TabId, label: '我的搭子', badge: mates.length },
          { id: 'requests' as TabId, label: '好友申请', badge: incomingRequests.length, highlight: hasIncomingRequests },
          { id: 'search' as TabId, label: '寻找搭子', badge: null },
        ]).map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id === 'requests') loadIncomingRequests();
              if (tab.id === 'mates') loadMates();
            }}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: activeTab === tab.id ? 'var(--bg-card)' : 'transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
              fontWeight: activeTab === tab.id ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              position: 'relative',
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span style={{
                marginLeft: 4,
                padding: '1px 6px',
                borderRadius: 10,
                fontSize: 11,
                background: tab.highlight ? '#e04040' : 'var(--accent-calm)',
                color: '#fff',
              }}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 错误提示 */}
      {errorMsg && (
        <div style={{
          padding: '8px 12px', marginBottom: 12, borderRadius: 'var(--radius-sm)',
          background: 'rgba(224,64,64,0.1)', color: '#e04040', fontSize: 13,
        }}>
          {errorMsg}
          <button onClick={() => setErrorMsg('')} style={{ marginLeft: 8, background: 'none', border: 'none', color: '#e04040', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* ====== Tab: 我的搭子 ====== */}
      {activeTab === 'mates' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {mates.length > 0 ? (
            mates.map((m) => (
              <div
                key={m.id}
                className="card"
                style={{ marginBottom: 8, cursor: 'pointer' }}
                onClick={() => { setActiveMate(m.id, m.mate_id); }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 24 }}>👤</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{m.mate_nickname}</div>
                      {m.mate_emotion_label && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          当前情绪: {m.mate_emotion_label}
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {new Date(m.created_at).toLocaleDateString('zh-CN')}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--accent-calm)', marginTop: 2 }}>
                      点击聊天 →
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ textAlign: 'center', paddingTop: 80 }}>
              <div style={{ fontSize: 64, marginBottom: 16 }}>🤝</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
                还没有搭子
              </div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 24, lineHeight: 1.8 }}>
                找一个和你有情绪共鸣的同行者<br />
                不是交友，是恰好在同一片天空下
              </div>
              <button className="btn btn-primary" onClick={() => setActiveTab('search')}>
                去寻找搭子
              </button>
            </div>
          )}
        </div>
      )}

      {/* ====== Tab: 好友申请 ====== */}
      {activeTab === 'requests' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {incomingRequests.length > 0 ? (
            incomingRequests.map((req) => (
              <div key={req.id} className="card" style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 28 }}>👤</span>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>
                        {req.from_username || '未知用户'}
                      </div>
                      {req.from_emotion_label && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          情绪: {req.from_emotion_label}
                        </div>
                      )}
                      {req.message && (
                        <div style={{
                          fontSize: 13, color: 'var(--text-secondary)',
                          marginTop: 4, padding: '6px 10px',
                          background: 'var(--bg-tertiary)', borderRadius: 8,
                        }}>
                          "{req.message}"
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {new Date(req.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      className="btn btn-primary"
                      style={{ padding: '6px 14px', fontSize: 12 }}
                      onClick={() => acceptRequest(req.id, req.from_user_id, req.from_username || '')}
                    >
                      ✓ 接受
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '6px 14px', fontSize: 12 }}
                      onClick={() => rejectRequest(req.id)}
                    >
                      ✕ 拒绝
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ textAlign: 'center', paddingTop: 80 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
              <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>
                暂无好友申请
              </div>
            </div>
          )}
        </div>
      )}

      {/* ====== Tab: 寻找搭子 ====== */}
      {activeTab === 'search' && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* 匹配模式选择 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>选择匹配模式</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {matchModes.map((mode) => (
                <div
                  key={mode.id}
                  onClick={() => { setSelectedMode(mode.id); clearSearch(); }}
                  style={{
                    padding: '12px',
                    borderRadius: 'var(--radius-sm)',
                    border: selectedMode === mode.id ? `2px solid ${mode.color}` : '1px solid var(--border)',
                    background: selectedMode === mode.id ? `${mode.color}15` : 'var(--bg-tertiary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{mode.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{mode.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{mode.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 搜索按钮 */}
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 16 }}
            onClick={handleSearch}
            disabled={isSearching}
          >
            {isSearching ? '搜索中...' : '🔍 开始匹配'}
          </button>

          {/* 搜索中 */}
          {isSearching && (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div className="pulse" style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                正在为你寻找合适的搭子...
              </div>
            </div>
          )}

          {/* 搜索结果 */}
          {!isSearching && searchResults.length > 0 && (
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                找到 {searchResults.length} 位潜在搭子
              </div>
              {searchResults.map((profile) => (
                <div key={profile.id} className="card" style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 28 }}>👤</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 15 }}>{profile.username}</div>
                        {profile.emotion_label && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            当前情绪: {profile.emotion_label}
                          </div>
                        )}
                        {profile.mood_tags && (
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            标签: {profile.mood_tags}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                      {/* 申请消息输入 */}
                      <input
                        value={requestMsg}
                        onChange={(e) => setRequestMsg(e.target.value)}
                        placeholder="打招呼..."
                        style={{
                          width: 120, fontSize: 12, padding: '4px 8px',
                          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                          background: 'var(--bg-tertiary)', color: 'var(--text-primary)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                        disabled={sendingRequestTo === profile.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSendRequest(profile.id, profile.username);
                        }}
                      >
                        {sendingRequestTo === profile.id ? '发送中...' : '➕ 添加搭子'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 无结果 — 已搜过 */}
          {!isSearching && hasSearched && searchResults.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>😕</div>
              <div style={{ fontSize: 15, color: 'var(--text-secondary)', marginBottom: 4 }}>
                没有找到匹配的用户
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                按 F12 打开控制台查看 [MateSearch] DIAG 日志
              </div>
            </div>
          )}

          {/* 无结果 — 还没搜过 */}
          {!isSearching && !hasSearched && searchResults.length === 0 && (
            <div style={{ textAlign: 'center', paddingTop: 40 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
              <div style={{ fontSize: 15, color: 'var(--text-muted)' }}>
                选择匹配模式后点击"开始匹配"
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                系统会根据你的情绪状态推荐合适的搭子
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
