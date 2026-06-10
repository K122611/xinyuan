import React, { useEffect, useState } from 'react';
import { useMateStore } from '@/store';

const matchModes = [
  { id: 'resonance', label: '共鸣搭子', icon: '🫂', desc: '与你有相似情绪状态的同行者', color: '#60b0d0' },
  { id: 'complement', label: '互补搭子', icon: '🌟', desc: '走过你当前困境的过来人', color: '#60c080' },
  { id: 'growth', label: '成长搭子', icon: '🌱', desc: '一起练习情绪技能', color: '#d0a060' },
  { id: 'silent', label: '静默搭子', icon: '🌙', desc: '不说话，萌宠替你陪伴', color: '#9080e0' },
];

export function MateSpace() {
  const { matches, activeMatchId, messages, loadMatches, setActiveMatch, loadMessages, addMessage } = useMateStore();
  const [matchInput, setMatchInput] = useState('');
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [selectedMode, setSelectedMode] = useState('resonance');
  const [isSearching, setIsSearching] = useState(false);
  const [foundMate, setFoundMate] = useState<{ nickname: string; mood: string; stress: string } | null>(null);

  useEffect(() => { loadMatches(); }, []);
  useEffect(() => {
    if (activeMatchId) loadMessages(activeMatchId);
  }, [activeMatchId]);

  const handleSearchMate = async () => {
    setIsSearching(true);
    setFoundMate(null);
    // 模拟匹配搜索
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 1500));
    
    const mates = [
      { nickname: '星光旅人', mood: '轻微低落', stress: '职场压力' },
      { nickname: '暖风', mood: '平静', stress: '家庭关系' },
      { nickname: '深海蓝', mood: '轻度焦虑', stress: '学业压力' },
    ];
    const mate = mates[Math.floor(Math.random() * mates.length)];
    setFoundMate(mate);
    setIsSearching(false);
  };

  const handleConfirmMatch = async () => {
    if (!foundMate) return;
    useMateStore.getState().createMatch({
      mateId: Date.now().toString(),
      mateNickname: foundMate.nickname,
      matchMode: selectedMode,
    });
    setShowMatchModal(false);
    setFoundMate(null);
  };

  const handleSendMateMessage = async () => {
    const text = matchInput.trim();
    if (!text || !activeMatchId) return;
    setMatchInput('');
    const msg = { id: Date.now().toString(), match_id: activeMatchId, sender_role: 'me' as const, content: text };
    addMessage(msg);
    
    // 模拟搭子回复
    await new Promise(r => setTimeout(r, 1500));
    const reply = { id: (Date.now() + 1).toString(), match_id: activeMatchId, sender_role: 'mate', content: '嗯，我能理解你的感受...' };
    addMessage(reply);
  };

  const activeMatch = matches.find(m => m.id === activeMatchId);

  return (
    <div style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>🤝 搭子空间</h2>
        <button className="btn btn-primary" onClick={() => setShowMatchModal(true)}>
          + 寻找搭子
        </button>
      </div>

      {activeMatch ? (
        // 搭子对话界面
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{
            padding: '10px 16px',
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius)',
            marginBottom: 12,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <span style={{ fontWeight: 600 }}>{activeMatch.mate_nickname}</span>
              <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                {matchModes.find(m => m.id === activeMatch.match_mode)?.label}
              </span>
            </div>
            <button
              className="btn btn-secondary"
              style={{ padding: '4px 12px', fontSize: 12 }}
              onClick={async () => {
                if (activeMatchId) {
                  useMateStore.getState().endMatch(activeMatchId);
                }
              }}
            >
              结束搭子
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
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
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-muted)' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🤝</div>
                开始你们的第一次对话吧
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              value={matchInput}
              onChange={(e) => setMatchInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendMateMessage(); }}
              placeholder="说点什么..."
              className="input-field"
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleSendMateMessage}>发送</button>
          </div>
        </div>
      ) : (
        // 搭子列表 + 匹配引导
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {matches.filter(m => m.status === 'active').length > 0 ? (
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 12 }}>
                你的搭子 ({matches.filter(m => m.status === 'active').length})
              </div>
              {matches.filter(m => m.status === 'active').map((m) => (
                <div
                  key={m.id}
                  className="card"
                  style={{ marginBottom: 8, cursor: 'pointer' }}
                  onClick={() => setActiveMatch(m.id)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 15 }}>{m.mate_nickname}</span>
                      <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                        {matchModes.find(mode => mode.id === m.match_mode)?.label}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      匹配于 {new Date(m.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
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
              <button className="btn btn-primary" onClick={() => setShowMatchModal(true)}>
                寻找搭子
              </button>
            </div>
          )}
        </div>
      )}

      {/* 匹配弹窗 */}
      {showMatchModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div className="card" style={{ width: 440, maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="card-header">🔍 寻找搭子</div>

            {!foundMate && !isSearching && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>选择匹配模式</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {matchModes.map((mode) => (
                      <div
                        key={mode.id}
                        onClick={() => setSelectedMode(mode.id)}
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
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSearchMate}>
                  开始匹配
                </button>
              </>
            )}

            {isSearching && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div className="pulse" style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
                <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                  正在为你寻找合适的搭子...
                </div>
              </div>
            )}

            {foundMate && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 64, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                  {foundMate.nickname}
                </div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
                  当前情绪: {foundMate.mood} · 关注: {foundMate.stress}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => { setFoundMate(null); }}>
                    换一个
                  </button>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmMatch}>
                    连接搭子
                  </button>
                </div>
              </div>
            )}

            <button
              className="btn btn-secondary"
              style={{ width: '100%', marginTop: 12 }}
              onClick={() => { setShowMatchModal(false); setFoundMate(null); }}
            >
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
