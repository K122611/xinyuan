import React, { useEffect, useState } from 'react';
import { useMemoryStore, usePetStore } from '@/store';

const typeConfig: Record<string, { icon: string; color: string; label: string }> = {
  event:   { icon: '📌', color: '#60b0d0', label: '事件' },
  person:  { icon: '👤', color: '#d0a060', label: '人物' },
  feeling: { icon: '💭', color: '#e06080', label: '感受' },
  milestone: { icon: '🏆', color: '#60c080', label: '里程碑' },
  trauma:  { icon: '🕯️', color: '#8060a0', label: '创伤' },
};

export function MemoryWall() {
  const { anchors, loadAnchors, addAnchor } = useMemoryStore();
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ type: 'feeling', title: '', content: '', emotion: '', importance: 5 });

  useEffect(() => { loadAnchors(); }, []);

  const handleAdd = async () => {
    if (!form.title.trim()) return;
    const anchor = {
      id: Date.now().toString(),
      type: form.type,
      title: form.title,
      content: form.content,
      tags: null,
      emotion: form.emotion,
      importance: form.importance,
      is_marked: 1,
      created_at: new Date().toISOString(),
    };
    
    useMemoryStore.getState().addAnchor(anchor);
    // 方案C：记录记忆里程碑时萌宠反应
    if (form.type === 'milestone' || form.importance >= 7) {
      usePetStore.getState().showSpeechBubble(
        `🌟 你记录了一个重要时刻：「${form.title}」`,
        '喜悦',
        'system'
      );
      usePetStore.getState().addExperience(15);
    } else {
      usePetStore.getState().addExperience(3);
    }
    setForm({ type: 'feeling', title: '', content: '', emotion: '', importance: 5 });
    setShowAddForm(false);
  };

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600 }}>🌟 记忆墙</h2>
        <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? '取消' : '+ 添加记忆'}
        </button>
      </div>

      {showAddForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">📝 记录新的记忆锚点</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {Object.entries(typeConfig).map(([type, cfg]) => (
                <button
                  key={type}
                  onClick={() => setForm({ ...form, type })}
                  style={{
                    padding: '6px 14px', borderRadius: 16, border: form.type === type ? `2px solid ${cfg.color}` : '1px solid var(--border)',
                    background: form.type === type ? `${cfg.color}22` : 'transparent',
                    color: form.type === type ? cfg.color : 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 12,
                  }}
                >
                  {cfg.icon} {cfg.label}
                </button>
              ))}
            </div>
            <input className="input-field" placeholder="标题" value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <textarea className="input-field" placeholder="内容/对话摘录" value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              style={{ minHeight: 80, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 12 }}>
              <input className="input-field" placeholder="情绪标签" value={form.emotion}
                onChange={(e) => setForm({ ...form, emotion: e.target.value })}
                style={{ flex: 1 }} />
              <select className="input-field" value={form.importance}
                onChange={(e) => setForm({ ...form, importance: parseInt(e.target.value) })}
                style={{ width: 120 }}>
                {[1,2,3,4,5,6,7,8,9,10].map(n => (
                  <option key={n} value={n}>重要度 {n}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" onClick={handleAdd}>保存记忆</button>
          </div>
        </div>
      )}

      {anchors.length === 0 ? (
        <div style={{ textAlign: 'center', paddingTop: 80, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🌟</div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>
            记忆墙是空的
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.8 }}>
            在和心元聊天的过程中，你可以标记重要的瞬间<br />
            心元也会自动识别值得记住的时刻<br />
            这些记忆会帮你在未来更好地理解自己
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {anchors.map((anchor) => {
            const cfg = typeConfig[anchor.type] || typeConfig['event'];
            return (
              <div key={anchor.id} className="card fade-in" style={{ cursor: 'pointer' }}
                onClick={() => {
                  const anchors = useMemoryStore.getState().anchors;
                  const idx = anchors.findIndex(a => a.id === anchor.id);
                  if (idx >= 0) {
                    const updated = [...anchors];
                    updated[idx] = { ...updated[idx], recalled_at: new Date().toISOString() };
                    localStorage.setItem('xinyuan_memoryAnchors', JSON.stringify(updated));
                  }
                }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 10, fontSize: 11,
                    background: `${cfg.color}22`, color: cfg.color,
                  }}>
                    {cfg.icon} {cfg.label}
                  </span>
                  {anchor.emotion && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {anchor.emotion}
                    </span>
                  )}
                </div>
                <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{anchor.title}</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {anchor.content}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>重要度: {'⭐'.repeat(Math.min(anchor.importance || 5, 5))}</span>
                  <span>{new Date(anchor.created_at).toLocaleDateString('zh-CN')}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
