import React, { useEffect, useState, useCallback } from 'react';
import {
  getBridgeStatus,
  startBridge,
  stopBridge,
  takePhoto,
  ttsSpeak,
  setVolume,
  setBrightness,
  onDeviceEvent,
  sendEmotion,
  type XiaozhiStatus,
  type DeviceEvent,
  type PhotoResult,
} from '@/services/xiaozhiBridge';
import { usePetStore } from '@/store';

const EMOTION_CN: Record<string, string> = {
  happy: '开心', joy: '喜悦', excited: '兴奋', grateful: '感恩',
  calm: '平静', relaxed: '放松', peaceful: '平和', neutral: '中性',
  content: '满足', satisfied: '满意', surprised: '惊讶',
  sad: '悲伤', low: '低落', lonely: '孤独', disappointed: '失望',
  anxious: '焦虑', worried: '担忧', angry: '愤怒', frustrated: '沮丧',
  bored: '无聊', tired: '疲惫',
};

const XiaozhiPanel: React.FC = () => {
  const [status, setStatus] = useState<XiaozhiStatus>({
    running: false, port: 8888, deviceCount: 0, devices: [],
  });
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const [lastPhoto, setLastPhoto] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [ttsText, setTtsText] = useState('');
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  // ===== 中继模式状态 =====
  const [relayStatus, setRelayStatus] = useState<RelayStatus>({
    enabled: false, serverUrl: null, activeRelays: 0, devices: [],
  });
  const [relayToggleLoading, setRelayToggleLoading] = useState(false);

  const refreshRelay = useCallback(async () => {
    try {
      if (window.relayAPI) {
        const s = await window.relayAPI.getStatus();
        setRelayStatus(s);
      }
    } catch { /* relay API 不可用 */ }
  }, []);

  useEffect(() => {
    refreshRelay();
    const timer = setInterval(refreshRelay, 5000);
    return () => clearInterval(timer);
  }, [refreshRelay]);

  useEffect(() => {
    if (!window.relayAPI) return;
    const unsub = window.relayAPI.onEvent((evt) => {
      refreshRelay();
    });
    return unsub;
  }, [refreshRelay]);

  const refresh = useCallback(async () => {
    const s = await getBridgeStatus();
    setStatus(s);
    if (!selectedDevice && s.devices.length > 0) {
      setSelectedDevice(s.devices[0].sessionId);
    }
  }, [selectedDevice]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const unsub = onDeviceEvent((evt) => {
      setEvents((prev) => [evt, ...prev].slice(0, 50));
      refresh();
    });
    return unsub;
  }, [refresh]);

  const handleToggleServer = async () => {
    if (status.running) {
      await stopBridge();
    } else {
      await startBridge();
    }
    await refresh();
  };

  const handleToggleRelay = async () => {
    if (!window.relayAPI) return;
    setRelayToggleLoading(true);
    try {
      const result = await window.relayAPI.toggle();
      setRelayStatus(result);
    } catch (err: any) {
      console.error('[Relay] 切换失败:', err);
    } finally {
      setRelayToggleLoading(false);
    }
  };

  const handleTakePhoto = async () => {
    if (!selectedDevice) return;
    setPhotoLoading(true);
    setLastPhoto(null);
    try {
      const result: PhotoResult = await takePhoto(selectedDevice);
      if (result.imageBase64) {
        setLastPhoto(`data:${result.mimeType || 'image/jpeg'};base64,${result.imageBase64}`);
      } else if (result.imageUrl) {
        setLastPhoto(result.imageUrl);
      }
    } catch {
      // ignore
    } finally {
      setPhotoLoading(false);
    }
  };

  const handleTTS = async () => {
    if (!selectedDevice || !ttsText.trim()) return;
    await ttsSpeak(selectedDevice, ttsText.trim());
    setTtsText('');
  };

  const handleSyncEmotion = async () => {
    if (!selectedDevice) return;
    const mood = usePetStore.getState().pet.mood || 'calm';
    await sendEmotion(selectedDevice, mood);
  };

  const activeDevice = status.devices.find((d) => d.sessionId === selectedDevice);
  const moodLabel = EMOTION_CN[usePetStore.getState().pet.mood] || usePetStore.getState().pet.mood || '平静';

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.icon}>👁️</span>
        <div>
          <div style={styles.title}>视觉小智 AI 桥接</div>
          <div style={styles.subtitle}>ESP32-S3-CAM · WebSocket 直连</div>
        </div>
      </div>

      <div style={styles.statusRow}>
        <div style={{
          ...styles.dot,
          background: status.running ? '#4ade80' : '#6b7280',
          boxShadow: status.running ? '0 0 8px #4ade80' : 'none',
        }} />
        <span style={styles.statusText}>
          服务器{status.running ? `运行中 :${status.port}` : '未启动'}
        </span>
        <button style={styles.toggleBtn} onClick={handleToggleServer}>
          {status.running ? '⏹ 停止' : '▶ 启动'}
        </button>
      </div>

      {status.running && (
        <div style={styles.devicesSection}>
          <div style={styles.sectionLabel}>📡 已连接设备 ({status.deviceCount})</div>
          {status.devices.length === 0 ? (
            <div style={styles.emptyDevices}>
              等待小智设备连接...<br />
              <span style={styles.hint}>
                ESP32 需在代码中设置 ws://本机IP:{status.port}
              </span>
            </div>
          ) : (
            <div style={styles.deviceList}>
              {status.devices.map((device) => (
                <div
                  key={device.sessionId}
                  style={{
                    ...styles.deviceCard,
                    borderColor: device.sessionId === selectedDevice
                      ? 'rgba(139,92,246,0.5)' : 'rgba(255,255,255,0.08)',
                    background: device.sessionId === selectedDevice
                      ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.03)',
                  }}
                  onClick={() => setSelectedDevice(device.sessionId)}
                >
                  <div style={styles.deviceHeader}>
                    <span style={styles.deviceIcon}>🤖</span>
                    <div style={styles.deviceInfo}>
                      <div style={styles.deviceId}>{device.sessionId.slice(0, 8)}...</div>
                      <div style={styles.deviceMeta}>
                        {device.ip} · {device.state}
                        {device.features?.mcp && ' · MCP'}
                      </div>
                    </div>
                    <div style={{
                      ...styles.stateDot,
                      background: device.state === 'connected' ? '#4ade80'
                        : device.state === 'listening' ? '#f59e0b'
                        : device.state === 'speaking' ? '#3b82f6' : '#6b7280',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeDevice && (
        <div style={styles.controlSection}>
          <div style={styles.sectionLabel}>🎮 设备控制</div>
          <div style={styles.controlRow}>
            <button style={styles.actionBtn} onClick={handleTakePhoto} disabled={photoLoading}>
              {photoLoading ? '⏳ 拍照中...' : '📸 拍照'}
            </button>
            <button style={{ ...styles.actionBtn, ...styles.secondaryBtn }} onClick={handleSyncEmotion}>
              🎭 同步情绪「{moodLabel}」
            </button>
          </div>

          {lastPhoto && (
            <div style={styles.photoPreview}>
              <img
                src={lastPhoto}
                alt="小智拍照"
                style={styles.photoImg}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            </div>
          )}

          <div style={styles.sliderRow}>
            <button style={{ ...styles.smallBtn, ...styles.secondaryBtn }}
              onClick={() => setVolume(selectedDevice!, 50)}>🔊 50%</button>
            <button style={{ ...styles.smallBtn, ...styles.secondaryBtn }}
              onClick={() => setVolume(selectedDevice!, 80)}>🔊 80%</button>
            <button style={{ ...styles.smallBtn, ...styles.secondaryBtn }}
              onClick={() => setBrightness(selectedDevice!, 80)}>☀️ 亮度80%</button>
          </div>

          <div style={styles.ttsRow}>
            <input
              style={styles.ttsInput}
              placeholder="输入 TTS 播报文本..."
              value={ttsText}
              onChange={(e) => setTtsText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTTS()}
            />
            <button style={styles.ttsBtn} onClick={handleTTS} disabled={!ttsText.trim()}>🗣️</button>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div style={styles.eventsSection}>
          <div style={styles.sectionLabel}>📋 事件日志</div>
          <div style={styles.eventsList}>
            {events.slice(0, 5).map((evt, i) => (
              <div key={i} style={styles.eventItem}>
                <span style={styles.eventTag}>
                  {evt.event === 'connected' ? '🟢'
                    : evt.event === 'disconnected' ? '🔴'
                    : evt.event === 'state_changed' ? '🔄' : '📡'}
                </span>
                <span style={styles.eventText}>
                  {evt.event}: {evt.sessionId?.slice(0, 8)}...
                  {evt.data && ` (${JSON.stringify(evt.data).slice(0, 30)})`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== 中继模式切换 ========== */}
      <div style={{
        ...styles.controlSection,
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingTop: 16,
        marginTop: 4,
      }}>
        <div style={styles.sectionLabel}>🔄 独立对话模式 (中继)</div>
        <div style={{ ...styles.statusRow, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              ...styles.dot,
              background: relayStatus.enabled ? '#f59e0b' : '#6b7280',
              boxShadow: relayStatus.enabled ? '0 0 8px #f59e0b' : 'none',
            }} />
            <span style={styles.statusText}>
              {relayStatus.enabled
                ? `🟡 中继已启用 → ${relayStatus.serverUrl || '官方云'}`
                : '⚫ 本地AI模式'}
            </span>
            <button
              style={{
                ...styles.toggleBtn,
                background: relayStatus.enabled
                  ? 'rgba(245,158,11,0.2)'
                  : 'rgba(139,92,246,0.15)',
                color: relayStatus.enabled ? '#fbbf24' : '#a78bfa',
                opacity: relayToggleLoading ? 0.5 : 1,
              }}
              onClick={handleToggleRelay}
              disabled={relayToggleLoading}
            >
              {relayToggleLoading ? '⏳' : relayStatus.enabled ? '⏹ 切回本地' : '☁️ 启用中继'}
            </button>
          </div>
          {relayStatus.enabled && relayStatus.activeRelays > 0 && (
            <div style={{ fontSize: 12, color: '#fbbf24' }}>
              📡 正在中继 {relayStatus.activeRelays} 个设备
            </div>
          )}
          {relayStatus.error && (
            <div style={{ fontSize: 12, color: '#ef4444' }}>
              ⚠ {relayStatus.error}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.6 }}>
            💡 启用后，设备语音直连官方小智云服务器<br />
            &nbsp;&nbsp;&nbsp;不经过心元 APP 的 AI 处理链路
          </div>
        </div>
      </div>

      <div style={styles.hint}>
        💡 小智 ESP32-S3-CAM 通过 WiFi 连接本机 :{status.port}<br />
        🔧 设备固件需配置 ws://本机IP:{status.port} 作为服务器地址<br />
        📸 支持拍照 + 视觉分析 + 情绪驱动舵机
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    borderRadius: 16, padding: 24, color: '#e0e0e0',
    fontFamily: 'system-ui, sans-serif', maxWidth: 440,
    border: '1px solid rgba(255,255,255,0.06)',
  },
  header: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 },
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
  statusText: { fontSize: 14, fontWeight: 500, flex: 1 },
  toggleBtn: {
    padding: '4px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', border: '1px solid rgba(139,92,246,0.3)',
    background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
  },
  sectionLabel: {
    fontSize: 13, fontWeight: 600, color: '#9ca3af',
    marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  devicesSection: { marginBottom: 20 },
  deviceList: { display: 'flex', flexDirection: 'column', gap: 8 },
  deviceCard: {
    padding: '12px 14px', borderRadius: 10, border: '1px solid',
    cursor: 'pointer', transition: 'all 0.2s',
  },
  deviceHeader: { display: 'flex', alignItems: 'center', gap: 10 },
  deviceIcon: { fontSize: 24 },
  deviceInfo: { flex: 1 },
  deviceId: { fontSize: 14, fontWeight: 600, color: '#e0e0e0', fontFamily: 'monospace' },
  deviceMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  stateDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  emptyDevices: {
    padding: '20px 14px', textAlign: 'center', color: '#6b7280',
    fontSize: 13, lineHeight: 1.8, background: 'rgba(255,255,255,0.02)', borderRadius: 10,
  },
  hint: { fontSize: 12, color: '#4b5563', textAlign: 'center', marginTop: 16, lineHeight: 1.8 },
  controlSection: { marginBottom: 16 },
  controlRow: { display: 'flex', gap: 8, marginBottom: 12 },
  actionBtn: {
    flex: 1, padding: '10px 16px', borderRadius: 10, fontSize: 14, fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', color: '#fff', transition: 'all 0.2s',
  },
  secondaryBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)', color: '#9ca3af',
  },
  photoPreview: {
    marginBottom: 12, borderRadius: 10, overflow: 'hidden', background: 'rgba(0,0,0,0.3)',
  },
  photoImg: { width: '100%', maxHeight: 240, objectFit: 'contain', display: 'block' },
  sliderRow: { display: 'flex', gap: 6, marginBottom: 12 },
  smallBtn: { flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer' },
  ttsRow: { display: 'flex', gap: 8 },
  ttsInput: {
    flex: 1, padding: '10px 14px', borderRadius: 10, fontSize: 14,
    background: 'rgba(255,255,255,0.06)', color: '#e0e0e0',
    border: '1px solid rgba(255,255,255,0.1)', outline: 'none',
  },
  ttsBtn: {
    padding: '10px 16px', borderRadius: 10, fontSize: 18, cursor: 'pointer',
    background: 'rgba(139,92,246,0.15)', color: '#a78bfa',
    border: '1px solid rgba(139,92,246,0.3)',
  },
  eventsSection: { marginBottom: 12 },
  eventsList: {
    display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 120, overflowY: 'auto',
    padding: '8px 10px', borderRadius: 10, background: 'rgba(0,0,0,0.2)',
  },
  eventItem: { display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, fontFamily: 'monospace' },
  eventTag: { flexShrink: 0, fontSize: 10 },
  eventText: { color: '#6b7280', wordBreak: 'break-all' },
};

export default XiaozhiPanel;
