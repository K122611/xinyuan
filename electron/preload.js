import { contextBridge, ipcRenderer } from 'electron';

// ========== 原有 API（保持兼容） ==========
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  appVersion: process.env.npm_package_version || '1.0.0',
});

// ========== Servo API ==========
contextBridge.exposeInMainWorld('servoAPI', {
  /** 连接舵机（自动发现 Arduino 串口） */
  connect: () => ipcRenderer.invoke('servo:connect'),
  /** 断开连接 */
  disconnect: () => ipcRenderer.invoke('servo:disconnect'),
  /** 获取连接状态 */
  getStatus: () => ipcRenderer.invoke('servo:status'),
  /** 发送角度（0-180，带防抖） */
  setAngle: (angle) => ipcRenderer.invoke('servo:setAngle', angle),
  /** 立即发送角度（跳过防抖，用于测试） */
  setAngleImmediate: (angle) => ipcRenderer.invoke('servo:setAngleImmediate', angle),
  /** 启动呼吸摆动 { minAngle, maxAngle, periodMs } */
  startBreathing: (cfg) => ipcRenderer.invoke('servo:startBreathing', cfg),
  /** 停止呼吸摆动 */
  stopBreathing: () => ipcRenderer.invoke('servo:stopBreathing'),
});

// ========== Supabase API ==========
contextBridge.exposeInMainWorld('supabaseAPI', {
  getConfig: () => ipcRenderer.invoke('get-supabase-config'),
});

// ========== XiaoZhi Bridge API ==========
contextBridge.exposeInMainWorld('xiaozhiAPI', {
  /** 获取桥接器状态 */
  getStatus: () => ipcRenderer.invoke('xiaozhi:status'),
  /** 启动桥接器 */
  start: () => ipcRenderer.invoke('xiaozhi:start'),
  /** 停止桥接器 */
  stop: () => ipcRenderer.invoke('xiaozhi:stop'),
  /** 发送TTS */
  sendTts: (deviceId, text, voice) => ipcRenderer.invoke('xiaozhi:sendTts', { deviceId, text, voice }),
  /** 发送表情 */
  sendExpression: (deviceId, expression, duration) => ipcRenderer.invoke('xiaozhi:sendExpression', { deviceId, expression, duration }),
  /** 发送舵机角度 */
  sendServo: (deviceId, angle, speed) => ipcRenderer.invoke('xiaozhi:sendServo', { deviceId, angle, speed }),
  /** 发送聊天回复 */
  sendChat: (deviceId, text, emotion) => ipcRenderer.invoke('xiaozhi:sendChat', { deviceId, text, emotion }),
  /** 请求拍照 */
  requestPhoto: (deviceId) => ipcRenderer.invoke('xiaozhi:requestPhoto', { deviceId }),
});

// ========== AI Conversation API ==========
contextBridge.exposeInMainWorld('aiAPI', {
  /** 获取已连接的设备列表 [{ id, wsReadyState, ...info }] */
  getSessions: () => ipcRenderer.invoke('ai:get-sessions'),
  /** 让指定设备朗读文字 */
  speakText: (sessionId, text) => ipcRenderer.invoke('ai:speak-text', { sessionId, text }),
  /** 获取 AI 会话引擎状态 */
  getStatus: () => ipcRenderer.invoke('ai:status'),
});
