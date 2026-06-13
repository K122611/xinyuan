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
