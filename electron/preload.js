const { contextBridge, ipcRenderer } = require('electron');

// ============ 基础 API ============
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  appVersion: require('../package.json').version,
});

// ============ 宠物悬浮窗 API ============
const petMessageListeners = new Set();

ipcRenderer.on('pet:message', (_event, message) => {
  petMessageListeners.forEach((fn) => {
    try { fn(message); } catch {}
  });
});

ipcRenderer.on('pet:state-update', (_event, petState) => {
  // 宠物状态同步，转发给页面
  petMessageListeners.forEach((fn) => {
    try { fn({ type: 'sync_pet_state', payload: petState, timestamp: Date.now() }); } catch {}
  });
});

contextBridge.exposeInMainWorld('petAPI', {
  showPet: () => ipcRenderer.invoke('pet:show'),
  hidePet: () => ipcRenderer.invoke('pet:hide'),
  closePet: () => ipcRenderer.invoke('pet:close'),
  togglePet: () => ipcRenderer.invoke('pet:toggle'),
  isVisible: () => ipcRenderer.invoke('pet:is-visible'),

  // 向另一个窗口发送宠物消息
  sendToPet: (message) => ipcRenderer.invoke('pet:send-message', message),

  // 同步宠物状态
  syncState: (petState) => ipcRenderer.invoke('pet:sync-state', petState),

  // 事件监听
  onMessage: (callback) => {
    petMessageListeners.add(callback);
  },
  removeListener: (callback) => {
    petMessageListeners.delete(callback);
  },

  // 窗口控制
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  doubleClick: () => ipcRenderer.send('pet:dblclick'),
});
