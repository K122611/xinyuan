import React, { useEffect, useState, useCallback } from 'react';
import { connect, disconnect, isConnected, isBreathing, getFullStatus, setEmotion, listPorts } from '@/services/servo';
import type { BreatheConfig } from '@/services/servo';
import { usePetStore } from '@/store';

interface ServoState {
  connected: boolean;
  breathing: boolean;
  breatheConfig: BreatheConfig | null;
  emotion: string;
}

const EMOTION_LABELS: Record<string, string> = {
  peaceful: '平和', neutral: '中性', calm: '平静', relaxed: '放松',
  sad: '低落', low: '轻微低落', lonely: '孤独', disappointed: '失望',
  happy: '开心', joy: '喜悦', excited: '兴奋', love: '爱', grateful: '感恩',
  content: '满足', satisfied: '满意',
  confused: '困惑', surprised: '惊讶',
  anxious: '焦虑', worried: '担忧',
  angry: '愤怒', frustrated: '沮丧',
  bored: '无聊', tired: '疲惫',
  平和: '平和', 低落: '低落', 开心: '开心', 平静: '平静',
  焦虑: '焦虑', 愤怒: '愤怒', 困惑: '困惑',
};

const ServoPanel: React.FC = () => {
  const [state, setState] = useState<ServoState>({
    connected: false, breathing: false, breatheConfig: null, emotion: '',
  });
  const [connecting, setConnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState('');
  const [ports, setPorts] = useState<Array<{ path: string; manufacturer: string }>>([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [scanning, setScanning] = useState(false);

  // 注入呼吸动画关键帧
  useEffect(() => {
    const styleId = 'servo-breathe-keyframes';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes servoBreathe {
        0%, 100% { transform: scaleX(0.2); opacity: 0.6; }
        50% { transform: scaleX(1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      const el = document.getElementById(styleId);
      if (el) el.remove();
    };
  }, []);

  const refresh = useCallback(async () => {
    const s = await getFullStatus();
    setState(s);
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  // 扫描可用串口
  const handleScanPorts = async () => {
    setScanning(true);
    setLastMessage('');
    try {
      const found = await listPorts();
      setPorts(found);
      if (found.length === 0) {
        setLastMessage('未找到串口设备，请确认 Arduino 已连接');
      } else {
        setLastMessage(`找到 ${found.length} 个串口`);
        if (!selectedPort && found.length > 0) {
          setSelectedPort(found[0].path);
        }
      }
    } catch {
      setLastMessage('扫描失败');
    } finally {
      setScanning(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setLastMessage('');
    const result = selectedPort ? await connect(selectedPort) : await connect();
    setConnecting(false);
    if (result.success) {
      const mood = usePetStore.getState().pet.mood || 'calm';
      console.log('[ServoPanel] 连接成功，同步情绪:', mood);
      await setEmotion(mood);
    } else {
      console.warn('[ServoPanel] 连接失败:', result.message);
    }
    setLastMessage(result.message);
    refresh();
  };

  const handleDisconnect = async () => {
    await disconnect();
    setLastMessage('已断开');
    refresh();
  };

  // 启动时自动扫描一次
  useEffect(() => { handleScanPorts(); }, []);

  const emotionLabel = EMOTION_LABELS[state.emotion] || state.emotion || '未识别';

  return (
    <div style={styles.panel}>
      {/* 标题 */}
      <div style={styles.header}>
        <span style={styles.icon}>🧬</span>
        <div>
          <div style={styles.title}>心元特色 · 实体桌宠</div>
          <div style={styles.subtitle}>舵机情绪联动 SG90</div>
        </div>
      </div>

      {/* 连接状态 */}
      <div style={styles.statusRow}>
        <div style={{
          ...styles.dot,
          background: state.connected ? '#4ade80' : '#6b7280',
          boxShadow: state.connected ? '0 0 8px #4ade80' : 'none',
        }} />
        <span style={styles.statusText}>
          {state.connected ? '已连接' : '未连接'}
        </span>
      </div>

      {/* 串口选择（未连接时显示） */}
      {!state.connected && (
        <div style={styles.portSection}>
          <div style={styles.portRow}>
            <select
              style={styles.portSelect}
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              disabled={ports.length === 0}
            >
              {ports.length === 0 ? (
                <option value="">未发现串口</option>
              ) : (
                ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
                  </option>
                ))
              )}
            </select>
            <button
              style={styles.scanBtn}
              onClick={handleScanPorts}
              disabled={scanning}
            >
              {scanning ? '⏳' : '🔍'}
            </button>
          </div>
        </div>
      )}

      {/* 当前情绪 */}
      {state.connected && (
        <div style={styles.emotionRow}>
          <span style={styles.emotionIcon}>
            {state.breathing ? '🌬️' : '📍'}
          </span>
          <span style={styles.emotionText}>
            当前情绪：<b>{emotionLabel}</b>
            {' '}
            {state.breathing && state.breatheConfig && (
              <span style={styles.breatheDetail}>
                ({state.breatheConfig.minAngle}°↔{state.breatheConfig.maxAngle}° · {state.breatheConfig.periodMs}ms)
              </span>
            )}
          </span>
        </div>
      )}

      {/* 呼吸状态 */}
      {state.connected && state.breathing && (
        <div style={styles.breathingBar}>
          <div style={styles.breathingLabel}>呼吸摆动中</div>
          <div style={styles.breathingTrack}>
            <div style={{
              ...styles.breathingFill,
              animation: `servoBreathe ${(state.breatheConfig?.periodMs || 4000) / 1000}s ease-in-out infinite`,
            }} />
          </div>
        </div>
      )}

      {/* 按钮 */}
      <div style={styles.buttons}>
        {!state.connected ? (
          <button
            style={{ ...styles.btn, ...styles.btnConnect }}
            onClick={handleConnect}
            disabled={connecting}
          >
            {connecting ? '⏳ 搜索设备中...' : '🔌 连接舵机'}
          </button>
        ) : (
          <button
            style={{ ...styles.btn, ...styles.btnDisconnect }}
            onClick={handleDisconnect}
          >
            ⏏️ 断开连接
          </button>
        )}
      </div>

      {/* 提示 */}
      {lastMessage && (
        <div style={styles.message}>{lastMessage}</div>
      )}

      {/* 提示信息 */}
      {!state.connected && (
        <div style={styles.hint}>
          💡 连接 Arduino + SG90 舵机后，桌宠情绪变化将驱动实体舵机摆动<br />
          📡 自动扫描串口，不限定 COM4
        </div>
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    borderRadius: 16,
    padding: 24,
    color: '#e0e0e0',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: 400,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  icon: { fontSize: 32 },
  title: { fontSize: 18, fontWeight: 700, color: '#fff' },
  subtitle: { fontSize: 13, color: '#9ca3af', marginTop: 2 },
  statusRow: {
    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
    padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 10,
  },
  dot: {
    width: 12, height: 12, borderRadius: '50%', flexShrink: 0, transition: 'all 0.3s',
  },
  statusText: { fontSize: 15, fontWeight: 500 },
  portSection: { marginBottom: 16 },
  portRow: { display: 'flex', gap: 8 },
  portSelect: {
    flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 14,
    background: 'rgba(255,255,255,0.06)', color: '#e0e0e0',
    border: '1px solid rgba(255,255,255,0.1)', outline: 'none',
  },
  scanBtn: {
    padding: '10px 16px', borderRadius: 10, fontSize: 16, cursor: 'pointer',
    background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
    border: '1px solid rgba(139,92,246,0.3)',
  },
  emotionRow: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
    padding: '10px 14px', background: 'rgba(139, 92, 246, 0.1)', borderRadius: 10,
    border: '1px solid rgba(139, 92, 246, 0.2)',
  },
  emotionIcon: { fontSize: 20 },
  emotionText: { fontSize: 14, color: '#c4b5fd' },
  breatheDetail: { fontSize: 12, color: '#8b5cf6' },
  breathingBar: { marginBottom: 16 },
  breathingLabel: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  breathingTrack: {
    height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden',
  },
  breathingFill: {
    height: '100%', width: '100%',
    background: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
    borderRadius: 2, transformOrigin: 'center center',
  },
  buttons: { marginBottom: 12 },
  btn: {
    width: '100%', padding: '12px 20px', border: 'none', borderRadius: 12,
    fontSize: 15, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s',
  },
  btnConnect: {
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', color: '#fff',
  },
  btnDisconnect: {
    background: 'rgba(239, 68, 68, 0.15)', color: '#f87171',
    border: '1px solid rgba(239, 68, 68, 0.3)',
  },
  message: { fontSize: 13, color: '#9ca3af', textAlign: 'center', marginBottom: 10 },
  hint: { fontSize: 12, color: '#6b7280', textAlign: 'center', lineHeight: 1.8 },
};

export default ServoPanel;
