import React from 'react';
import { useAppStore, usePetStore } from '@/store';

const menuGroups = [
  {
    section: '核心功能',
    items: [
      { id: 'chat', icon: '💬', label: '对话' },
      { id: 'pet', icon: '🐾', label: '萌宠花园' },
      { id: 'emotion', icon: '📊', label: '情绪仪表盘' },
    ],
  },
  {
    section: '设备互联',
    items: [
      { id: 'xiaozhi', icon: '👁️', label: '视觉小智' },
    ],
  },
  {
    section: '心元特色',
    items: [
      { id: 'mate', icon: '🤝', label: '搭子空间' },
      { id: 'memory', icon: '🌟', label: '记忆墙' },
    ],
  },
  {
    section: '其他',
    items: [
      { id: 'settings', icon: '⚙️', label: '设置' },
    ],
  },
];

export function Sidebar() {
  const currentPage = useAppStore((s) => s.currentPage);
  const setPage = useAppStore((s) => s.setPage);
  const pet = usePetStore((s) => s.pet);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);

  if (collapsed) return null;

  const moodEmoji: Record<string, string> = {
    calm: '😊', anxious: '😰', sad: '😢', joyful: '🥳',
    sleepy: '😴', angry: '😤', neutral: '😐',
  };

  return (
    <div className="sidebar">
      <nav className="sidebar-nav">
        {menuGroups.map((group) => (
          <React.Fragment key={group.section}>
            <div className="sidebar-section">{group.section}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                className={`sidebar-item ${currentPage === item.id ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
              >
                <span className="sidebar-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </React.Fragment>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px' }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'var(--bg-tertiary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22,
            }}
          >
            {moodEmoji[pet?.mood] || '😊'}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              心元萌宠 · Lv.{pet?.level || 1}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              ⚡ {pet?.energy || 5}/10 · EXP {pet?.exp || 0}/100
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
