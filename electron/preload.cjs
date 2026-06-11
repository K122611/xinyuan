const { contextBridge, ipcRenderer } = require('electron');

// ============ 基础 API ============
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  appVersion: require('../package.json').version,
  openChat: () => ipcRenderer.invoke('main:show'),
  moveWindow: (dx, dy) => ipcRenderer.send('pet:move-window', { dx, dy }),
});

// ============ 宠物悬浮窗 API ============
const petMessageListeners = new Set();

ipcRenderer.on('pet:message', (_event, message) => {
  petMessageListeners.forEach((fn) => {
    try { fn(message); } catch {}
  });
});

ipcRenderer.on('pet:state-update', (_event, petState) => {
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

  getBounds: () => ipcRenderer.invoke('pet:get-bounds'),
  setBounds: (bounds) => ipcRenderer.invoke('pet:set-bounds', bounds),

  allowClick: (allow) => ipcRenderer.invoke('pet:allow-click', !!allow),
  allowClickSync: (allow) => ipcRenderer.sendSync('pet:allow-click-sync', !!allow),

  sendToPet: (message) => ipcRenderer.invoke('pet:send-message', message),
  syncState: (petState) => ipcRenderer.invoke('pet:sync-state', petState),

  onMessage: (callback) => {
    petMessageListeners.add(callback);
  },
  removeListener: (callback) => {
    petMessageListeners.delete(callback);
  },

  dragStart: () => ipcRenderer.send('pet:drag-start'),
  doubleClick: () => ipcRenderer.send('pet:dblclick'),
});

// ============ 主窗口 API ============
contextBridge.exposeInMainWorld('mainAPI', {
  show: () => ipcRenderer.invoke('main:show'),
  hide: () => ipcRenderer.invoke('main:hide'),
  isVisible: () => ipcRenderer.invoke('main:is-visible'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
