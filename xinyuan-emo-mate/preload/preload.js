const { contextBridge, ipcRenderer } = require('electron');

// 安全暴露API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),

  // 对话
  chatSend: (data) => ipcRenderer.invoke('chat:send', data),
  chatSaveResponse: (data) => ipcRenderer.invoke('chat:saveResponse', data),
  chatGetHistory: (sessionId) => ipcRenderer.invoke('chat:getHistory', sessionId),
  chatGetRecentSessions: () => ipcRenderer.invoke('chat:getRecentSessions'),

  // 情绪
  emotionLog: (data) => ipcRenderer.invoke('emotion:log', data),
  emotionGetDaily: (date) => ipcRenderer.invoke('emotion:getDaily', date),
  emotionGetWeekly: () => ipcRenderer.invoke('emotion:getWeekly'),

  // 记忆锚点
  memoryCreate: (data) => ipcRenderer.invoke('memory:create', data),
  memoryGetAll: () => ipcRenderer.invoke('memory:getAll'),
  memoryRecall: (id) => ipcRenderer.invoke('memory:recall', id),

  // 人格参数
  personaGetAll: () => ipcRenderer.invoke('persona:getAll'),
  personaUpdate: (data) => ipcRenderer.invoke('persona:update', data),

  // 萌宠
  petGetState: () => ipcRenderer.invoke('pet:getState'),
  petUpdate: (updates) => ipcRenderer.invoke('pet:update', updates),
  petFeed: () => ipcRenderer.invoke('pet:feed'),

  // 里程碑
  milestoneUnlock: (data) => ipcRenderer.invoke('milestone:unlock', data),
  milestoneGetAll: () => ipcRenderer.invoke('milestone:getAll'),

  // 配置
  configGet: (key) => ipcRenderer.invoke('config:get', key),
  configSet: (data) => ipcRenderer.invoke('config:set', data),

  // 搭子
  mateGetMatches: () => ipcRenderer.invoke('mate:getMatches'),
  mateCreateMatch: (data) => ipcRenderer.invoke('mate:createMatch', data),
  mateEndMatch: (matchId) => ipcRenderer.invoke('mate:endMatch', matchId),
  mateSendMessage: (data) => ipcRenderer.invoke('mate:sendMessage', data),
  mateGetMessages: (matchId) => ipcRenderer.invoke('mate:getMessages', matchId),

  // 监听事件
  onMaximizeChange: (callback) => {
    ipcRenderer.on('window:maximize-change', (_e, isMaximized) => callback(isMaximized));
  },
});
