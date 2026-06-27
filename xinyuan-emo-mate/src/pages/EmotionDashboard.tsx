import React, { useEffect } from 'react';
import { useEmotionStore } from '@/store';

export function EmotionDashboard() {
  const { todayLogs, weeklyData, loadToday, loadWeekly } = useEmotionStore();

  useEffect(() => {
    loadToday();
    loadWeekly();
  }, []);

  const moodColors: Record<string, string> = {
    '极度低落': '#d04050', '低落': '#e07060', '轻微低落': '#e0a040',
    '略感不适': '#c0c040', '平和': '#60b060', '平静': '#60b0d0',
  };

  const todayAvg = todayLogs.length > 0
    ? todayLogs.reduce((s, l) => s + (l.score || 5), 0) / todayLogs.length
    : null;

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 20 }}>📊 情绪仪表盘</h2>

      {/* 今日概览 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">📅 今日情绪概览</div>
        {todayAvg !== null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ fontSize: 56, fontWeight: 700, color: 'var(--accent-warm)' }}>
              {todayAvg.toFixed(1)}
              <span style={{ fontSize: 20, color: 'var(--text-muted)' }}>/10</span>
            </div>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 4 }}>
                今日记录 {todayLogs.length} 次情绪变化
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {todayLogs.map((log, i) => (
                  <span key={i} style={{
                    padding: '3px 10px',
                    borderRadius: 12,
                    background: `${moodColors[log.label] || '#6080a0'}22`,
                    color: moodColors[log.label] || '#6080a0',
                    fontSize: 12,
                    border: `1px solid ${moodColors[log.label] || '#6080a0'}44`,
                  }}>
                    {log.label} {log.score}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>
            今天还没有情绪记录。去和心元聊聊天吧 💬
          </div>
        )}
      </div>

      {/* 周趋势图 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">📈 7日情绪趋势</div>
        {weeklyData.length > 0 ? (
          <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 160, padding: '8px 0' }}>
              {weeklyData.map((day, i) => {
                const h = (day.avg_score / 10) * 140;
                const color = day.avg_score >= 7 ? 'var(--accent-leaf)' :
                  day.avg_score >= 5 ? 'var(--accent-calm)' :
                  day.avg_score >= 3 ? 'var(--accent-warm)' : '#e06060';
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 4 }}>
                      {day.avg_score.toFixed(1)}
                    </div>
                    <div style={{
                      width: '100%',
                      height: Math.max(h, 8),
                      background: color,
                      borderRadius: '4px 4px 0 0',
                      transition: 'height 0.5s',
                      opacity: 0.8,
                    }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                      {new Date(day.date).toLocaleDateString('zh-CN', { weekday: 'short' })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: 4, fontSize: 10, color: 'var(--text-muted)',
            }}>
              <span>😞 低落</span>
              <span>😐 一般</span>
              <span>😊 良好</span>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
            数据收集中，需要至少3天的记录 📡
          </div>
        )}
      </div>

      {/* 压力源分布 */}
      <div className="card">
        <div className="card-header">🎯 压力源分布（本周）</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: '职场', count: 3, color: 'var(--accent-warm)' },
            { label: '家庭', count: 2, color: 'var(--accent-heart)' },
            { label: '学业', count: 1, color: 'var(--accent-calm)' },
            { label: '社交', count: 2, color: 'var(--accent-leaf)' },
            { label: '存在焦虑', count: 1, color: 'var(--accent-glow)' },
          ].map((item) => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', background: 'var(--bg-tertiary)',
              borderRadius: 8,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `${item.color}22`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: item.color, fontWeight: 700, fontSize: 16,
              }}>
                {item.count}
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>提及 {item.count} 次</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
