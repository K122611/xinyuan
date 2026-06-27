import { contextBridge, ipcRenderer } from 'electron';

// ========== 原有 API ==========
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  appVersion: process.env.npm_package_version || '1.0.0',
});

// ========== 舵机 API ==========
contextBridge.exposeInMainWorld('servoAPI', {
  // 连接/断开
  connect: () => ipcRenderer.invoke('servo:connect'),
  disconnect: () => ipcRenderer.invoke('servo:disconnect'),
  getStatus: () => ipcRenderer.invoke('servo:status'),

  // 角度控制
  setAngle: (angle) => ipcRenderer.invoke('servo:setAngle', angle),
  setAngleImmediate: (angle) => ipcRenderer.invoke('servo:setAngleImmediate', angle),

  // 呼吸摆动
  startBreathing: (cfg) => ipcRenderer.invoke('servo:startBreathing', cfg),
  stopBreathing: () => ipcRenderer.invoke('servo:stopBreathing'),

  // 端口扫描
  listPorts: () => ipcRenderer.invoke('servo:listPorts'),
});

// ========== Supabase API ==========
contextBridge.exposeInMainWorld('supabaseAPI', {
  getConfig: () => ipcRenderer.invoke('get-supabase-config'),
});

// ========== 小智 AI 桥接 API ==========
contextBridge.exposeInMainWorld('xiaozhiAPI', {
  // 服务器控制
  start: () => ipcRenderer.invoke('xiaozhi:start'),
  stop: () => ipcRenderer.invoke('xiaozhi:stop'),
  getStatus: () => ipcRenderer.invoke('xiaozhi:status'),

  // 消息发送
  sendToDevice: (sessionId, message) => ipcRenderer.invoke('xiaozhi:send-to-device', sessionId, message),
  broadcast: (message) => ipcRenderer.invoke('xiaozhi:broadcast', message),

  // 设备控制
  takePhoto: (sessionId) => ipcRenderer.invoke('xiaozhi:take-photo', sessionId),
  setVolume: (sessionId, volume) => ipcRenderer.invoke('xiaozhi:set-volume', sessionId, volume),
  setBrightness: (sessionId, brightness) => ipcRenderer.invoke('xiaozhi:set-brightness', sessionId, brightness),
  ttsSpeak: (sessionId, text) => ipcRenderer.invoke('xiaozhi:tts-speak', sessionId, text),
  sendMCPToolCall: (sessionId, toolName, args) => ipcRenderer.invoke('xiaozhi:send-mcp', sessionId, toolName, args),

  // 事件监听
  onDeviceEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('xiaozhi:device-event', handler);
    // 返回取消订阅函数
    return () => ipcRenderer.removeListener('xiaozhi:device-event', handler);
  },
});

// ========== 音频串口桥接 API ==========
contextBridge.exposeInMainWorld('audioBridgeAPI', {
  // 连接/断开 ESP32
  connect: () => ipcRenderer.invoke('audio-bridge:connect'),
  disconnect: () => ipcRenderer.invoke('audio-bridge:disconnect'),
  getStatus: () => ipcRenderer.invoke('audio-bridge:status'),
  listPorts: () => ipcRenderer.invoke('audio-bridge:list-ports'),

  // 控制
  startCapture: () => ipcRenderer.invoke('audio-bridge:start-capture'),
  stopCapture: () => ipcRenderer.invoke('audio-bridge:stop-capture'),

  // 文字直接对话 (测试用)
  sendText: (text) => ipcRenderer.invoke('audio-bridge:send-text', text),

  // Coze 请求回调 (由主进程触发 → 渲染进程处理 → 返回结果)
  onCozeRequest: (callback) => {
    const handler = async (_event, text) => {
      const response = await callback(text);
      ipcRenderer.send('audio-bridge:coze-response', response);
    };
    ipcRenderer.on('audio-bridge:coze-request', handler);
    return () => ipcRenderer.removeListener('audio-bridge:coze-request', handler);
  },

  // TTS 播报 (渲染进程 speechSynthesis → 主进程 ESP32)
  onTtsRequest: (callback) => {
    const handler = (_event, data) => callback(data.text, data.requestId);
    ipcRenderer.on('audio-bridge:tts-speak', handler);
    return () => ipcRenderer.removeListener('audio-bridge:tts-speak', handler);
  },
  sendTtsResult: (requestId, pcmBuffer) => {
    ipcRenderer.send('audio-bridge:tts-complete', { requestId, pcm: Array.from(new Uint8Array(pcmBuffer)), duration: pcmBuffer.length / (16000 * 2) });
  },

  // 状态监听
  onStatus: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('audio-bridge:status', handler);
    return () => ipcRenderer.removeListener('audio-bridge:status', handler);
  },
  onAudioLevel: (callback) => {
    const handler = (_event, level) => callback(level);
    ipcRenderer.on('audio-bridge:level', handler);
    return () => ipcRenderer.removeListener('audio-bridge:level', handler);
  },
  onUserSpeech: (callback) => {
    // 由主进程通过 status 消息传递
    const handler = (_event, msg) => {
      if (msg.startsWith('识别:')) callback(msg.slice(3));
    };
    ipcRenderer.on('audio-bridge:status', handler);
    return () => ipcRenderer.removeListener('audio-bridge:status', handler);
  },
});

// ============ AI 设备对话 API ============
contextBridge.exposeInMainWorld('aiAPI', {
  // 让设备说出指定文字
  speakText: (sessionId, text) => ipcRenderer.invoke('ai:speak-text', sessionId, text),
  // 发送消息给 Coze AI，回复从设备喇叭播放
  chat: (sessionId, message) => ipcRenderer.invoke('ai:chat', sessionId, message),
  // 获取设备会话列表（{ active: true, sessions: [...] }）
  getSessions: () => ipcRenderer.invoke('ai:status'),
  // 监听 AI 事件（stt_result, ai_reply, tts_done 等）
  onEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('ai:event', handler);
    return () => ipcRenderer.removeListener('ai:event', handler);
  },
  getNetworkInfo: () => ipcRenderer.invoke('ai:network-info'),
  // 诊断：正弦波测试
  sineTest: (sessionId) => ipcRenderer.invoke('ai:sine-test', sessionId),
});
