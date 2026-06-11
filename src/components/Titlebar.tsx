import React from 'react';
import { useAuthStore } from '@/store/authStore';

export function Titlebar() {
  const { username, logout } = useAuthStore();

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-logo">💙</span>
        <span className="titlebar-title">心元 EMO-Mate</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8, background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 10 }}>
          V1.0 MVP
        </span>
      </div>
      <div className="titlebar-controls" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {username && (
          <>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              👤 {username}
            </span>
            <button
              onClick={logout}
              title="登出"
              style={{
                background: 'var(--bg-tertiary)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: '2px 10px',
                fontSize: 12,
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              登出
            </button>
          </>
        )}
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          🌐 浏览器预览模式
        </span>
      </div>
    </div>
  );
}
