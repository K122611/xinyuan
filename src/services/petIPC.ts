// ============ 宠物悬浮窗 IPC 通讯桥 ============
// 在主窗口和悬浮宠物窗口之间传递消息

interface PetMessage {
  type: 'speech_bubble' | 'mood_update' | 'reaction' | 'greeting' | 'window_control' | 'sync_pet_state';
  payload: any;
  timestamp: number;
}

interface PetIPC {
  showPet: () => void;
  hidePet: () => void;
  sendToPet: (type: PetMessage['type'], payload: any) => void;
  onMessage: (callback: (msg: PetMessage) => void) => () => void;
  closePet: () => void;
}

// 检测是否在 Electron 环境中
const isElectronEnv = (): boolean => {
  return typeof window !== 'undefined' && !!(window as any).petAPI;
};

// 创建 IPC 实例
const createPetIPC = (): PetIPC => {
  // Electron 环境：使用 preload 注入的 petAPI
  if (isElectronEnv()) {
    const api = (window as any).petAPI;
    return {
      showPet: () => api.showPet(),
      hidePet: () => api.hidePet(),
      sendToPet: (type, payload) => api.sendToPet({ type, payload, timestamp: Date.now() }),
      onMessage: (callback) => {
        const handler = (msg: PetMessage) => callback(msg);
        api.onMessage(handler);
        return () => api.removeListener(handler);
      },
      closePet: () => api.closePet(),
    };
  }

  // 浏览器环境：使用 BroadcastChannel / localStorage 模拟
  const listeners: Array<(msg: PetMessage) => void> = [];
  const channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('xinyuan-pet-channel')
    : null;

  if (channel) {
    channel.onmessage = (event) => {
      const msg = event.data as PetMessage;
      listeners.forEach(fn => fn(msg));
    };
  }

  return {
    showPet: () => {
      // 浏览器环境无法独立窗口，跳过
      console.log('[PetIPC] showPet not available in browser');
    },
    hidePet: () => {
      console.log('[PetIPC] hidePet not available in browser');
    },
    sendToPet: (type, payload) => {
      const msg: PetMessage = { type, payload, timestamp: Date.now() };
      // 也通过 localStorage 传递（浮动宠物页轮询）
      localStorage.setItem('xinyuan_pet_msg', JSON.stringify(msg));
      if (channel) channel.postMessage(msg);
    },
    onMessage: (callback) => {
      listeners.push(callback);
      return () => {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    closePet: () => {
      if (channel) channel.close();
    },
  };
};

export const petIPC = createPetIPC();
export type { PetMessage, PetIPC };
