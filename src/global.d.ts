/**
 * 全局类型声明
 */

interface AudioBridgeAPI {
  connect: (portName: string) => Promise<{ success: boolean; message: string }>;
  disconnect: () => Promise<{ success: boolean }>;
  getStatus: () => Promise<{
    connected: boolean;
    serialOpen: boolean;
    capturing: boolean;
    portName: string | null;
    vadState: string;
    lastError: string | null;
  }>;
  listPorts: () => Promise<{ path: string; manufacturer?: string }[]>;
  startCapture: () => Promise<{ success: boolean; message: string }>;
  stopCapture: () => Promise<{ success: boolean }>;
  sendText: (text: string) => Promise<{ success: boolean; reply: string; autoSpoken: boolean }>;
  onMicData: (callback: (data: { pcm: number[]; samples: number }) => void) => () => void;
  onAiResponse: (callback: (text: string) => void) => () => void;
  onTtsRequest: (callback: (text: string, requestId: string) => void) => () => void;
  sendTtsResult: (requestId: string, pcmBuffer: ArrayBuffer) => void;
  onStatus: (callback: (status: Record<string, unknown>) => void) => () => void;
  onError: (callback: (error: string) => void) => () => void;
}

declare global {
  interface Window {
    audioBridgeAPI?: AudioBridgeAPI;
    relayAPI?: RelayAPI;
  }
}

interface RelayStatus {
  enabled: boolean;
  serverUrl: string | null;
  activeRelays: number;
  devices: string[];
  error?: string;
}

interface RelayEvent {
  type: 'started' | 'stopped' | 'serverDisconnected' | 'serverError';
  serverUrl?: string;
  deviceId?: string;
  code?: number;
  error?: string;
}

interface RelayAPI {
  start: () => Promise<RelayStatus>;
  stop: () => Promise<RelayStatus>;
  getStatus: () => Promise<RelayStatus>;
  toggle: () => Promise<RelayStatus>;
  onEvent: (callback: (event: RelayEvent) => void) => () => void;
}

export {};
