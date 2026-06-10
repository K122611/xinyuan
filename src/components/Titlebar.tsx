import React from 'react';

export function Titlebar() {
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-logo">💙</span>
        <span className="titlebar-title">心元 EMO-Mate</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 8, background: 'var(--bg-tertiary)', padding: '2px 8px', borderRadius: 10 }}>
          V1.0 MVP
        </span>
      </div>
      <div className="titlebar-controls">
        <span style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 8px' }}>
          🌐 浏览器预览模式
        </span>
      </div>
    </div>
  );
}
