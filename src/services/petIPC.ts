// ============ 宠物悬浮窗 IPC 桥接层 ============
// 同时支持 Electron 桌面端 和 浏览器开发环境

export class PetMessage {
  type: string = '';
  payload: any = null;
  timestamp: number = Date.now();
}

interface PetIPC {
  showPet: () => Promise<boolean>;
  hidePet: () => Promise<boolean>;
  closePet: () => Promise<boolean>;
  togglePet: () => Promise<boolean>;
  isVisible: () => Promise<boolean>;
  getBounds: () => Promise<any>;
  setBounds: (bounds: any) => Promise<boolean>;
  allowClick: (allow: boolean) => Promise<boolean>;
  sendToPet: (message: any) => Promise<boolean>;
  syncState: (petState: any) => Promise<boolean>;
  doubleClick: () => void;
  dragStart: () => void;
  onMessage: (callback: (message: PetMessage) => void) => void;
  removeListener: (callback: (message: PetMessage) => void) => void;
}

// ============ Electron 实现 ============
function createElectronPetIPC(): PetIPC {
  const petWindow = (window as any).petAPI;
  return {
    showPet: () => petWindow?.showPet?.() ?? Promise.resolve(false),
    hidePet: () => petWindow?.hidePet?.() ?? Promise.resolve(false),
    closePet: () => petWindow?.closePet?.() ?? Promise.resolve(false),
    togglePet: () => petWindow?.togglePet?.() ?? Promise.resolve(false),
    isVisible: () => petWindow?.isVisible?.() ?? Promise.resolve(false),
    getBounds: () => petWindow?.getBounds?.() ?? Promise.resolve(null),
    setBounds: (bounds) => petWindow?.setBounds?.(bounds) ?? Promise.resolve(false),
    allowClick: (allow) => petWindow?.allowClick?.(allow) ?? Promise.resolve(false),
    sendToPet: (message) => petWindow?.sendToPet?.(message) ?? Promise.resolve(false),
    syncState: (petState) => petWindow?.syncState?.(petState) ?? Promise.resolve(false),
    doubleClick: () => petWindow?.doubleClick?.(),
    dragStart: () => petWindow?.dragStart?.(),
    onMessage: (callback) => petWindow?.onMessage?.(callback),
    removeListener: (callback) => petWindow?.removeListener?.(callback),
  };
}

// ============ 浏览器 Fallback（开发环境用 BroadcastChannel 模拟）============
function createBrowserPetIPC(): PetIPC {
  const listeners = new Set<(msg: PetMessage) => void>();
  const channel = typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('pet-ipc')
    : null;

  if (channel) {
    channel.onmessage = (event) => {
      const msg = event.data;
      listeners.forEach((fn) => {
        try { fn(msg); } catch {}
      });
    };
  }

  return {
    showPet: async () => { console.log('[Browser] showPet (no-op)'); return true; },
    hidePet: async () => { console.log('[Browser] hidePet (no-op)'); return true; },
    closePet: async () => { console.log('[Browser] closePet (no-op)'); return true; },
    togglePet: async () => { console.log('[Browser] togglePet (no-op)'); return true; },
    isVisible: async () => false,
    getBounds: async () => ({ x: 0, y: 0, width: 280, height: 380 }),
    setBounds: async () => false,
    allowClick: async () => false,
    sendToPet: async (message) => { channel?.postMessage(message); return true; },
    syncState: async (petState) => { channel?.postMessage(petState); return true; },
    doubleClick: () => { console.log('[Browser] doubleClick (no-op)'); },
    dragStart: () => {},
    onMessage: (callback) => { listeners.add(callback); },
    removeListener: (callback) => { listeners.delete(callback); },
  };
}

// ============ 导出统一的 IPC 实例 ============
export const petIPC: PetIPC =
  typeof window !== 'undefined' && (window as any).petAPI
    ? createElectronPetIPC()
    : createBrowserPetIPC();
